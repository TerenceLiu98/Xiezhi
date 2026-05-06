use std::{env, fs};

use xiezhi_core::{
    DecisionOption, DecisionPoint, DecisionPointStatus, Event, EventActor, RuntimeKind,
    SupervisorSession, SupervisorSessionStatus, WorkItem, WorkRun, WorkRunStatus,
    transition_work_run,
};
use xiezhi_hooks::HookRunner;
use xiezhi_runtime::{
    RuntimeStructuredEvent, SupervisorIntakeInput, build_supervisor_intake_prompt,
    execution_graph_from_supervisor_handoff, run_supervisor_intake_command,
    write_supervisor_intake_prompt,
};
use xiezhi_store::Store;
use xiezhi_workflow::{AgentRuntimeKind, load_workflow};
use xiezhi_workspace::WorkspaceManager;

const STATE_PATH: &str = ".xiezhi/state.sqlite";

fn main() {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("--version") | Some("-V") => {
            println!("xiezhi {}", env!("CARGO_PKG_VERSION"));
        }
        Some("run") => {
            let goal = args.collect::<Vec<_>>().join(" ");
            if goal.trim().is_empty() {
                eprintln!("usage: xiezhi run <goal>");
                std::process::exit(2);
            }
            let workflow = load_workflow("XIEZHI.md").ok().unwrap_or_default();
            let store = Store::open(STATE_PATH).unwrap_or_else(|error| {
                eprintln!("failed to open local state store: {error}");
                std::process::exit(1);
            });
            let item = WorkItem::local_goal(goal);
            let mut run = WorkRun::new(item.id, item.title.clone());
            store.insert_work_item(&item).unwrap_or_else(|error| {
                eprintln!("failed to persist work item: {error}");
                std::process::exit(1);
            });
            store.insert_work_run(&run).unwrap_or_else(|error| {
                eprintln!("failed to persist work run: {error}");
                std::process::exit(1);
            });
            let workspace_manager = WorkspaceManager::from_config(&workflow.workspace)
                .unwrap_or_else(|error| {
                    eprintln!("failed to prepare workspace manager: {error}");
                    std::process::exit(1);
                });
            let workspace = workspace_manager
                .create_run_workspace(&run)
                .unwrap_or_else(|error| {
                    eprintln!("failed to create run workspace: {error}");
                    std::process::exit(1);
                });
            store.insert_workspace(&workspace).unwrap_or_else(|error| {
                eprintln!("failed to persist workspace: {error}");
                std::process::exit(1);
            });
            run.workspace_id = Some(workspace.id);
            transition_work_run(&mut run, WorkRunStatus::WorkspaceReady).unwrap_or_else(|error| {
                eprintln!("failed to transition work run: {error}");
                std::process::exit(1);
            });
            store.update_work_run(&run).unwrap_or_else(|error| {
                eprintln!("failed to update work run: {error}");
                std::process::exit(1);
            });
            store
                .insert_event(&Event {
                    id: uuid::Uuid::now_v7(),
                    work_run_id: run.id,
                    actor: EventActor::XieZhi,
                    event_type: "work_run_created".to_string(),
                    summary: "Created local goal work run.".to_string(),
                    payload_json: None,
                    created_at: time::OffsetDateTime::now_utc(),
                })
                .unwrap_or_else(|error| {
                    eprintln!("failed to persist event: {error}");
                    std::process::exit(1);
                });
            store
                .insert_event(&Event {
                    id: uuid::Uuid::now_v7(),
                    work_run_id: run.id,
                    actor: EventActor::XieZhi,
                    event_type: "workspace_ready".to_string(),
                    summary: format!("Created run workspace at {}.", workspace.path),
                    payload_json: None,
                    created_at: time::OffsetDateTime::now_utc(),
                })
                .unwrap_or_else(|error| {
                    eprintln!("failed to persist event: {error}");
                    std::process::exit(1);
                });
            if let Some(command) = workflow.hooks.after_workspace_create.as_deref() {
                if !run_lifecycle_hook_or_exit(
                    &store,
                    run.id,
                    "after_workspace_create",
                    command,
                    &workspace.path,
                ) {
                    transition_work_run(&mut run, WorkRunStatus::Failed).unwrap_or_else(|error| {
                        eprintln!("failed to mark work run failed: {error}");
                        std::process::exit(1);
                    });
                    store.update_work_run(&run).unwrap_or_else(|error| {
                        eprintln!("failed to update failed work run: {error}");
                        std::process::exit(1);
                    });
                }
            }
            if !run.status.is_terminal() {
                if let Some(command) = workflow.hooks.before_supervisor_start.as_deref() {
                    if !run_lifecycle_hook_or_exit(
                        &store,
                        run.id,
                        "before_supervisor_start",
                        command,
                        &workspace.path,
                    ) {
                        transition_work_run(&mut run, WorkRunStatus::Failed).unwrap_or_else(
                            |error| {
                                eprintln!("failed to mark work run failed: {error}");
                                std::process::exit(1);
                            },
                        );
                        store.update_work_run(&run).unwrap_or_else(|error| {
                            eprintln!("failed to update failed work run: {error}");
                            std::process::exit(1);
                        });
                    }
                }
            }
            if !run.status.is_terminal() {
                let supervisor_session = SupervisorSession {
                    id: uuid::Uuid::now_v7(),
                    work_run_id: run.id,
                    runtime: runtime_kind_from_workflow(workflow.agent_runtime.kind),
                    model: workflow.agent_runtime.model.clone(),
                    status: SupervisorSessionStatus::Running,
                    started_at: time::OffsetDateTime::now_utc(),
                    ended_at: None,
                    last_event_id: None,
                };
                store
                    .insert_supervisor_session(&supervisor_session)
                    .unwrap_or_else(|error| {
                        eprintln!("failed to persist supervisor session: {error}");
                        std::process::exit(1);
                    });
                let intake_prompt = build_supervisor_intake_prompt(&SupervisorIntakeInput {
                    goal: run.goal.clone(),
                    work_run_id: run.id.to_string(),
                    workspace_path: workspace.path.clone(),
                    workflow: workflow.clone(),
                });
                let intake_prompt_path =
                    write_supervisor_intake_prompt(&workspace.path, &intake_prompt).unwrap_or_else(
                        |error| {
                            eprintln!("failed to write supervisor intake prompt: {error}");
                            std::process::exit(1);
                        },
                    );
                store
                    .insert_event(&Event {
                        id: uuid::Uuid::now_v7(),
                        work_run_id: run.id,
                        actor: EventActor::XieZhi,
                        event_type: "supervisor_intake_prompt_ready".to_string(),
                        summary: format!("Wrote supervisor intake prompt to {intake_prompt_path}."),
                        payload_json: Some(
                            serde_json::json!({
                                "path": intake_prompt_path,
                                "bytes": intake_prompt.len(),
                            })
                            .to_string(),
                        ),
                        created_at: time::OffsetDateTime::now_utc(),
                    })
                    .unwrap_or_else(|error| {
                        eprintln!("failed to persist supervisor prompt event: {error}");
                        std::process::exit(1);
                    });
                run.active_supervisor_session_id = Some(supervisor_session.id);
                transition_work_run(&mut run, WorkRunStatus::SupervisorIntake).unwrap_or_else(
                    |error| {
                        eprintln!("failed to transition work run: {error}");
                        std::process::exit(1);
                    },
                );
                store.update_work_run(&run).unwrap_or_else(|error| {
                    eprintln!("failed to update work run: {error}");
                    std::process::exit(1);
                });
                store
                    .insert_event(&Event {
                        id: uuid::Uuid::now_v7(),
                        work_run_id: run.id,
                        actor: EventActor::XieZhi,
                        event_type: "supervisor_session_started".to_string(),
                        summary: format!(
                            "Started supervisor intake with {:?}.",
                            supervisor_session.runtime
                        ),
                        payload_json: Some(
                            serde_json::json!({
                                "supervisor_session_id": supervisor_session.id,
                                "runtime": format!("{:?}", supervisor_session.runtime),
                                "model": supervisor_session.model,
                                "command": workflow.agent_runtime.command,
                                "instructions_present": !workflow.instructions.trim().is_empty(),
                            })
                            .to_string(),
                        ),
                        created_at: time::OffsetDateTime::now_utc(),
                    })
                    .unwrap_or_else(|error| {
                        eprintln!("failed to persist supervisor event: {error}");
                        std::process::exit(1);
                    });
            }
            println!("created work item: {}", item.id);
            println!("created work run: {}", run.id);
            println!("workspace: {}", workspace.path);
            println!("status: {:?}", run.status);
            if let Some(supervisor_session_id) = run.active_supervisor_session_id {
                println!("supervisor session: {supervisor_session_id}");
                println!("supervisor intake: xiezhi-supervisor-intake.md");
            }
            println!("workflow runtime: {:?}", workflow.agent_runtime.kind);
            if let Some(model) = workflow.agent_runtime.model {
                println!("workflow model: {model}");
            }
            println!("workflow workspace root: {}", workflow.workspace.root);
        }
        Some("workflow") => match args.next().as_deref() {
            Some("check") => {
                let path = args.next().unwrap_or_else(|| "XIEZHI.md".to_string());
                match load_workflow(&path) {
                    Ok(workflow) => {
                        println!("workflow: ok");
                        println!("runtime: {:?}", workflow.agent_runtime.kind);
                        println!("workspace root: {}", workflow.workspace.root);
                    }
                    Err(error) => {
                        eprintln!("workflow: invalid");
                        eprintln!("{error}");
                        std::process::exit(1);
                    }
                }
            }
            _ => {
                println!("usage: xiezhi workflow check [path]");
            }
        },
        Some("work") => match args.next().as_deref() {
            Some("list") => {
                let store = open_store_or_exit();
                let runs = store.list_work_runs().unwrap_or_else(|error| {
                    eprintln!("failed to list work runs: {error}");
                    std::process::exit(1);
                });
                if runs.is_empty() {
                    println!("no work runs");
                    return;
                }
                for summary in runs {
                    println!(
                        "{}  {:?}  {}  events:{}",
                        summary.run.id, summary.run.status, summary.item.title, summary.event_count
                    );
                }
            }
            Some("intake") => {
                let Some(id) = args.next() else {
                    eprintln!("usage: xiezhi work intake <run-id>");
                    std::process::exit(2);
                };
                let run_id = uuid::Uuid::parse_str(&id).unwrap_or_else(|error| {
                    eprintln!("invalid run id: {error}");
                    std::process::exit(2);
                });
                run_supervisor_intake_or_exit(run_id);
            }
            Some("decide") => {
                let Some(decision_id) = args.next() else {
                    eprintln!("usage: xiezhi work decide <decision-id> <option-id>");
                    std::process::exit(2);
                };
                let Some(option_id) = args.next() else {
                    eprintln!("usage: xiezhi work decide <decision-id> <option-id>");
                    std::process::exit(2);
                };
                let decision_id = uuid::Uuid::parse_str(&decision_id).unwrap_or_else(|error| {
                    eprintln!("invalid decision id: {error}");
                    std::process::exit(2);
                });
                resolve_decision_or_exit(decision_id, &option_id);
            }
            Some("show") => {
                let Some(id) = args.next() else {
                    eprintln!("usage: xiezhi work show <run-id>");
                    std::process::exit(2);
                };
                let run_id = uuid::Uuid::parse_str(&id).unwrap_or_else(|error| {
                    eprintln!("invalid run id: {error}");
                    std::process::exit(2);
                });
                let store = open_store_or_exit();
                let Some(run) = store.get_work_run(run_id).unwrap_or_else(|error| {
                    eprintln!("failed to load work run: {error}");
                    std::process::exit(1);
                }) else {
                    eprintln!("work run not found: {run_id}");
                    std::process::exit(1);
                };
                let events = store
                    .list_events_for_work_run(run.id)
                    .unwrap_or_else(|error| {
                        eprintln!("failed to load work run events: {error}");
                        std::process::exit(1);
                    });
                println!("work run: {}", run.id);
                println!("goal: {}", run.goal);
                println!("status: {:?}", run.status);
                if let Some(supervisor_session_id) = run.active_supervisor_session_id {
                    println!("active supervisor session: {supervisor_session_id}");
                }
                let supervisor_sessions = store
                    .list_supervisor_sessions_for_work_run(run.id)
                    .unwrap_or_else(|error| {
                        eprintln!("failed to load supervisor sessions: {error}");
                        std::process::exit(1);
                    });
                println!("supervisor sessions: {}", supervisor_sessions.len());
                for session in supervisor_sessions {
                    println!(
                        "- supervisor {:?} {:?} model:{}",
                        session.runtime,
                        session.status,
                        session.model.as_deref().unwrap_or("<default>")
                    );
                }
                let decision_points = store
                    .list_decision_points_for_work_run(run.id)
                    .unwrap_or_else(|error| {
                        eprintln!("failed to load decision points: {error}");
                        std::process::exit(1);
                    });
                println!("decision points: {}", decision_points.len());
                for decision in decision_points {
                    println!(
                        "- decision {} {:?} recommended:{} {}",
                        decision.id,
                        decision.status,
                        decision.recommended_option_id,
                        decision.problem
                    );
                    for option in decision.options {
                        let selected =
                            if decision.selected_option_id.as_deref() == Some(option.id.as_str()) {
                                " selected"
                            } else {
                                ""
                            };
                        println!(
                            "  - option {}{}: {} ({})",
                            option.id, selected, option.label, option.tradeoff
                        );
                    }
                }
                let execution_graphs = store
                    .list_execution_graphs_for_work_run(run.id)
                    .unwrap_or_else(|error| {
                        eprintln!("failed to load execution graphs: {error}");
                        std::process::exit(1);
                    });
                println!("execution graphs: {}", execution_graphs.len());
                for graph in execution_graphs {
                    println!(
                        "- graph {} {} status:{} nodes:{} edges:{}",
                        graph.id,
                        graph.version,
                        graph.status,
                        graph.nodes.len(),
                        graph.edges.len()
                    );
                }
                println!("events: {}", events.len());
                for event in events {
                    println!(
                        "- {:?} {}: {}",
                        event.actor, event.event_type, event.summary
                    );
                }
            }
            _ => {
                println!("usage:");
                println!("  xiezhi work list");
                println!("  xiezhi work show <run-id>");
                println!("  xiezhi work intake <run-id>");
                println!("  xiezhi work decide <decision-id> <option-id>");
            }
        },
        _ => {
            println!("xiezhi orchestration framework");
            println!();
            println!("usage:");
            println!("  xiezhi run <goal>");
            println!("  xiezhi work list");
            println!("  xiezhi work show <run-id>");
            println!("  xiezhi work intake <run-id>");
            println!("  xiezhi work decide <decision-id> <option-id>");
            println!("  xiezhi workflow check [path]");
            println!("  xiezhi --version");
        }
    }
}

fn open_store_or_exit() -> Store {
    Store::open(STATE_PATH).unwrap_or_else(|error| {
        eprintln!("failed to open local state store: {error}");
        std::process::exit(1);
    })
}

fn run_supervisor_intake_or_exit(run_id: uuid::Uuid) {
    let workflow = load_workflow("XIEZHI.md").ok().unwrap_or_default();
    let store = open_store_or_exit();
    let Some(mut run) = store.get_work_run(run_id).unwrap_or_else(|error| {
        eprintln!("failed to load work run: {error}");
        std::process::exit(1);
    }) else {
        eprintln!("work run not found: {run_id}");
        std::process::exit(1);
    };
    if run.status != WorkRunStatus::SupervisorIntake {
        eprintln!(
            "work run is not ready for supervisor intake: {:?}",
            run.status
        );
        std::process::exit(2);
    }
    let Some(workspace_id) = run.workspace_id else {
        eprintln!("work run has no workspace");
        std::process::exit(1);
    };
    let Some(workspace) = store.get_workspace(workspace_id).unwrap_or_else(|error| {
        eprintln!("failed to load workspace: {error}");
        std::process::exit(1);
    }) else {
        eprintln!("workspace not found: {workspace_id}");
        std::process::exit(1);
    };
    let prompt_path = format!("{}/xiezhi-supervisor-intake.md", workspace.path);
    let prompt = fs::read_to_string(&prompt_path).unwrap_or_else(|error| {
        eprintln!("failed to read supervisor intake prompt {prompt_path}: {error}");
        std::process::exit(1);
    });
    let output = run_supervisor_intake_command(
        &workflow.agent_runtime.command,
        &workspace.path,
        &prompt,
        workflow.agent_runtime.model.as_deref(),
    )
    .unwrap_or_else(|error| {
        eprintln!("failed to run supervisor intake command: {error}");
        std::process::exit(1);
    });
    let output_payload = serde_json::to_string(&output).unwrap_or_else(|error| {
        eprintln!("failed to encode runtime output: {error}");
        std::process::exit(1);
    });
    store
        .insert_event(&Event {
            id: uuid::Uuid::now_v7(),
            work_run_id: run.id,
            actor: EventActor::Runtime,
            event_type: "supervisor_intake_runtime_output".to_string(),
            summary: format!(
                "Supervisor intake command exited with {:?}; extracted {} structured event(s).",
                output.exit_code,
                output.structured_events.len()
            ),
            payload_json: Some(output_payload),
            created_at: time::OffsetDateTime::now_utc(),
        })
        .unwrap_or_else(|error| {
            eprintln!("failed to persist runtime output event: {error}");
            std::process::exit(1);
        });

    let mut saw_decision = false;
    let mut saw_ready_handoff = false;
    for event in &output.structured_events {
        persist_structured_runtime_event_or_exit(&store, &run, event);
        match event {
            RuntimeStructuredEvent::AgentDecisionPoint(_) => saw_decision = true,
            RuntimeStructuredEvent::SupervisorHandoff(handoff) if handoff.ready_to_normalize => {
                saw_ready_handoff = true;
            }
            _ => {}
        }
    }

    if !output.success() {
        transition_work_run(&mut run, WorkRunStatus::Failed).unwrap_or_else(|error| {
            eprintln!("failed to mark work run failed: {error}");
            std::process::exit(1);
        });
        store.update_work_run(&run).unwrap_or_else(|error| {
            eprintln!("failed to update failed work run: {error}");
            std::process::exit(1);
        });
    } else if saw_decision {
        transition_work_run(&mut run, WorkRunStatus::WaitingForDecision).unwrap_or_else(|error| {
            eprintln!("failed to transition work run to waiting for decision: {error}");
            std::process::exit(1);
        });
        store.update_work_run(&run).unwrap_or_else(|error| {
            eprintln!("failed to update work run: {error}");
            std::process::exit(1);
        });
    } else if saw_ready_handoff {
        transition_work_run(&mut run, WorkRunStatus::Planning).unwrap_or_else(|error| {
            eprintln!("failed to transition work run to planning: {error}");
            std::process::exit(1);
        });
        store.update_work_run(&run).unwrap_or_else(|error| {
            eprintln!("failed to update work run: {error}");
            std::process::exit(1);
        });
    }

    println!("work run: {}", run.id);
    println!("status: {:?}", run.status);
    println!("runtime exit: {:?}", output.exit_code);
    println!("structured events: {}", output.structured_events.len());
}

fn resolve_decision_or_exit(decision_id: uuid::Uuid, option_id: &str) {
    let store = open_store_or_exit();
    let Some(mut decision) = store
        .get_decision_point(decision_id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load decision point: {error}");
            std::process::exit(1);
        })
    else {
        eprintln!("decision point not found: {decision_id}");
        std::process::exit(1);
    };
    if decision.status != DecisionPointStatus::Pending {
        eprintln!("decision point is not pending: {:?}", decision.status);
        std::process::exit(2);
    }
    let Some(selected_option) = decision
        .options
        .iter()
        .find(|option| option.id == option_id)
        .cloned()
    else {
        eprintln!("unknown option id: {option_id}");
        eprintln!("available options:");
        for option in decision.options {
            eprintln!("  {} - {}", option.id, option.label);
        }
        std::process::exit(2);
    };

    decision.status = DecisionPointStatus::Resolved;
    decision.selected_option_id = Some(selected_option.id.clone());
    decision.resolved_at = Some(time::OffsetDateTime::now_utc());
    store
        .update_decision_point(&decision)
        .unwrap_or_else(|error| {
            eprintln!("failed to update decision point: {error}");
            std::process::exit(1);
        });
    store
        .insert_event(&Event {
            id: uuid::Uuid::now_v7(),
            work_run_id: decision.work_run_id,
            actor: EventActor::User,
            event_type: "decision_point_resolved".to_string(),
            summary: format!(
                "Selected option {} for decision: {}",
                selected_option.id, decision.problem
            ),
            payload_json: Some(
                serde_json::json!({
                    "decision_point_id": decision.id,
                    "selected_option": selected_option,
                })
                .to_string(),
            ),
            created_at: time::OffsetDateTime::now_utc(),
        })
        .unwrap_or_else(|error| {
            eprintln!("failed to persist decision resolution event: {error}");
            std::process::exit(1);
        });

    let mut run = store
        .get_work_run(decision.work_run_id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load work run: {error}");
            std::process::exit(1);
        })
        .unwrap_or_else(|| {
            eprintln!("work run not found: {}", decision.work_run_id);
            std::process::exit(1);
        });
    let pending_count = store
        .list_decision_points_for_work_run(run.id)
        .unwrap_or_else(|error| {
            eprintln!("failed to list decision points: {error}");
            std::process::exit(1);
        })
        .into_iter()
        .filter(|decision| decision.status == DecisionPointStatus::Pending)
        .count();
    if pending_count == 0 && run.status == WorkRunStatus::WaitingForDecision {
        transition_work_run(&mut run, WorkRunStatus::Planning).unwrap_or_else(|error| {
            eprintln!("failed to transition work run to planning: {error}");
            std::process::exit(1);
        });
        store.update_work_run(&run).unwrap_or_else(|error| {
            eprintln!("failed to update work run: {error}");
            std::process::exit(1);
        });
    }

    println!("decision point: {}", decision.id);
    println!("selected option: {}", selected_option.id);
    println!("work run: {}", run.id);
    println!("status: {:?}", run.status);
    println!("pending decisions: {pending_count}");
}

fn persist_structured_runtime_event_or_exit(
    store: &Store,
    run: &WorkRun,
    event: &RuntimeStructuredEvent,
) {
    match event {
        RuntimeStructuredEvent::AgentDecisionPoint(decision) => {
            let decision_point = DecisionPoint {
                id: uuid::Uuid::now_v7(),
                work_run_id: run.id,
                status: DecisionPointStatus::Pending,
                problem: decision.problem.clone(),
                impact: decision.impact.clone(),
                recommended_option_id: decision.recommended_option_id.clone(),
                options: decision
                    .options
                    .iter()
                    .map(|option| DecisionOption {
                        id: option.id.clone(),
                        label: option.label.clone(),
                        tradeoff: option.tradeoff.clone(),
                        plan_delta: option.plan_delta.clone(),
                    })
                    .collect(),
                selected_option_id: None,
                created_at: time::OffsetDateTime::now_utc(),
                resolved_at: None,
            };
            store
                .insert_decision_point(&decision_point)
                .unwrap_or_else(|error| {
                    eprintln!("failed to persist decision point: {error}");
                    std::process::exit(1);
                });
            store
                .insert_event(&Event {
                    id: uuid::Uuid::now_v7(),
                    work_run_id: run.id,
                    actor: EventActor::SupervisorAgent,
                    event_type: "decision_point_declared".to_string(),
                    summary: decision.problem.clone(),
                    payload_json: Some(
                        serde_json::json!({
                            "decision_point_id": decision_point.id,
                            "decision": decision,
                        })
                        .to_string(),
                    ),
                    created_at: time::OffsetDateTime::now_utc(),
                })
                .unwrap_or_else(|error| {
                    eprintln!("failed to persist decision event: {error}");
                    std::process::exit(1);
                });
        }
        RuntimeStructuredEvent::AgentProgressReport(progress) => {
            store
                .insert_event(&Event {
                    id: uuid::Uuid::now_v7(),
                    work_run_id: run.id,
                    actor: EventActor::SupervisorAgent,
                    event_type: "progress_reported".to_string(),
                    summary: progress.summary.clone(),
                    payload_json: Some(serde_json::to_string(progress).unwrap_or_else(|error| {
                        eprintln!("failed to encode progress report: {error}");
                        std::process::exit(1);
                    })),
                    created_at: time::OffsetDateTime::now_utc(),
                })
                .unwrap_or_else(|error| {
                    eprintln!("failed to persist progress event: {error}");
                    std::process::exit(1);
                });
        }
        RuntimeStructuredEvent::SupervisorHandoff(handoff) => {
            let graph_id = if handoff.ready_to_normalize {
                let graph = execution_graph_from_supervisor_handoff(run.id, handoff);
                let graph_id = graph.id;
                store
                    .insert_execution_graph(&graph)
                    .unwrap_or_else(|error| {
                        eprintln!("failed to persist execution graph: {error}");
                        std::process::exit(1);
                    });
                Some(graph_id)
            } else {
                None
            };
            store
                .insert_event(&Event {
                    id: uuid::Uuid::now_v7(),
                    work_run_id: run.id,
                    actor: EventActor::SupervisorAgent,
                    event_type: "supervisor_handoff".to_string(),
                    summary: handoff.summary.clone(),
                    payload_json: Some(
                        serde_json::json!({
                            "handoff": handoff,
                            "execution_graph_id": graph_id,
                        })
                        .to_string(),
                    ),
                    created_at: time::OffsetDateTime::now_utc(),
                })
                .unwrap_or_else(|error| {
                    eprintln!("failed to persist supervisor handoff event: {error}");
                    std::process::exit(1);
                });
            if let Some(graph_id) = graph_id {
                store
                    .insert_event(&Event {
                        id: uuid::Uuid::now_v7(),
                        work_run_id: run.id,
                        actor: EventActor::XieZhi,
                        event_type: "execution_graph_created".to_string(),
                        summary: "Created draft execution graph from supervisor handoff."
                            .to_string(),
                        payload_json: Some(
                            serde_json::json!({
                                "execution_graph_id": graph_id,
                            })
                            .to_string(),
                        ),
                        created_at: time::OffsetDateTime::now_utc(),
                    })
                    .unwrap_or_else(|error| {
                        eprintln!("failed to persist execution graph event: {error}");
                        std::process::exit(1);
                    });
            }
        }
    }
}

fn run_lifecycle_hook_or_exit(
    store: &Store,
    work_run_id: uuid::Uuid,
    name: &str,
    command: &str,
    cwd: &str,
) -> bool {
    let hook_output = HookRunner::run(name, command, cwd).unwrap_or_else(|error| {
        eprintln!("failed to run {name} hook: {error}");
        std::process::exit(1);
    });
    let success = hook_output.success();
    let payload = serde_json::to_string(&hook_output).unwrap_or_else(|error| {
        eprintln!("failed to encode hook evidence: {error}");
        std::process::exit(1);
    });
    store
        .insert_event(&Event {
            id: uuid::Uuid::now_v7(),
            work_run_id,
            actor: EventActor::XieZhi,
            event_type: format!("hook_{name}"),
            summary: hook_output.summary(),
            payload_json: Some(payload),
            created_at: time::OffsetDateTime::now_utc(),
        })
        .unwrap_or_else(|error| {
            eprintln!("failed to persist hook event: {error}");
            std::process::exit(1);
        });
    success
}

fn runtime_kind_from_workflow(kind: AgentRuntimeKind) -> RuntimeKind {
    match kind {
        AgentRuntimeKind::OpenCode => RuntimeKind::OpenCode,
        AgentRuntimeKind::Codex => RuntimeKind::Codex,
        AgentRuntimeKind::ClaudeCode => RuntimeKind::ClaudeCode,
    }
}
