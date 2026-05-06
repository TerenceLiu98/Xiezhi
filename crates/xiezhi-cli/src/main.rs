use std::env;

use xiezhi_core::{Event, EventActor, WorkItem, WorkRun};
use xiezhi_store::Store;
use xiezhi_workflow::load_workflow;

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
            let workflow = load_workflow("XIEZHI.md").ok();
            let store = Store::open(".xiezhi/state.sqlite").unwrap_or_else(|error| {
                eprintln!("failed to open local state store: {error}");
                std::process::exit(1);
            });
            let item = WorkItem::local_goal(goal);
            let run = WorkRun::new(item.id, item.title.clone());
            store.insert_work_item(&item).unwrap_or_else(|error| {
                eprintln!("failed to persist work item: {error}");
                std::process::exit(1);
            });
            store.insert_work_run(&run).unwrap_or_else(|error| {
                eprintln!("failed to persist work run: {error}");
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
            println!("created work item: {}", item.id);
            println!("created work run: {}", run.id);
            println!("status: {:?}", run.status);
            if let Some(workflow) = workflow {
                println!("workflow runtime: {:?}", workflow.agent_runtime.kind);
                println!("workflow workspace root: {}", workflow.workspace.root);
            } else {
                println!("workflow: default");
            }
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
        _ => {
            println!("xiezhi orchestration framework");
            println!();
            println!("usage:");
            println!("  xiezhi run <goal>");
            println!("  xiezhi workflow check [path]");
            println!("  xiezhi --version");
        }
    }
}
