# Semantic Control and Planning Tasks

Status: `todo`

## T100 Intent IR v2 schema and persistence

- Priority: `P1`
- Phase: `10`
- Goal: expand Intent IR beyond file scope so tasks can express semantic scope, operation constraints, and richer rationale
- Deliverables:
  - code-node scope fields
  - allowed and forbidden operation fields
  - migration or compatibility path for existing persisted tasks
- Acceptance:
  - persisted Intent IR can represent file scope plus semantic scope
  - existing task records can still be loaded or upgraded safely

## T101 Semantic policy compiler

- Priority: `P1`
- Phase: `10`
- Goal: compile richer Intent IR into semantic allowlists and runtime or verifier inputs without leaking policy details into command code
- Deliverables:
  - semantic allowlist compilation
  - operation policy compilation
  - adapter hints that include semantic constraints where supported
- Acceptance:
  - policy compilation produces a stable semantic control surface for downstream verifier logic
  - runtime-specific differences stay isolated behind the compiler and adapters

## T102 Semantic scope verifier

- Priority: `P1`
- Phase: `10`
- Goal: detect out-of-scope semantic edits even when the changed file itself is allowed
- Deliverables:
  - symbol or code-node scope comparison
  - semantic out-of-scope violation type
  - clearer review messaging for semantic scope drift
- Acceptance:
  - verifier can reject or warn on semantic scope violations inside otherwise allowed files
  - operators can tell which symbol or code node triggered the violation

## T103 Planner-backed DAG generation

- Priority: `P1`
- Phase: `10`
- Goal: replace the current mostly fixed planning template with a planner path that can emit richer task structures and dependency shapes
- Deliverables:
  - planner prompt strategy
  - planner response normalization
  - fallback path when planner output is unusable
- Acceptance:
  - plans are not limited to one fixed trio of review, implement, and verify tasks
  - malformed planner output fails safely and recoverably

## T104 Richer DAG model and status transitions

- Priority: `P1`
- Phase: `10`
- Goal: align persisted DAG and task state more closely with the PRD model for design, constraint, risk, and patch-oriented task lifecycle
- Deliverables:
  - additional node and edge types where justified
  - richer task status transitions such as patched or failed
  - validation rules for the expanded graph model
- Acceptance:
  - DAG persistence can represent more of the PRD feature structure
  - task lifecycle can reflect patched and failed states without ambiguity

## T105 Risk and dependency heuristics

- Priority: `P2`
- Phase: `10`
- Goal: surface higher-signal warnings around dependency changes, risky modules, and unusually broad patch impact
- Deliverables:
  - dependency change warning
  - risky module warning
  - changed-file-count or churn warning
- Acceptance:
  - verifier can emit stable warning names for the key PRD heuristic signals
  - warnings are explainable and not overly noisy on normal patches

## T106 Acceptance traceability and goal-match scoring

- Priority: `P2`
- Phase: `10`
- Goal: connect acceptance criteria to test evidence and semantic changes so the operator can judge whether a patch really served the task goal
- Deliverables:
  - acceptance-to-test mapping heuristics
  - goal-match or semantic relevance scoring
  - review surfacing for weak requirement coverage
- Acceptance:
  - review output can show which acceptance criteria appear covered and which do not
  - low-confidence goal match is surfaced consistently as an operator signal
