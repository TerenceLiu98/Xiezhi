# XieZhi

XieZhi is a local-first contract orchestration framework for autonomous work.

It lets humans and XieZhi co-manage work orders while a supervisor agent acts as the first responsible contractor. The supervisor recruits subagents, each subagent works in an isolated workspace, and XieZhi records decisions, contract DAGs, proof, domain constraints, and acceptance evidence.

## Direction

XieZhi is being redesigned as a Rust + Tauri application.

- Rust core for orchestration, state machines, workspace isolation, runtime adapters, tracker integrations, proof collection, and durable storage.
- Tauri desktop app for the local Work Console.
- Agent runtimes such as OpenCode, Codex, and Claude Code as pluggable backends.
- Workflow configuration inspired by Symphony and Baton, but with XieZhi-specific governance, delegation, contract DAG, domain constraint, and acceptance guardrails.

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

`run` currently creates a local `WorkItem`, `WorkRun`, isolated run `Workspace`, lifecycle hook evidence, a `SupervisorSession`, and a `xiezhi-supervisor-intake.md` prompt artifact inside the run workspace.

`workflow check` validates a workflow file with YAML front matter and supervisor instructions.

Useful inspection commands:

```bash
cargo run -p xiezhi-cli -- work list
cargo run -p xiezhi-cli -- work show <run-id>
cargo run -p xiezhi-cli -- work intake <run-id>
cargo run -p xiezhi-cli -- work decide <decision-id> <option-id>
cargo run -p xiezhi-cli -- work dispatch <run-id>
cargo run -p xiezhi-cli -- agent run <agent-run-id>
cargo run -p xiezhi-cli -- work step <run-id>
cargo run -p xiezhi-cli -- proof run <changeset-id>
cargo run -p xiezhi-cli -- changeset promote <changeset-id>
cargo run -p xiezhi-cli -- work accept <run-id>
```

`work step` advances one safe orchestration step based on current state: supervisor intake,
dispatching task nodes into agent workspaces, running the next planned agent, or running proof for
the next captured changeset, or promoting the next verified changeset. It stops for human decision
points instead of auto-selecting them.

`work accept` is the current human acceptance close-out: once proof has passed and promoted
changesets have moved the run to `HumanAcceptance`, it marks the WorkRun `Completed`.

XieZhi should then:

1. Create or load a work item.
2. Create an isolated run workspace.
3. Start a supervisor agent session.
4. Ask the user only for product, architecture, UX, or acceptance decisions.
5. Normalize the supervisor plan into an execution graph.
6. Materialize task nodes into isolated agent workspaces.
7. Run implementation work through agent backends.
8. Collect proof: checks, semantic diff, review, smoke tests, screenshots, app launch evidence, and promotion commits.
9. Recover automatically from ordinary engineering blockers.
10. Present final acceptance to the human.

## What XieZhi Is Not

- Not an app builder.
- Not a hardcoded planner.
- Not a replacement for OpenCode, Codex, or Claude Code.
- Not a product decision maker.
- Not a generic CI system.

XieZhi is the governance and orchestration layer around autonomous work.

## Design Docs

- [Architecture](docs/architecture.md)
- [Data Model](docs/data-model.md)
- [Governance](docs/governance.md)
- [Workspace Isolation](docs/workspace-isolation.md)
- [Contract DAG](docs/contract-dag.md)
- [Workflow Spec](docs/workflow-spec.md)
- [Runtime Backends](docs/runtime-backends.md)
- [Work Run Lifecycle](docs/work-run-lifecycle.md)
- [Symphony Comparison](docs/symphony-comparison.md)
- [Roadmap](docs/roadmap.md)
