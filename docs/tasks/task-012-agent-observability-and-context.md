# Agent Observability and Context Tasks

Status: `todo`

## T114 Agent and task observability surfaces

- Priority: `P1`
- Phase: `12`
- Goal: expose enough visibility for humans to understand which agent is doing what, whether it is progressing, and what patch it proposed
- Deliverables:
  - `xiezhi agent list`
  - `xiezhi agent show <agent-id>`
  - task view integration with latest agent run and patch
- Acceptance:
  - operators can identify the active or latest agent for a task
  - operators can inspect runtime mode, latest patch id, and recent event summaries

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
