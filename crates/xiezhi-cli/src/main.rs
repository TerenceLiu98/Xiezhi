use std::env;

use xiezhi_core::{WorkItem, WorkRun};

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
            let item = WorkItem::local_goal(goal);
            let run = WorkRun::new(item.id, item.title.clone());
            println!("created work item: {}", item.id);
            println!("created work run: {}", run.id);
            println!("status: {:?}", run.status);
        }
        _ => {
            println!("xiezhi orchestration framework");
            println!();
            println!("usage:");
            println!("  xiezhi run <goal>");
            println!("  xiezhi --version");
        }
    }
}

