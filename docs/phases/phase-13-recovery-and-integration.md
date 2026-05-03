# Phase 13: Recovery and Integration

Status: `planned`

## Goal

Let the agent recover from failed or incomplete task work by retrying, splitting, reassigning, escalating, or integrating patches with clear reasons, while XieZhi records the evidence.

## Scope

- agent decision evidence model
- retry and reassign policies
- task splitting for oversized or ambiguous work
- simple integration agent for patch conflicts
- failure recovery summaries
- cross-patch coordination and conflict checks

## Deliverables

- structured agent decision records
- `accept`, `retry`, `split`, `reassign`, and `escalate` decision paths
- task-splitting heuristics and persistence
- simple integration-agent flow for patch conflict or overlapping edits
- recovery-oriented review summaries

## Acceptance Criteria

- failed or empty patches produce explicit agent decisions rather than ambiguous terminal states
- the agent can split an oversized task into smaller task nodes
- the agent can retry or reassign a failed task with visible rationale
- integration conflicts are surfaced as structured work rather than silent patch drift

## Dependencies

- Phase 11 for agent session and assignment model
- Phase 12 for agent event visibility
- Phase 10 for semantic evidence used by recovery decisions

## Primary Tasks

- `T115` agent decision evidence and recovery loop
- `T124` agent decision loop MVP
- `T127` task split and retry policy
- `T128` simple integration agent
