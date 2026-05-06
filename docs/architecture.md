# XieZhi Architecture

## Product Thesis

XieZhi helps a user manage autonomous software work instead of supervising an agent line by line.

The core loop is:

```text
WorkItem
  -> WorkRun
  -> Workspace
  -> SupervisorSession
  -> DecisionPoints
  -> ExecutionGraph
  -> AgentRuns
  -> ChangeSets
  -> Proof
  -> Promotion or Handoff
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

An isolated filesystem location for one WorkRun or AgentRun.

Workspace rules:

- agents work inside assigned workspaces
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

The normalized graph of work.

It can contain:

- goals
- features
- requirements
- tasks
- dependencies
- proof requirements
- workspaces
- changesets

The graph is not a product judge. It is a contract between what the agent declared and what actually happened.

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

## Design Influence

XieZhi should learn from:

- Symphony: managing implementation work rather than supervising agents.
- Baton: workflow files, tracker polling, isolated workspaces, runtime adapters, hooks, and state APIs.

XieZhi's differentiation is DAG/AST/scope/proof evidence as first-class orchestration data.

