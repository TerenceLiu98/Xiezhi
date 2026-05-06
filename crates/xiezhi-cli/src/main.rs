use std::{
    collections::HashSet,
    env, fs,
    path::{Component, Path},
    process::Command,
};

use xiezhi_core::{
    AgentRole, AgentRun, AgentRunStatus, ChangeSet, ChangeSetStatus, DecisionOption, DecisionPoint,
    DecisionPointStatus, Event, EventActor, GraphNodeKind, Proof, ProofStatus, ProofType,
    RuntimeKind, SupervisorSession, SupervisorSessionStatus, WorkItem, WorkRun, WorkRunStatus,
    transition_work_run,
};
use xiezhi_hooks::HookRunner;
use xiezhi_runtime::{
    RuntimeStructuredEvent, SupervisorIntakeInput, build_supervisor_intake_prompt,
    execution_graph_from_supervisor_handoff, run_agent_command, run_supervisor_intake_command,
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
            Some("dispatch") => {
                let Some(id) = args.next() else {
                    eprintln!("usage: xiezhi work dispatch <run-id>");
                    std::process::exit(2);
                };
                let run_id = uuid::Uuid::parse_str(&id).unwrap_or_else(|error| {
                    eprintln!("invalid run id: {error}");
                    std::process::exit(2);
                });
                dispatch_work_run_or_exit(run_id);
            }
            Some("step") => {
                let Some(id) = args.next() else {
                    eprintln!("usage: xiezhi work step <run-id>");
                    std::process::exit(2);
                };
                let run_id = uuid::Uuid::parse_str(&id).unwrap_or_else(|error| {
                    eprintln!("invalid run id: {error}");
                    std::process::exit(2);
                });
                step_work_run_or_exit(run_id);
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
                let agent_runs =
                    store
                        .list_agent_runs_for_work_run(run.id)
                        .unwrap_or_else(|error| {
                            eprintln!("failed to load agent runs: {error}");
                            std::process::exit(1);
                        });
                println!("agent runs: {}", agent_runs.len());
                for agent_run in agent_runs {
                    println!(
                        "- agent {} task:{} workspace:{} role:{:?} status:{:?} runtime:{:?} model:{}",
                        agent_run.id,
                        agent_run
                            .execution_graph_node_id
                            .map(|id| id.to_string())
                            .unwrap_or_else(|| "<none>".to_string()),
                        agent_run.workspace_id,
                        agent_run.role,
                        agent_run.status,
                        agent_run.runtime,
                        agent_run.model.as_deref().unwrap_or("<default>")
                    );
                }
                let changesets =
                    store
                        .list_changesets_for_work_run(run.id)
                        .unwrap_or_else(|error| {
                            eprintln!("failed to load changesets: {error}");
                            std::process::exit(1);
                        });
                println!("changesets: {}", changesets.len());
                for changeset in changesets {
                    println!(
                        "- changeset {} agent:{} workspace:{} status:{:?} files:{}",
                        changeset.id,
                        changeset.agent_run_id,
                        changeset.workspace_id,
                        changeset.status,
                        changeset.changed_files.len()
                    );
                    for changed_file in changeset.changed_files {
                        println!("  - {changed_file}");
                    }
                }
                let proofs = store
                    .list_proofs_for_work_run(run.id)
                    .unwrap_or_else(|error| {
                        eprintln!("failed to load proofs: {error}");
                        std::process::exit(1);
                    });
                println!("proofs: {}", proofs.len());
                for proof in proofs {
                    println!(
                        "- proof {} changeset:{} type:{:?} status:{:?} {}",
                        proof.id,
                        proof
                            .changeset_id
                            .map(|id| id.to_string())
                            .unwrap_or_else(|| "<none>".to_string()),
                        proof.proof_type,
                        proof.status,
                        proof.summary
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
                println!("  xiezhi work dispatch <run-id>");
                println!("  xiezhi work step <run-id>");
            }
        },
        Some("agent") => match args.next().as_deref() {
            Some("run") => {
                let Some(id) = args.next() else {
                    eprintln!("usage: xiezhi agent run <agent-run-id>");
                    std::process::exit(2);
                };
                let agent_run_id = uuid::Uuid::parse_str(&id).unwrap_or_else(|error| {
                    eprintln!("invalid agent run id: {error}");
                    std::process::exit(2);
                });
                run_agent_run_or_exit(agent_run_id);
            }
            _ => {
                println!("usage:");
                println!("  xiezhi agent run <agent-run-id>");
            }
        },
        Some("proof") => match args.next().as_deref() {
            Some("run") => {
                let Some(id) = args.next() else {
                    eprintln!("usage: xiezhi proof run <changeset-id>");
                    std::process::exit(2);
                };
                let changeset_id = uuid::Uuid::parse_str(&id).unwrap_or_else(|error| {
                    eprintln!("invalid changeset id: {error}");
                    std::process::exit(2);
                });
                run_changeset_proof_or_exit(changeset_id);
            }
            _ => {
                println!("usage:");
                println!("  xiezhi proof run <changeset-id>");
            }
        },
        Some("changeset") => match args.next().as_deref() {
            Some("promote") => {
                let Some(id) = args.next() else {
                    eprintln!("usage: xiezhi changeset promote <changeset-id>");
                    std::process::exit(2);
                };
                let changeset_id = uuid::Uuid::parse_str(&id).unwrap_or_else(|error| {
                    eprintln!("invalid changeset id: {error}");
                    std::process::exit(2);
                });
                promote_changeset_or_exit(changeset_id);
            }
            _ => {
                println!("usage:");
                println!("  xiezhi changeset promote <changeset-id>");
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
            println!("  xiezhi work dispatch <run-id>");
            println!("  xiezhi work step <run-id>");
            println!("  xiezhi agent run <agent-run-id>");
            println!("  xiezhi proof run <changeset-id>");
            println!("  xiezhi changeset promote <changeset-id>");
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

fn step_work_run_or_exit(run_id: uuid::Uuid) {
    let store = open_store_or_exit();
    let run = store
        .get_work_run(run_id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load work run: {error}");
            std::process::exit(1);
        })
        .unwrap_or_else(|| {
            eprintln!("work run not found: {run_id}");
            std::process::exit(1);
        });

    match run.status {
        WorkRunStatus::SupervisorIntake => {
            println!("next action: supervisor intake");
            run_supervisor_intake_or_exit(run.id);
        }
        WorkRunStatus::WaitingForDecision => {
            let pending = store
                .list_decision_points_for_work_run(run.id)
                .unwrap_or_else(|error| {
                    eprintln!("failed to list decision points: {error}");
                    std::process::exit(1);
                })
                .into_iter()
                .filter(|decision| decision.status == DecisionPointStatus::Pending)
                .collect::<Vec<_>>();
            println!("next action: waiting for decision");
            for decision in pending {
                println!(
                    "- decision {} recommended:{} {}",
                    decision.id, decision.recommended_option_id, decision.problem
                );
            }
        }
        WorkRunStatus::Planning => {
            let graphs = store
                .list_execution_graphs_for_work_run(run.id)
                .unwrap_or_else(|error| {
                    eprintln!("failed to load execution graphs: {error}");
                    std::process::exit(1);
                });
            let graph = graphs
                .iter()
                .rev()
                .find(|graph| graph.status == "draft")
                .or_else(|| graphs.last())
                .unwrap_or_else(|| {
                    eprintln!(
                        "planning run has no execution graph; run `xiezhi work intake {}` first",
                        run.id
                    );
                    std::process::exit(2);
                });
            let task_node_ids = graph
                .nodes
                .iter()
                .filter(|node| node.kind == GraphNodeKind::Task)
                .map(|node| node.id)
                .collect::<HashSet<_>>();
            if task_node_ids.is_empty() {
                eprintln!("execution graph {} has no task nodes", graph.id);
                std::process::exit(2);
            }
            let agent_runs = store
                .list_agent_runs_for_work_run(run.id)
                .unwrap_or_else(|error| {
                    eprintln!("failed to list agent runs: {error}");
                    std::process::exit(1);
                });
            let materialized_task_node_ids = agent_runs
                .iter()
                .filter_map(|agent_run| agent_run.execution_graph_node_id)
                .collect::<HashSet<_>>();
            if task_node_ids
                .iter()
                .any(|task_node_id| !materialized_task_node_ids.contains(task_node_id))
            {
                println!("next action: dispatch");
                dispatch_work_run_or_exit(run.id);
                return;
            }
            if let Some(agent_run) = agent_runs
                .iter()
                .find(|agent_run| agent_run.status == AgentRunStatus::Planned)
            {
                println!("next action: agent run {}", agent_run.id);
                run_agent_run_or_exit(agent_run.id);
                return;
            }
            let changesets = store
                .list_changesets_for_work_run(run.id)
                .unwrap_or_else(|error| {
                    eprintln!("failed to list changesets: {error}");
                    std::process::exit(1);
                });
            if let Some(changeset) = changesets
                .iter()
                .find(|changeset| changeset.status == ChangeSetStatus::Captured)
            {
                println!("next action: proof run {}", changeset.id);
                run_changeset_proof_or_exit(changeset.id);
                return;
            }
            if let Some(changeset) = changesets
                .iter()
                .find(|changeset| changeset.status == ChangeSetStatus::Verified)
            {
                println!("next action: changeset promote {}", changeset.id);
                promote_changeset_or_exit(changeset.id);
                return;
            }
            println!("next action: none");
            println!(
                "all latest graph task nodes are dispatched, with no planned agent run or promotable changeset left"
            );
        }
        _ => {
            println!("next action: none");
            println!("work run status: {:?}", run.status);
        }
    }
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

fn dispatch_work_run_or_exit(run_id: uuid::Uuid) {
    let workflow = load_workflow("XIEZHI.md").ok().unwrap_or_default();
    let store = open_store_or_exit();
    let run = store
        .get_work_run(run_id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load work run: {error}");
            std::process::exit(1);
        })
        .unwrap_or_else(|| {
            eprintln!("work run not found: {run_id}");
            std::process::exit(1);
        });
    if run.status != WorkRunStatus::Planning {
        eprintln!("work run is not ready for dispatch: {:?}", run.status);
        std::process::exit(2);
    }
    let graphs = store
        .list_execution_graphs_for_work_run(run.id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load execution graphs: {error}");
            std::process::exit(1);
        });
    let graph = graphs
        .iter()
        .rev()
        .find(|graph| graph.status == "draft")
        .or_else(|| graphs.last())
        .unwrap_or_else(|| {
            eprintln!(
                "work run has no execution graph; run `xiezhi work intake {}` first",
                run.id
            );
            std::process::exit(2);
        });
    let task_nodes = graph
        .nodes
        .iter()
        .filter(|node| node.kind == GraphNodeKind::Task)
        .collect::<Vec<_>>();
    if task_nodes.is_empty() {
        eprintln!("execution graph {} has no task nodes to dispatch", graph.id);
        std::process::exit(2);
    }

    let workspace_manager =
        WorkspaceManager::from_config(&workflow.workspace).unwrap_or_else(|error| {
            eprintln!("failed to prepare workspace manager: {error}");
            std::process::exit(1);
        });
    let supervisor_session = run.active_supervisor_session_id.and_then(|_| {
        store
            .list_supervisor_sessions_for_work_run(run.id)
            .ok()
            .and_then(|sessions| sessions.into_iter().last())
    });
    let runtime = supervisor_session
        .as_ref()
        .map(|session| session.runtime)
        .unwrap_or_else(|| runtime_kind_from_workflow(workflow.agent_runtime.kind));
    let model = supervisor_session
        .as_ref()
        .and_then(|session| session.model.clone())
        .or_else(|| workflow.agent_runtime.model.clone());

    let mut created = 0usize;
    let mut skipped = 0usize;
    for task_node in task_nodes {
        if store
            .get_agent_run_for_graph_node(run.id, task_node.id)
            .unwrap_or_else(|error| {
                eprintln!("failed to check existing agent run: {error}");
                std::process::exit(1);
            })
            .is_some()
        {
            skipped += 1;
            continue;
        }

        let workspace = workspace_manager
            .create_agent_workspace(&run, task_node.id)
            .unwrap_or_else(|error| {
                eprintln!("failed to create agent workspace: {error}");
                std::process::exit(1);
            });
        store.insert_workspace(&workspace).unwrap_or_else(|error| {
            eprintln!("failed to persist agent workspace: {error}");
            std::process::exit(1);
        });
        let agent_run = AgentRun {
            id: uuid::Uuid::now_v7(),
            work_run_id: run.id,
            execution_graph_node_id: Some(task_node.id),
            workspace_id: workspace.id,
            runtime,
            model: model.clone(),
            role: AgentRole::Implementation,
            status: AgentRunStatus::Planned,
            started_at: time::OffsetDateTime::now_utc(),
            ended_at: None,
        };
        store.insert_agent_run(&agent_run).unwrap_or_else(|error| {
            eprintln!("failed to persist agent run: {error}");
            std::process::exit(1);
        });
        store
            .insert_event(&Event {
                id: uuid::Uuid::now_v7(),
                work_run_id: run.id,
                actor: EventActor::XieZhi,
                event_type: "agent_workspace_created".to_string(),
                summary: format!("Created agent workspace for task {}.", task_node.title),
                payload_json: Some(
                    serde_json::json!({
                        "execution_graph_id": graph.id,
                        "execution_graph_node_id": task_node.id,
                        "workspace_id": workspace.id,
                        "workspace_path": workspace.path,
                    })
                    .to_string(),
                ),
                created_at: time::OffsetDateTime::now_utc(),
            })
            .unwrap_or_else(|error| {
                eprintln!("failed to persist agent workspace event: {error}");
                std::process::exit(1);
            });
        store
            .insert_event(&Event {
                id: uuid::Uuid::now_v7(),
                work_run_id: run.id,
                actor: EventActor::XieZhi,
                event_type: "agent_run_planned".to_string(),
                summary: format!("Planned agent run for task {}.", task_node.title),
                payload_json: Some(
                    serde_json::json!({
                        "agent_run_id": agent_run.id,
                        "execution_graph_node_id": task_node.id,
                        "workspace_id": workspace.id,
                        "runtime": format!("{:?}", agent_run.runtime),
                        "model": agent_run.model,
                        "role": format!("{:?}", agent_run.role),
                    })
                    .to_string(),
                ),
                created_at: time::OffsetDateTime::now_utc(),
            })
            .unwrap_or_else(|error| {
                eprintln!("failed to persist agent run event: {error}");
                std::process::exit(1);
            });
        created += 1;
    }

    println!("work run: {}", run.id);
    println!("execution graph: {}", graph.id);
    println!("created: {created}");
    println!("skipped: {skipped}");
}

fn run_agent_run_or_exit(agent_run_id: uuid::Uuid) {
    let workflow = load_workflow("XIEZHI.md").ok().unwrap_or_default();
    let store = open_store_or_exit();
    let mut agent_run = store
        .get_agent_run(agent_run_id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load agent run: {error}");
            std::process::exit(1);
        })
        .unwrap_or_else(|| {
            eprintln!("agent run not found: {agent_run_id}");
            std::process::exit(1);
        });
    if agent_run.status != AgentRunStatus::Planned {
        eprintln!("agent run is not planned: {:?}", agent_run.status);
        std::process::exit(2);
    }
    let workspace = store
        .get_workspace(agent_run.workspace_id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load agent workspace: {error}");
            std::process::exit(1);
        })
        .unwrap_or_else(|| {
            eprintln!("agent workspace not found: {}", agent_run.workspace_id);
            std::process::exit(1);
        });
    let assignment = build_agent_assignment(&agent_run, &workspace);
    let assignment_path = format!("{}/xiezhi-agent-assignment.md", workspace.path);
    fs::write(&assignment_path, &assignment).unwrap_or_else(|error| {
        eprintln!("failed to write agent assignment: {error}");
        std::process::exit(1);
    });

    agent_run.status = AgentRunStatus::Running;
    agent_run.started_at = time::OffsetDateTime::now_utc();
    store.update_agent_run(&agent_run).unwrap_or_else(|error| {
        eprintln!("failed to mark agent run running: {error}");
        std::process::exit(1);
    });
    store
        .insert_event(&Event {
            id: uuid::Uuid::now_v7(),
            work_run_id: agent_run.work_run_id,
            actor: EventActor::XieZhi,
            event_type: "agent_run_started".to_string(),
            summary: format!("Started agent run {}.", agent_run.id),
            payload_json: Some(
                serde_json::json!({
                    "agent_run_id": agent_run.id,
                    "workspace_id": workspace.id,
                    "assignment_path": assignment_path,
                })
                .to_string(),
            ),
            created_at: time::OffsetDateTime::now_utc(),
        })
        .unwrap_or_else(|error| {
            eprintln!("failed to persist agent run start event: {error}");
            std::process::exit(1);
        });

    let output = run_agent_command(
        &workflow.agent_runtime.command,
        &workspace.path,
        &assignment,
        agent_run.model.as_deref(),
    )
    .unwrap_or_else(|error| {
        eprintln!("failed to run agent command: {error}");
        std::process::exit(1);
    });
    let output_payload = serde_json::to_string(&output).unwrap_or_else(|error| {
        eprintln!("failed to encode agent runtime output: {error}");
        std::process::exit(1);
    });
    store
        .insert_event(&Event {
            id: uuid::Uuid::now_v7(),
            work_run_id: agent_run.work_run_id,
            actor: EventActor::Runtime,
            event_type: "agent_run_runtime_output".to_string(),
            summary: format!(
                "Agent command exited with {:?}; extracted {} structured event(s).",
                output.exit_code,
                output.structured_events.len()
            ),
            payload_json: Some(output_payload),
            created_at: time::OffsetDateTime::now_utc(),
        })
        .unwrap_or_else(|error| {
            eprintln!("failed to persist agent runtime output: {error}");
            std::process::exit(1);
        });

    let changed_files = collect_workspace_changed_files(&workspace.path).unwrap_or_else(|error| {
        eprintln!("failed to collect workspace changes: {error}");
        std::process::exit(1);
    });
    let changeset_id = if output.success() {
        let now = time::OffsetDateTime::now_utc();
        let changeset = ChangeSet {
            id: uuid::Uuid::now_v7(),
            work_run_id: agent_run.work_run_id,
            agent_run_id: agent_run.id,
            workspace_id: workspace.id,
            status: ChangeSetStatus::Captured,
            changed_files,
            diff_ref: None,
            created_at: now,
            updated_at: now,
        };
        store.insert_changeset(&changeset).unwrap_or_else(|error| {
            eprintln!("failed to persist changeset: {error}");
            std::process::exit(1);
        });
        store
            .insert_event(&Event {
                id: uuid::Uuid::now_v7(),
                work_run_id: agent_run.work_run_id,
                actor: EventActor::XieZhi,
                event_type: "changeset_captured".to_string(),
                summary: format!(
                    "Captured changeset with {} file(s).",
                    changeset.changed_files.len()
                ),
                payload_json: Some(
                    serde_json::json!({
                        "changeset_id": changeset.id,
                        "agent_run_id": changeset.agent_run_id,
                        "workspace_id": changeset.workspace_id,
                        "changed_files": changeset.changed_files,
                    })
                    .to_string(),
                ),
                created_at: time::OffsetDateTime::now_utc(),
            })
            .unwrap_or_else(|error| {
                eprintln!("failed to persist changeset event: {error}");
                std::process::exit(1);
            });
        Some(changeset.id)
    } else {
        None
    };

    agent_run.status = if output.success() {
        AgentRunStatus::Completed
    } else {
        AgentRunStatus::Failed
    };
    agent_run.ended_at = Some(time::OffsetDateTime::now_utc());
    store.update_agent_run(&agent_run).unwrap_or_else(|error| {
        eprintln!("failed to update agent run completion: {error}");
        std::process::exit(1);
    });
    store
        .insert_event(&Event {
            id: uuid::Uuid::now_v7(),
            work_run_id: agent_run.work_run_id,
            actor: EventActor::XieZhi,
            event_type: "agent_run_finished".to_string(),
            summary: format!(
                "Agent run {} finished as {:?}.",
                agent_run.id, agent_run.status
            ),
            payload_json: Some(
                serde_json::json!({
                    "agent_run_id": agent_run.id,
                    "status": format!("{:?}", agent_run.status),
                    "exit_code": output.exit_code,
                    "changeset_id": changeset_id,
                })
                .to_string(),
            ),
            created_at: time::OffsetDateTime::now_utc(),
        })
        .unwrap_or_else(|error| {
            eprintln!("failed to persist agent run finish event: {error}");
            std::process::exit(1);
        });

    println!("agent run: {}", agent_run.id);
    println!("status: {:?}", agent_run.status);
    println!("runtime exit: {:?}", output.exit_code);
    println!("workspace: {}", workspace.path);
    if let Some(changeset_id) = changeset_id {
        println!("changeset: {changeset_id}");
    }
}

fn run_changeset_proof_or_exit(changeset_id: uuid::Uuid) {
    let workflow = load_workflow("XIEZHI.md").ok().unwrap_or_default();
    let store = open_store_or_exit();
    let mut changeset = store
        .get_changeset(changeset_id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load changeset: {error}");
            std::process::exit(1);
        })
        .unwrap_or_else(|| {
            eprintln!("changeset not found: {changeset_id}");
            std::process::exit(1);
        });
    if changeset.status != ChangeSetStatus::Captured {
        eprintln!("changeset is not captured: {:?}", changeset.status);
        std::process::exit(2);
    }
    let workspace = store
        .get_workspace(changeset.workspace_id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load changeset workspace: {error}");
            std::process::exit(1);
        })
        .unwrap_or_else(|| {
            eprintln!("workspace not found: {}", changeset.workspace_id);
            std::process::exit(1);
        });

    store
        .insert_event(&Event {
            id: uuid::Uuid::now_v7(),
            work_run_id: changeset.work_run_id,
            actor: EventActor::XieZhi,
            event_type: "proof_run_started".to_string(),
            summary: format!("Started proof for changeset {}.", changeset.id),
            payload_json: Some(
                serde_json::json!({
                    "changeset_id": changeset.id,
                    "workspace_id": workspace.id,
                    "workspace_path": workspace.path,
                })
                .to_string(),
            ),
            created_at: time::OffsetDateTime::now_utc(),
        })
        .unwrap_or_else(|error| {
            eprintln!("failed to persist proof start event: {error}");
            std::process::exit(1);
        });

    let mut proof_count = 0usize;
    let mut all_passed = true;
    if workflow.proof.required.is_empty() {
        let proof = Proof {
            id: uuid::Uuid::now_v7(),
            work_run_id: changeset.work_run_id,
            changeset_id: Some(changeset.id),
            proof_type: ProofType::ScopeVerdict,
            status: ProofStatus::Passed,
            summary: "No workflow proof requirements declared.".to_string(),
            metadata_json: Some(
                serde_json::json!({
                    "changed_files": changeset.changed_files,
                })
                .to_string(),
            ),
            created_at: time::OffsetDateTime::now_utc(),
        };
        store.insert_proof(&proof).unwrap_or_else(|error| {
            eprintln!("failed to persist proof: {error}");
            std::process::exit(1);
        });
        proof_count += 1;
    } else {
        for requirement in &workflow.proof.required {
            let proof_type = proof_type_from_requirement(&requirement.proof_type);
            let (status, summary, metadata_json) = if requirement.proof_type == "command" {
                if let Some(command) = requirement.command.as_ref() {
                    let output = Command::new("sh")
                        .arg("-c")
                        .arg(command)
                        .current_dir(&workspace.path)
                        .output()
                        .unwrap_or_else(|error| {
                            eprintln!("failed to run proof command: {error}");
                            std::process::exit(1);
                        });
                    let exit_code = output.status.code();
                    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    let status = if output.status.success() {
                        ProofStatus::Passed
                    } else {
                        all_passed = false;
                        ProofStatus::Failed
                    };
                    (
                        status,
                        format!("Command proof `{command}` exited with {exit_code:?}."),
                        serde_json::json!({
                            "command": command,
                            "exit_code": exit_code,
                            "stdout": stdout,
                            "stderr": stderr,
                        })
                        .to_string(),
                    )
                } else {
                    all_passed = false;
                    (
                        ProofStatus::Blocked,
                        "Command proof is missing a command.".to_string(),
                        serde_json::json!({
                            "requirement": requirement,
                        })
                        .to_string(),
                    )
                }
            } else {
                all_passed = false;
                (
                    ProofStatus::Blocked,
                    format!(
                        "Proof type `{}` is declared but not executable in the CLI skeleton.",
                        requirement.proof_type
                    ),
                    serde_json::json!({
                        "requirement": requirement,
                    })
                    .to_string(),
                )
            };
            let proof = Proof {
                id: uuid::Uuid::now_v7(),
                work_run_id: changeset.work_run_id,
                changeset_id: Some(changeset.id),
                proof_type,
                status,
                summary,
                metadata_json: Some(metadata_json),
                created_at: time::OffsetDateTime::now_utc(),
            };
            store.insert_proof(&proof).unwrap_or_else(|error| {
                eprintln!("failed to persist proof: {error}");
                std::process::exit(1);
            });
            proof_count += 1;
        }
    }

    changeset.status = if all_passed {
        ChangeSetStatus::Verified
    } else {
        ChangeSetStatus::Held
    };
    changeset.updated_at = time::OffsetDateTime::now_utc();
    store.update_changeset(&changeset).unwrap_or_else(|error| {
        eprintln!("failed to update changeset: {error}");
        std::process::exit(1);
    });
    store
        .insert_event(&Event {
            id: uuid::Uuid::now_v7(),
            work_run_id: changeset.work_run_id,
            actor: EventActor::XieZhi,
            event_type: "proof_run_finished".to_string(),
            summary: format!(
                "Proof finished for changeset {} as {:?}.",
                changeset.id, changeset.status
            ),
            payload_json: Some(
                serde_json::json!({
                    "changeset_id": changeset.id,
                    "status": format!("{:?}", changeset.status),
                    "proof_count": proof_count,
                })
                .to_string(),
            ),
            created_at: time::OffsetDateTime::now_utc(),
        })
        .unwrap_or_else(|error| {
            eprintln!("failed to persist proof finish event: {error}");
            std::process::exit(1);
        });

    println!("changeset: {}", changeset.id);
    println!("status: {:?}", changeset.status);
    println!("proofs: {proof_count}");
}

fn proof_type_from_requirement(value: &str) -> ProofType {
    match value {
        "semantic_diff" => ProofType::SemanticDiff,
        "scope_verdict" => ProofType::ScopeVerdict,
        "review" => ProofType::Review,
        "screenshot" => ProofType::Screenshot,
        "app_launch" => ProofType::AppLaunch,
        "manual_walkthrough" => ProofType::ManualWalkthrough,
        "promotion_commit" => ProofType::PromotionCommit,
        "tracker_update" => ProofType::TrackerUpdate,
        _ => ProofType::Command,
    }
}

fn promote_changeset_or_exit(changeset_id: uuid::Uuid) {
    let store = open_store_or_exit();
    let mut changeset = store
        .get_changeset(changeset_id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load changeset: {error}");
            std::process::exit(1);
        })
        .unwrap_or_else(|| {
            eprintln!("changeset not found: {changeset_id}");
            std::process::exit(1);
        });
    if changeset.status != ChangeSetStatus::Verified {
        eprintln!("changeset is not verified: {:?}", changeset.status);
        std::process::exit(2);
    }
    let workspace = store
        .get_workspace(changeset.workspace_id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load changeset workspace: {error}");
            std::process::exit(1);
        })
        .unwrap_or_else(|| {
            eprintln!("workspace not found: {}", changeset.workspace_id);
            std::process::exit(1);
        });
    let target_root = env::current_dir().unwrap_or_else(|error| {
        eprintln!("failed to resolve target root: {error}");
        std::process::exit(1);
    });
    let mut promoted_files = Vec::new();
    for changed_file in &changeset.changed_files {
        if !is_safe_promotable_path(changed_file) {
            eprintln!("unsafe changed file path cannot be promoted: {changed_file}");
            std::process::exit(2);
        }
        let source = Path::new(&workspace.path).join(changed_file);
        let target = target_root.join(changed_file);
        if !source.is_file() {
            eprintln!(
                "changed file is missing from workspace: {}",
                source.display()
            );
            std::process::exit(2);
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).unwrap_or_else(|error| {
                eprintln!("failed to create target directory: {error}");
                std::process::exit(1);
            });
        }
        fs::copy(&source, &target).unwrap_or_else(|error| {
            eprintln!("failed to promote {}: {error}", changed_file);
            std::process::exit(1);
        });
        promoted_files.push(changed_file.clone());
    }

    changeset.status = ChangeSetStatus::Promoted;
    changeset.updated_at = time::OffsetDateTime::now_utc();
    store.update_changeset(&changeset).unwrap_or_else(|error| {
        eprintln!("failed to update changeset: {error}");
        std::process::exit(1);
    });
    store
        .insert_event(&Event {
            id: uuid::Uuid::now_v7(),
            work_run_id: changeset.work_run_id,
            actor: EventActor::XieZhi,
            event_type: "changeset_promoted".to_string(),
            summary: format!(
                "Promoted changeset {} with {} file(s).",
                changeset.id,
                promoted_files.len()
            ),
            payload_json: Some(
                serde_json::json!({
                    "changeset_id": changeset.id,
                    "workspace_id": workspace.id,
                    "target_root": target_root,
                    "promoted_files": promoted_files,
                })
                .to_string(),
            ),
            created_at: time::OffsetDateTime::now_utc(),
        })
        .unwrap_or_else(|error| {
            eprintln!("failed to persist promotion event: {error}");
            std::process::exit(1);
        });
    maybe_transition_to_human_acceptance(&store, changeset.work_run_id);

    println!("changeset: {}", changeset.id);
    println!("status: {:?}", changeset.status);
    println!("promoted files: {}", promoted_files.len());
    for promoted_file in promoted_files {
        println!("- {promoted_file}");
    }
}

fn maybe_transition_to_human_acceptance(store: &Store, work_run_id: uuid::Uuid) {
    let mut run = store
        .get_work_run(work_run_id)
        .unwrap_or_else(|error| {
            eprintln!("failed to load work run: {error}");
            std::process::exit(1);
        })
        .unwrap_or_else(|| {
            eprintln!("work run not found: {work_run_id}");
            std::process::exit(1);
        });
    if run.status != WorkRunStatus::Planning {
        return;
    }
    let pending_decisions = store
        .list_decision_points_for_work_run(run.id)
        .unwrap_or_else(|error| {
            eprintln!("failed to list decision points: {error}");
            std::process::exit(1);
        })
        .into_iter()
        .any(|decision| decision.status == DecisionPointStatus::Pending);
    if pending_decisions {
        return;
    }
    let agent_runs = store
        .list_agent_runs_for_work_run(run.id)
        .unwrap_or_else(|error| {
            eprintln!("failed to list agent runs: {error}");
            std::process::exit(1);
        });
    if agent_runs.is_empty()
        || agent_runs
            .iter()
            .any(|agent_run| agent_run.status != AgentRunStatus::Completed)
    {
        return;
    }
    let changesets = store
        .list_changesets_for_work_run(run.id)
        .unwrap_or_else(|error| {
            eprintln!("failed to list changesets: {error}");
            std::process::exit(1);
        });
    if changesets.is_empty()
        || changesets
            .iter()
            .any(|changeset| changeset.status != ChangeSetStatus::Promoted)
    {
        return;
    }

    for status in [
        WorkRunStatus::Executing,
        WorkRunStatus::Verifying,
        WorkRunStatus::HumanAcceptance,
    ] {
        transition_work_run(&mut run, status).unwrap_or_else(|error| {
            eprintln!("failed to transition work run: {error}");
            std::process::exit(1);
        });
    }
    store.update_work_run(&run).unwrap_or_else(|error| {
        eprintln!("failed to update work run: {error}");
        std::process::exit(1);
    });
    store
        .insert_event(&Event {
            id: uuid::Uuid::now_v7(),
            work_run_id: run.id,
            actor: EventActor::XieZhi,
            event_type: "human_acceptance_ready".to_string(),
            summary: "All agent runs completed and all changesets promoted.".to_string(),
            payload_json: Some(
                serde_json::json!({
                    "status": format!("{:?}", run.status),
                })
                .to_string(),
            ),
            created_at: time::OffsetDateTime::now_utc(),
        })
        .unwrap_or_else(|error| {
            eprintln!("failed to persist human acceptance event: {error}");
            std::process::exit(1);
        });
}

fn is_safe_promotable_path(path: &str) -> bool {
    let path = Path::new(path);
    if path.is_absolute() {
        return false;
    }
    let mut components = path.components();
    let Some(first_component) = components.next() else {
        return false;
    };
    if matches!(first_component, Component::CurDir | Component::ParentDir) {
        return false;
    }
    if first_component.as_os_str() == ".xiezhi" {
        return false;
    }
    !path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn collect_workspace_changed_files(workspace_path: &str) -> std::io::Result<Vec<String>> {
    let mut changed_files = Vec::new();
    collect_workspace_changed_files_inner(
        Path::new(workspace_path),
        Path::new(workspace_path),
        &mut changed_files,
    )?;
    changed_files.sort();
    Ok(changed_files)
}

fn collect_workspace_changed_files_inner(
    root: &Path,
    current: &Path,
    changed_files: &mut Vec<String>,
) -> std::io::Result<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name == "xiezhi-workspace.json" || file_name == "xiezhi-agent-assignment.md" {
            continue;
        }
        if path.is_dir() {
            collect_workspace_changed_files_inner(root, &path, changed_files)?;
            continue;
        }
        if path.is_file() {
            if let Ok(relative) = path.strip_prefix(root) {
                changed_files.push(relative.to_string_lossy().to_string());
            }
        }
    }
    Ok(())
}

fn build_agent_assignment(agent_run: &AgentRun, workspace: &xiezhi_core::Workspace) -> String {
    format!(
        r#"# XieZhi Agent Assignment

## AgentRun

- agent_run_id: {agent_run_id}
- work_run_id: {work_run_id}
- execution_graph_node_id: {execution_graph_node_id}
- role: {role:?}
- runtime: {runtime:?}
- model: {model}

## Workspace

- workspace_id: {workspace_id}
- workspace_path: {workspace_path}

## Instructions

Work only inside the assigned agent workspace. Do not write directly to the target repository or another agent workspace.

This skeleton run captures command output and agent status only. ChangeSet capture and proof collection happen in a later phase.
"#,
        agent_run_id = agent_run.id,
        work_run_id = agent_run.work_run_id,
        execution_graph_node_id = agent_run
            .execution_graph_node_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "<none>".to_string()),
        role = agent_run.role,
        runtime = agent_run.runtime,
        model = agent_run.model.as_deref().unwrap_or("<default>"),
        workspace_id = workspace.id,
        workspace_path = workspace.path,
    )
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
