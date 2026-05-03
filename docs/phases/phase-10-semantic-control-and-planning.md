# Phase 10: Semantic Control and Planning

Status: `planned`

## Goal

Move XieZhi from alpha-grade file-scoped control toward the fuller PRD shape: richer planning, semantic scope control, and stronger requirement-to-code traceability.

## Scope

- richer Feature DAG and Task DAG structure
- Intent IR v2 with code-node and operation scope
- semantic policy compilation
- semantic scope verification
- planner-backed DAG generation beyond fixed templates
- acceptance-to-test traceability and goal-match heuristics
- MVP-grade symbol scope enforcement for delegated subagent work

## Deliverables

- Intent IR schema that carries code-node scope and operation constraints
- semantic allowlist compiler that lowers intent into verifier and runtime inputs
- verifier support for symbol or code-node scope violations
- planner output that can emit richer task structures and dependency shapes
- traceability views that connect requirement, task, patch, and verification evidence
- multi-language semantic adapters for TS/TSX/JS/JSX/Python
- semantic scope verifier focused on file-allowed but symbol-out-of-scope edits

## Acceptance Criteria

- tasks can carry file scope plus semantic scope in persisted planning data
- verifier can flag a semantic out-of-scope change even when the file itself is allowed, including Python symbols
- unsupported languages are reported as file-only semantic coverage
- planner can generate more than the current fixed review, implement, and verify task trio
- operators can inspect how acceptance criteria map to tests and patch evidence
- patches can be rejected or warned when they modify symbols outside the task contract

## Dependencies

- Phase 9 for a stable post-alpha control loop
- Phase 2 and Phase 3 for indexed code context and planning persistence

## Primary Tasks

- `T100` Intent IR v2 schema and persistence
- `T101` semantic policy compiler
- `T102` semantic scope verifier
- `T103` planner-backed DAG generation
- `T104` richer DAG model and status transitions
- `T105` risk and dependency heuristics
- `T106` acceptance traceability and goal-match scoring
- `T125` MVP semantic scope verifier
- `T126` Tree-sitter language adapter framework
- `T127` Python semantic scope smoke
