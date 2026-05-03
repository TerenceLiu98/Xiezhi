# Phase 6: Alpha Hardening

## Goal

Turn the working prototype into a stable alpha that satisfies the PRD release bar.

## Scope

- Multi-runtime smoke coverage
- Fixture repos and regression tests
- CLI output hardening
- Failure recovery polish
- Documentation and demo script
- Alpha release checklist

## Deliverables

- Alpha release checklist document
- Three fixture repos or equivalent demo targets
- One accepted patch demo and one rejected patch demo
- Regression coverage for planner, runtime normalization, semantic diff, and verifier
- Operator-facing alpha docs in `docs/alpha/`

## Acceptance Criteria

- The alpha release criteria in the PRD are satisfied
- At least OpenCode plus one additional runtime path are demoable
- Failure modes produce actionable next steps instead of raw stack traces
- `pnpm smoke:alpha` covers warning, accepted, and rejected verification outcomes

## Dependencies

- Phase 5

## Primary Tasks

- `T060` fixture repo suite
- `T061` end-to-end smoke tests
- `T062` multi-runtime comparison and compatibility notes
- `T063` CLI UX polish
- `T064` failure recovery and troubleshooting output
- `T065` alpha release checklist
- `T066` demo script and operator notes
