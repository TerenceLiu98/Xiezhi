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
- retry, reassign, split, and escalate decisions at the supervisor layer

## Deliverables

- architecture for `supervisor run` and resumable supervisor sessions
- persisted subagent run records and event streams
- assignment compiler that converts ready tasks into subagent contracts
- operator views for current agent, task, patch, and latest decision state
- supervisor decision loop that can accept, retry, or escalate task outcomes

## Acceptance Criteria

- a broad goal can be executed through a supervisor entrypoint rather than manual one-task-at-a-time invocation
- the main agent owns intent understanding and DAG creation
- subagents execute only bounded tasks and return structured artifacts
- operators can tell which agent is active, what task it owns, and whether its runtime is real or scaffolded
- the supervisor can advance a task from ready to assigned to patched to verified based on returned evidence

## Dependencies

- Phase 9 for stable patch lifecycle, review evidence, and task or patch clarity
- Phase 10 for richer semantic scope, Intent IR, and DAG model foundations

## Primary Tasks

- `T110` supervisor run loop and session model
- `T111` subagent run persistence and event stream
- `T112` subagent runtime contract and assignment adapter
- `T113` DAG-to-assignment compiler
- `T114` agent and task observability surfaces
- `T115` supervisor decision engine and recovery loop
- `T116` semantic guardrails in delegated execution
