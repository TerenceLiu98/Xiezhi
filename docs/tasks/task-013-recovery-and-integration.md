# Recovery and Integration Tasks

Status: `todo`

## T115 Agent decision evidence and recovery loop

- Priority: `P1`
- Phase: `13`
- Goal: let the agent decide whether to accept, retry, split, reassign, or escalate after a task run returns, while XieZhi records the evidence
- Deliverables:
  - structured agent decision evidence model
  - retry or reassign policy
  - escalation summary surface
- Acceptance:
  - the agent can take at least accept, retry, and escalate actions based on returned evidence
  - operator-visible reasons exist for each decision

## T124 Agent decision loop MVP

- Priority: `P0`
- Phase: `13`
- Goal: implement the first decision loop that consumes patch verification output and records an agent decision
- Deliverables:
  - decision states for accept, retry, split, and escalate
  - decision persistence
  - CLI rendering of the latest decision
- Acceptance:
  - empty patches and rejected patches lead to explicit agent decisions
  - accepted patches can advance the related task state

## T127 Task split and retry policy

- Priority: `P1`
- Phase: `13`
- Goal: let the agent recover from oversized or ambiguous tasks by splitting or retrying them with narrower scope
- Deliverables:
  - split-task heuristic
  - retry attempt tracking
  - generated child task records
- Acceptance:
  - the agent can split one task into smaller dependent tasks
  - retry attempts are visible and bounded

## T128 Simple integration agent

- Priority: `P2`
- Phase: `13`
- Goal: introduce a minimal integration path for conflicts or overlapping patches across subagent outputs
- Deliverables:
  - integration task type
  - conflict summary
  - integration assignment contract
- Acceptance:
  - overlapping patch conflicts create explicit integration work
  - integration changes are verified like normal subagent patches
