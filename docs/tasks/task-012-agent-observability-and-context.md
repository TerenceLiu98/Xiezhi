# Agent Observability and Context Tasks

Status: `todo`

## T114 Agent and task observability surfaces

- Priority: `P1`
- Phase: `12`
- Goal: expose enough visibility for humans to understand which agent is doing what, whether it is progressing, and what patch it proposed
- Deliverables:
  - `xiezhi agent session show`
  - `xiezhi agent ready`
  - task view integration with latest agent run and patch
- Acceptance:
  - operators can identify the active or latest agent for a task
  - operators can inspect runtime mode, latest patch id, and recent event summaries
  - main agents can consume ready queue JSON with scope compatibility

## T119 Task show deep view

- Priority: `P0`
- Phase: `12`
- Goal: give operators a single command that explains what a task is supposed to do and what evidence exists so far
- Deliverables:
  - `xiezhi task show <task-id>`
  - goal, summary, rationale, acceptance, scope, expected outputs, and checks
  - latest patch, runtime mode, command, changed files, and verification status
- Acceptance:
  - a user can understand task intent before running it
  - a user can understand latest execution evidence without reading raw database rows

## T123 Context Pack Builder

- Priority: `P1`
- Phase: `12`
- Goal: build structured context packs for subagents so they receive task-specific repository context and constraints
- Deliverables:
  - context pack object or artifact
  - relevant files and symbols
  - task rationale and acceptance criteria
  - verification commands and policy constraints
- Acceptance:
  - subagent assignments can include a context pack
  - the context pack is inspectable by the operator
  - context generation stays bounded by the task scope

## T124 Ready Queue and Session Show

- Priority: `P0`
- Phase: `12`
- Goal: expose machine-readable DAG readiness for main agents and readable session evidence for operators
- Deliverables:
  - `xiezhi agent ready [feature-id] [--json]`
  - `xiezhi agent session show [session-id] [--json]`
  - task status counts, latest patches, warnings, blocking violations, and promotion decisions
- Acceptance:
  - ready tasks include `canRunWith`
  - completed features do not show promoted tasks as next up

## T128 Run-ready Promotion Decision Loop

- Priority: `P1`
- Phase: `12`
- Goal: allow a main agent to run one safe ready wave while preserving XieZhi guardrails
- Deliverables:
  - `xiezhi agent run-ready --parallel <n> --auto`
  - scope conflict filtering
  - strict `PromotionDecision v1` for warning patches
- Acceptance:
  - clean patches can promote automatically
  - warning patches require agent decision evidence
  - blocking patches cannot be promoted
