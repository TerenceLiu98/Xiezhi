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

## T116 Semantic guardrails in delegated execution

- Priority: `P1`
- Phase: `11`
- Goal: ensure delegated execution still respects AST-based scope and semantic policy, rather than regressing into free-form multi-agent coding
- Depends on: `T102`, `T112`, `T125`
- Deliverables:
  - semantic policy included in subagent assignments
  - verifier integration for delegated patches
  - supervisor checks for semantic drift between intended task and returned patch
- Acceptance:
  - subagent patches can be rejected for semantic scope drift even when a file is allowed
  - supervisor decisions use semantic evidence, not only runtime success or failure

## T120 Supervisor run skeleton

- Priority: `P0`
- Phase: `11`
- Goal: create the first usable `xiezhi supervisor run "<goal>"` path that generates or selects a DAG and assigns one ready task
- Deliverables:
  - CLI command skeleton
  - supervisor session creation
  - reuse of bootstrap or plan output as the initial DAG source
  - first ready-task selection
- Acceptance:
  - a broad goal can create a supervisor run record
  - the supervisor can identify the next executable task without a manual task id
  - the command returns clear next steps even before full autonomy exists

## T121 Agent run persistence MVP

- Priority: `P0`
- Phase: `11`
- Goal: make subagents first-class persisted execution records instead of only runtime command logs
- Deliverables:
  - `agent_runs` table or equivalent persisted model
  - runtime name, mode, task id, patch id, status, and timestamps
  - minimal agent event persistence
- Acceptance:
  - every delegated task run can be traced to an agent run
  - task and patch records can link back to the responsible subagent run

## T122 Assignment contract MVP

- Priority: `P0`
- Phase: `11`
- Goal: convert a ready task into a bounded subagent assignment that contains everything the worker needs to execute safely
- Deliverables:
  - assignment shape with goal, context, allowed files, forbidden files, acceptance, checks, and expected outputs
  - adapter mapping from assignment to existing runtime inputs
  - persisted assignment summary
- Acceptance:
  - subagents receive structured task contracts rather than only broad prompts
  - runtime adapters can execute an assignment without losing policy information

## T126 Note-taking MVP demo

- Priority: `P0`
- Phase: `11`
- Goal: create a repeatable PRD v2 demo using a simple React note-taking app and the request `add search and tags`
- Deliverables:
  - demo repo or fixture
  - supervisor run script
  - scoped tasks for search and tags
  - expected review and verification output
- Acceptance:
  - the demo shows main agent planning, subagent execution, patch capture, AST diff, and review
  - the output can demonstrate smaller, more traceable patches than a direct single-agent run
