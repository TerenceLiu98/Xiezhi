# Phase 1: Local Core

## Goal

Establish the core local execution substrate before AI planning or runtime integration becomes deep.

## Scope

- Define persistent data models for features, tasks, patches, checks, and violations
- Implement repository discovery and local project metadata
- Implement git worktree lifecycle
- Define shared runtime interfaces and event types
- Create patch persistence and command log storage

## Deliverables

- Worktree manager can create, inspect, and delete task worktrees
- Core records can be stored and loaded from SQLite
- Shared `CodingRuntime` interfaces are stable enough for adapter implementation
- CLI commands can read and write real persisted state

## Acceptance Criteria

- A task-scoped worktree can be created and cleaned up safely
- Base commit and worktree path are recorded for every run attempt
- All later phases can rely on stable storage and runtime contracts without reworking the DB schema

## Dependencies

- Phase 0

## Primary Tasks

- `T010` finalize SQLite schema for features, dag nodes, tasks, patches, checks, violations
- `T011` repository metadata service
- `T012` worktree manager
- `T013` patch record service
- `T014` command log model and persistence
- `T015` shared runtime contracts and normalized event model
- `T016` failure taxonomy and error-to-user-message mapping
