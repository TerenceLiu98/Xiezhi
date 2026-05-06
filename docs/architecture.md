# XieZhi Architecture

## Product Thesis

XieZhi is a local-first contract orchestration framework for autonomous work.

The user and XieZhi co-manage a work order. The supervisor agent is the first responsible contractor. Subagents are recruited by the supervisor to complete scoped parts of the work. XieZhi records the contract, constrains execution through DAG/domain evidence, and manages acceptance.

The core loop is:

```text
WorkItem
  -> WorkRun
  -> RunWorkspace
  -> SupervisorSession
  -> Governance / DecisionPoints
  -> Contract ExecutionGraph
  -> AgentWorkspace + AgentRun per task/subagent
  -> ChangeSets
  -> Proof
  -> Promotion or Acceptance Handoff
```

## Stack

XieZhi v2 uses Rust and Tauri.

### Rust Core

The Rust core owns:

- orchestration state machine
- durable local database
- workspace lifecycle
- runtime backend processes
- tracker integrations
- workflow parsing
- hooks
- proof collection
- patch/change capture
- DAG validation
- AST indexing and semantic diff
- HTTP/API surface for the UI

### Tauri Work Console

The Tauri app owns:

- work run dashboard
- pending decision UI
- supervisor progress timeline
- subagent/activity view
- proof checklist
- workspace and patch inspection
- execution graph drill-down
- final acceptance flow

The UI should not make orchestration decisions. It displays state and collects human decisions.

## Responsibility Model

### Human

The human is the owner and final acceptance authority.

The human may:

- co-manage product, architecture, UX, and acceptance decisions
- delegate decision authority within a declared charter
- accept, reject, or request follow-up work

### XieZhi

XieZhi is the general contractor governance layer.

XieZhi owns:

- durable state
- governance policy
- decision recording
- contract DAG validation
- workspace isolation
- proof and evidence collection
- promotion and acceptance gates
- UI/API for inspection and intervention

XieZhi does not own product judgment. It requires agents to make judgment explicit and accountable.

### Supervisor Agent

The supervisor agent is the first responsible contractor.

The supervisor owns:

- intake and context exploration
- assumptions and risk reporting
- decision point declaration
- delegated decision rationale
- subagent recruitment plan
- contract DAG proposal
- progress reporting
- recovery proposals

### Subagents

Subagents are task-specific execution workers recruited by the supervisor.

Each subagent should run in its own isolated agent workspace. A subagent produces a ChangeSet and proof evidence, not direct writes to the target repository.

## Core Objects

### WorkItem

A unit of work that XieZhi can orchestrate.

Initial sources:

- local natural-language goal
- markdown task file

Future sources:

- GitHub issue
- Linear issue
- Jira issue

### WorkRun

A durable orchestration attempt for a WorkItem.

A WorkRun can be resumed, paused, cancelled, retried, archived, or completed.

### Workspace

An isolated filesystem location for coordination, execution, or proof.

Workspace kinds:

- `run`: supervisor coordination workspace for the WorkRun
- `agent`: isolated subagent workspace for one AgentRun
- `proof`: isolated verification/review/smoke workspace

Workspace rules:

- supervisor intake and coordination happen in the run workspace
- each subagent writes only inside its assigned agent workspace
- parent repository writes are controlled by XieZhi
- promotion is explicit
- failed workspaces are retained for inspection
- completed workspaces can be cleaned by policy

### SupervisorSession

The main agent session.

The supervisor agent owns:

- repository exploration
- product and architecture assumptions
- decision point declaration
- subagent strategy
- execution graph proposal
- progress reporting
- recovery proposals

XieZhi owns:

- protocol validation
- state persistence
- workspace isolation
- evidence collection
- guardrail enforcement
- user-facing orchestration UI

### ExecutionGraph

The normalized contract graph declared by the supervisor.

It can contain:

- goals
- features
- requirements
- tasks
- dependencies
- proof requirements
- workspaces
- changesets

The graph is not XieZhi's product plan. It is the supervisor's contract. XieZhi validates graph consistency, dependencies, scope declarations, workspace materialization, and proof requirements.

Task nodes are materialized into:

```text
ExecutionGraph task node
  -> AgentWorkspace
  -> AgentRun
  -> ChangeSet
  -> Proof
```

### Proof

Proof is the evidence that work is acceptable.

Proof types:

- command check
- semantic diff
- scope verdict
- code review
- screenshot
- app launch smoke
- manual walkthrough
- promotion commit
- tracker update

## Domain Constraints

AST evidence is one domain constraint adapter for software work. XieZhi should support other domain constraint adapters over time:

- code AST and semantic diff
- email thread and recipient policy
- document structure and citation evidence
- CRM entity and stage policy
- calendar availability and scheduling rules
- deployment, cost, and external side-effect controls

The DAG is the cross-domain control surface. Domain adapters attach evidence to the DAG.

## Design Influence

XieZhi should learn from:

- Symphony: managing implementation work rather than supervising agents.
- Baton: workflow files, tracker polling, isolated workspaces, runtime adapters, hooks, and state APIs.

XieZhi learns from Symphony's isolated workspace runner model, especially the idea that autonomous work should happen in controlled workspaces rather than directly in the target repository.

XieZhi's differentiation is governance, delegation, contract DAGs, domain constraints, and acceptance evidence as first-class orchestration data.
