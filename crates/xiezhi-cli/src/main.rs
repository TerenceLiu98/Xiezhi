use std::env;

use xiezhi_core::{
    Event, EventActor, RuntimeKind, SupervisorSession, SupervisorSessionStatus, WorkItem, WorkRun,
    WorkRunStatus, transition_work_run,
};
use xiezhi_hooks::HookRunner;
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
            }
        },
        _ => {
            println!("xiezhi orchestration framework");
            println!();
            println!("usage:");
            println!("  xiezhi run <goal>");
            println!("  xiezhi work list");
            println!("  xiezhi work show <run-id>");
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
