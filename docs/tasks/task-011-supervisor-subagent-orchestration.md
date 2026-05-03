# Supervisor and Subagent Orchestration Tasks

Status: `todo`

## T110 Supervisor run loop and session model

- Priority: `P1`
- Phase: `11`
- Goal: introduce a top-level supervisor entrypoint that accepts a broad goal, creates or resumes a supervisor run, and drives task progression over time
- Deliverables:
  - `xiezhi supervisor run "<goal>"`
  - supervisor run persistence
  - resumable supervisor state
- Acceptance:
  - one supervisor run can be created from a broad user goal
  - the run can be resumed without losing DAG or task progression context

## T111 Subagent run persistence and event stream

- Priority: `P1`
- Phase: `11`
- Goal: persist subagent lifecycle, ownership, and intermediate execution signals so operators and the supervisor can inspect what happened
- Deliverables:
  - `agent_runs` storage model
  - `agent_events` storage model
  - status and heartbeat fields
- Acceptance:
  - every delegated run records agent identity, assigned task, runtime, and state
  - the system can reconstruct a concise execution history for one subagent

## T112 Subagent runtime contract and assignment adapter

- Priority: `P1`
- Phase: `11`
- Goal: upgrade runtime invocation from a one-off task run into a bounded subagent contract that carries goal, scope, rationale, and expected outputs
- Deliverables:
  - subagent assignment contract
  - runtime adapter inputs for delegated execution
  - normalized artifact return shape
- Acceptance:
  - subagents receive explicit task scope and expected outputs
  - returned artifacts can be consumed without runtime-specific logic leaking into the supervisor

## T113 DAG-to-assignment compiler

- Priority: `P1`
- Phase: `11`
- Goal: let the supervisor select ready tasks from the DAG and transform them into one or more subagent assignments
- Deliverables:
  - ready-task selection logic
  - assignment policy heuristics
  - dependency-safe delegation rules
- Acceptance:
  - the supervisor can choose a ready task without manual task id selection
  - dependencies prevent out-of-order assignment

## T114 Agent and task observability surfaces

- Priority: `P1`
- Phase: `11`
- Goal: expose enough visibility for humans to understand which agent is doing what, whether it is progressing, and what patch it proposed
- Deliverables:
  - `xiezhi agent list`
  - `xiezhi agent show <agent-id>`
  - `xiezhi task show <task-id>` or equivalent deep task view
- Acceptance:
  - operators can identify the active agent for a task
  - operators can inspect runtime mode, latest patch id, and recent event summaries

## T115 Supervisor decision engine and recovery loop

- Priority: `P1`
- Phase: `11`
- Goal: let the supervisor decide whether to accept, retry, split, reassign, or escalate after a subagent returns
- Deliverables:
  - structured supervisor decision model
  - retry or reassign policy
  - escalation summary surface
- Acceptance:
  - the supervisor can take at least accept, retry, and escalate actions based on returned evidence
  - operator-visible reasons exist for each decision

## T116 Semantic guardrails in delegated execution

- Priority: `P1`
- Phase: `11`
- Goal: ensure delegated execution still respects AST-based scope and semantic policy, rather than regressing into free-form multi-agent coding
- Deliverables:
  - semantic policy included in subagent assignments
  - verifier integration for delegated patches
  - supervisor checks for semantic drift between intended task and returned patch
- Acceptance:
  - subagent patches can be rejected for semantic scope drift even when a file is allowed
  - supervisor decisions use semantic evidence, not only runtime success or failure
