# Phase 11: Supervisor and Subagent Orchestration

Status: `planned`

## Goal

Evolve XieZhi from a controlled task runner into a DAG- and AST-governed supervisor that understands user intent, decomposes work, and delegates bounded tasks to subagents.

## Scope

- supervisor-driven goal execution loop
- subagent assignment model and lifecycle tracking
- DAG-to-assignment orchestration
- live operator visibility into agent progress and decisions
- integration of semantic task policy into subagent execution
- first vertical-slice demo of main agent to one subagent to verified patch

## Deliverables

- architecture for `supervisor run` and resumable supervisor sessions
- persisted subagent run records and event streams
- assignment compiler that converts ready tasks into subagent contracts
- operator views for current agent, task, patch, and latest decision state
- note-taking MVP demo path for `add search and tags`

## Acceptance Criteria

- a broad goal can be executed through a supervisor entrypoint rather than manual one-task-at-a-time invocation
- the main agent owns intent understanding and DAG creation
- subagents execute only bounded tasks and return structured artifacts
- operators can tell which agent is active, what task it owns, and whether its runtime is real or scaffolded
- the supervisor can advance a task from ready to assigned to patched to verified based on returned evidence
- the first supervisor slice can assign one ready task without manual task id selection

## Dependencies

- Phase 9 for stable patch lifecycle, review evidence, and task or patch clarity
- Phase 10 for richer semantic scope, Intent IR, and DAG model foundations

## Primary Tasks

- `T110` supervisor run loop and session model
- `T111` subagent run persistence and event stream
- `T112` subagent runtime contract and assignment adapter
- `T113` DAG-to-assignment compiler
- `T116` semantic guardrails in delegated execution
- `T120` supervisor run skeleton
- `T121` agent run persistence MVP
- `T122` assignment contract MVP
- `T126` note-taking MVP demo
