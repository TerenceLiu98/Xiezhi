# XieZhi

XieZhi is a local-first orchestration framework for autonomous software work.

It runs supervisor agents against work items in isolated workspaces, records product decisions and engineering proof, constrains drift with DAG/AST/scope evidence, and lets humans manage acceptance instead of supervising code generation.

## Direction

XieZhi is being redesigned as a Rust + Tauri application.

- Rust core for orchestration, state machines, workspace isolation, runtime adapters, tracker integrations, proof collection, and durable storage.
- Tauri desktop app for the local Work Console.
- Agent runtimes such as OpenCode, Codex, and Claude Code as pluggable backends.
- Workflow configuration inspired by Symphony and Baton, but with XieZhi-specific DAG/AST/scope/proof guardrails.

## User Experience

The ordinary user entry point should feel like this:

```bash
xiezhi run "build a pomodoro app" --runtime opencode --ui
```

The current Rust skeleton already supports a smaller local command:

```bash
cargo run -p xiezhi-cli -- run "build a pomodoro app"
cargo run -p xiezhi-cli -- workflow check XIEZHI.md
```

`run` creates a local `WorkItem`, `WorkRun`, and audit `Event` in `.xiezhi/state.sqlite`. `workflow check` validates a workflow file with YAML front matter and supervisor instructions.

XieZhi should then:

1. Create or load a work item.
2. Create an isolated workspace.
3. Start a supervisor agent session.
4. Ask the user only for product, architecture, UX, or acceptance decisions.
5. Normalize the supervisor plan into an execution graph.
6. Run implementation work through agent backends.
7. Collect proof: checks, semantic diff, review, smoke tests, screenshots, app launch evidence, and promotion commits.
8. Recover automatically from ordinary engineering blockers.
9. Present final acceptance to the human.

## What XieZhi Is Not

- Not an app builder.
- Not a hardcoded planner.
- Not a replacement for OpenCode, Codex, or Claude Code.
- Not a product decision maker.
- Not a generic CI system.

XieZhi is the orchestration layer around autonomous implementation work.

## Design Docs

- [Architecture](docs/architecture.md)
- [Data Model](docs/data-model.md)
- [Workflow Spec](docs/workflow-spec.md)
- [Runtime Backends](docs/runtime-backends.md)
- [Work Run Lifecycle](docs/work-run-lifecycle.md)
- [Roadmap](docs/roadmap.md)
