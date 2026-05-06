# Roadmap

## Phase 0: Design Reset

Goal: establish XieZhi as a Rust + Tauri orchestration framework.

Deliverables:

- README
- architecture spec
- workflow spec
- runtime backend spec
- work run lifecycle

## Phase 1: Rust Core Skeleton

Goal: create a minimal Rust CLI and durable state model.

Deliverables:

- Cargo workspace: started
- `xiezhi` CLI: started
- local SQLite store: started
- WorkItem model: started
- WorkRun model: started
- Event model: started
- basic workflow parser: started

Next:

- add repository-local config discovery
- add `work show`
- add migration version tracking
- persist workspace, supervisor session, decision point, proof, and changeset tables
- move CLI argument parsing to a real command framework

## Phase 2: Run and Agent Workspace Orchestration

Goal: create and manage isolated run, agent, and proof workspaces.

Deliverables:

- workspace root config
- run workspace create/remove/archive
- agent workspace create/remove/archive
- proof workspace create/remove/archive
- lifecycle hooks
- command log evidence
- safe path policy
- graph task node materialization into AgentWorkspace + AgentRun
- one-step local orchestration driver for intake, dispatch, and planned agent execution
- workflow-declared command proof for captured ChangeSets
- verified ChangeSet promotion into the current target directory

## Phase 3: Supervisor Runtime

Goal: connect OpenCode as the first supervisor backend.

Deliverables:

- runtime backend trait
- OpenCode adapter
- model/provider config
- supervisor intake
- progress events
- decision point protocol

## Phase 4: Execution Graph and Proof

Goal: normalize supervisor plans into graph, workspace, and proof contracts.

Deliverables:

- ExecutionGraph model
- dependency validation
- task-to-AgentWorkspace materialization
- AgentRun dispatch skeleton
- scope declaration
- command proof
- changeset capture
- promotion gate

## Phase 5: Tauri Work Console

Goal: give users a clear local orchestration UI.

Deliverables:

- active WorkRun dashboard
- decision panel
- supervisor progress timeline
- subagent/activity view
- proof checklist
- graph drill-down

## Phase 6: Pomodoro Demo

Goal: rebuild the demo through the new orchestration system.

Acceptance:

```bash
xiezhi run "build a pomodoro app" --runtime opencode --ui
```

The run should:

- ask meaningful product/UX/validation decisions
- create a run workspace for supervisor coordination
- create isolated agent workspaces for subagent tasks
- run supervisor and implementation agents
- collect proof
- recover automatically from engineering blockers
- present final acceptance in the Tauri Work Console

## Phase 7: Tracker Integrations

Goal: support real team work queues.

Targets:

- markdown task files
- GitHub issues
- Linear
- Jira

## Phase 8: Advanced Guardrails

Goal: restore and improve XieZhi's original differentiation.

Deliverables:

- multi-language AST index
- semantic diff
- symbol scope declarations
- proof graph
- review/risk model
