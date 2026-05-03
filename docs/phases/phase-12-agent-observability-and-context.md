# Phase 12: Agent Observability and Context

Status: `planned`

## Goal

Make agent work inspectable and give subagents enough structured context to complete bounded tasks without drifting from the main agent's intent.

## Scope

- deep task inspection
- agent run inspection
- runtime mode and command evidence in task and patch views
- context pack builder for subagent assignments
- event summaries for delegated execution
- session show and ready queue views for agent-controlled scheduling
- one-wave parallel `run-ready` execution with promotion-decision evidence
- clearer explanations of task goal, rationale, expected outputs, and allowed scope

## Deliverables

- `xiezhi task show <task-id>` or equivalent deep task view
- `xiezhi agent session show` and `xiezhi agent ready` basics
- `xiezhi agent run-ready` for one safe ready wave
- context pack builder with relevant files, symbols, acceptance criteria, checks, and constraints
- task list and patch views that expose latest runtime mode, changed file count, and empty-patch warnings
- compact event summaries for subagent execution

## Acceptance Criteria

- an operator can tell what a task is supposed to do before running it
- an operator can tell whether a subagent run used a real runtime or scaffold fallback
- an operator can inspect the latest agent run, patch id, command, and changed file count from CLI views
- a main agent can read ready tasks and scope conflicts as JSON
- warning promotions can be traced back to an agent decision
- subagent assignments carry structured context rather than only a broad prompt

## Dependencies

- Phase 9 for lifecycle and runtime evidence clarity
- Phase 11 for agent run and assignment foundations

## Primary Tasks

- `T114` agent and task observability surfaces
- `T119` task show deep view
- `T123` context pack builder
- `T124` ready queue and session show
- `T128` run-ready promotion decision loop
