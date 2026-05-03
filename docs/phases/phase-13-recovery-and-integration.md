# Phase 13: Recovery and Integration

Status: `planned`

## Goal

Let the supervisor recover from failed or incomplete subagent work by retrying, splitting, reassigning, escalating, or integrating patches with clear reasons.

## Scope

- supervisor decision model
- retry and reassign policies
- task splitting for oversized or ambiguous work
- simple integration agent for patch conflicts
- failure recovery summaries
- cross-patch coordination and conflict checks

## Deliverables

- structured supervisor decision records
- `accept`, `retry`, `split`, `reassign`, and `escalate` decision paths
- task-splitting heuristics and persistence
- simple integration-agent flow for patch conflict or overlapping edits
- recovery-oriented review summaries

## Acceptance Criteria

- failed or empty patches produce supervisor decisions rather than ambiguous terminal states
- the supervisor can split an oversized task into smaller task nodes
- the supervisor can retry or reassign a failed task with visible rationale
- integration conflicts are surfaced as structured work rather than silent patch drift

## Dependencies

- Phase 11 for supervisor session and assignment model
- Phase 12 for agent event visibility
- Phase 10 for semantic evidence used by recovery decisions

## Primary Tasks

- `T115` supervisor decision engine and recovery loop
- `T124` supervisor decision loop MVP
- `T127` task split and retry policy
- `T128` simple integration agent
