# Phase 4: Execution

## Goal

Run one task through a controlled coding runtime and capture a patch plus execution evidence.

## Scope

- Runtime adapter framework
- Execution policy compiler
- OpenCode adapter as the first deep integration
- Thin Claude and Codex adapters after OpenCode works
- Task execution orchestration
- Patch capture and retry/discard lifecycle

## Deliverables

- `xiezhi agent run <task-id> --runtime opencode` works end-to-end
- Runtime events are normalized into XieZhi-owned event types
- Execution policy is compiled from Intent IR
- Patch, logs, and usage are persisted

## Acceptance Criteria

- A single task can execute inside a dedicated worktree
- Runtime-specific outputs are normalized before verification
- The system can switch runtime implementations without changing planner, verifier, or report code

## Dependencies

- Phase 1
- Phase 3

## Primary Tasks

- `T040` runtime shared interfaces and normalizers
- `T041` execution policy compiler
- `T042` task run orchestrator
- `T043` OpenCode adapter
- `T044` Claude adapter
- `T045` Codex adapter using SDK or exec mode
- `T046` patch capture and persistence
- `T047` patch discard and retry flow
