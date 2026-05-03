# Phase 7: Runtime Integration

Status: `done`

## Goal

Replace scaffold-only execution with real runtime bridges while preserving XieZhi's execution-policy and verification model.

## Scope

- Capability-aware OpenCode bridge
- Headless Claude bridge
- Codex noninteractive bridge
- Runtime-specific policy compilation
- Real file-edit and approval capture
- Integration test matrix

## Deliverables

- Real Claude and Codex bridges that can edit the isolated task worktree
- Capability-aware OpenCode fallback when the CLI is unavailable
- Capability matrix for OpenCode, Claude, and Codex
- Integration tests that prove policy boundaries still hold under real execution

## Acceptance Criteria

- At least one runtime path produces real file edits inside the planned scope
- Unavailable runtimes fall back cleanly instead of breaking the task loop
- Runtime failures remain recoverable through `discard` and `retry`
- Verification and review remain unchanged at the contract level

## Dependencies

- Phase 6

## Primary Tasks

- `T070` OpenCode real execution bridge
- `T071` Claude headless execution bridge
- `T072` Codex noninteractive execution bridge
- `T073` runtime capability matrix
- `T074` file-edit and approval event capture
- `T075` runtime-specific policy compiler
- `T076` integration test matrix
