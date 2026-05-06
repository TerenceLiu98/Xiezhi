# Governance

XieZhi is co-managed by the human and XieZhi, with optional delegation to the supervisor agent.

The supervisor agent is the first responsible contractor. XieZhi records authority boundaries and evidence. The human remains the final acceptance authority unless a workflow explicitly delegates acceptance.

## Modes

### co_managed

The human keeps direct control over material intent decisions.

The supervisor must declare DecisionPoints for:

- product shape
- architecture and technology stack
- UX and visual style
- MVP scope tradeoffs
- acceptance policy
- external side effects
- destructive actions

### delegated

The human delegates some decision authority to the supervisor.

Delegated decisions are allowed only inside the declared charter. The supervisor must still record:

- decision made
- rationale
- alternatives considered
- expected impact
- evidence or assumptions

If a decision exceeds the charter, the supervisor must escalate with a DecisionPoint.

## Delegation Charter

A workflow can define which decision categories are delegated and which require human confirmation.

Example:

```yaml
governance:
  mode: delegated
  require_human:
    - external_side_effects
    - destructive_actions
    - spending
    - final_acceptance
  delegated:
    - implementation_details
    - local_refactors
    - test_strategy
  decide_and_record:
    - tech_stack
    - ui_style
```

## Decision Types

### DecisionPoint

A DecisionPoint pauses the WorkRun for human input.

Use it when the supervisor needs user judgment.

### DelegatedDecision

A DelegatedDecision does not pause the WorkRun.

Use it when the supervisor decides inside its charter and must leave an audit trail.

### Escalation

An Escalation is required when:

- the supervisor cannot decide inside the charter
- available options materially change user intent
- external effects exceed policy
- proof cannot satisfy declared acceptance without changing scope

## XieZhi Rules

XieZhi should:

- enforce governance policy
- store all DecisionPoints and DelegatedDecisions
- show pending decisions clearly
- inject resolved decisions into later supervisor context
- reject actions that exceed policy without an explicit decision

XieZhi should not:

- invent product decisions
- silently select options in co-managed mode
- hide delegated decisions
- ask the user to resolve ordinary engineering blockers
