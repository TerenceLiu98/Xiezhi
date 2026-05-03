# Phase 11: Agent Framework Session Model

Status: `planned`

## Goal

Replace built-in planning and hardcoded orchestration behavior with an agent-framework loop. External agents create plans and make orchestration decisions; XieZhi validates those plans into DAG/AST-backed state and records task execution evidence.

## Scope

- `xiezhi agent plan "<goal>" --runtime opencode`
- strict `AgentPlan v1` validation and import
- `agent_sessions` persistence for planning evidence
- assignment contracts linked to agent sessions and tasks
- `xiezhi agent run <task-id> --runtime opencode`
- operator views through `dag show`, `task list`, `task show`, verification, review, and patch promotion

## Non-Goals

- No legacy heuristic planner command.
- No greenfield scaffold generator command.
- No built-in ready-task orchestration loop.
- No built-in product decision about whether a demo app is good enough.

## Acceptance Criteria

- a valid AgentPlan JSON creates a feature DAG, task DAG, Intent IR v2, and task policies
- malformed JSON, missing scope, missing acceptance, unknown dependencies, cycles, and unsafe paths are rejected
- an agent task run creates an assignment, agent run, runtime evidence, and patch evidence
- `task show` exposes scope, symbols, acceptance, checks, latest patch, runtime evidence, violations, and next actions
- `patch promote` can move verified tracked and untracked worktree changes back to the target repository
- the note-taking MVP demo can be rebuilt from an empty local repo through the agent-driven loop

## Primary Tasks

- `T110` AgentPlan schema and importer
- `T111` agent session persistence and evidence
- `T112` assignment contract compiler
- `T113` agent run command and runtime integration
- `T114` task inspection and evidence display
- `T115` patch promotion
- `T116` semantic file and symbol guardrails
- `T126` note-taking MVP demo reset and smoke path
