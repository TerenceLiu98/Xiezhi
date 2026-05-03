# Phase 5: Verification and Review

## Goal

Determine whether a generated patch should be accepted, rejected, or escalated with warnings.

## Scope

- Semantic diff
- File scope verification
- Forbidden area verification
- Test and typecheck result ingestion
- Warning and violation model
- Review report rendering

## Deliverables

- `xiezhi verify <patch-id>` returns structured pass, warning, or rejection output
- `xiezhi review <patch-id>` produces a readable semantic review summary
- Blocking violations and warnings match the PRD definitions

## Acceptance Criteria

- Out-of-scope file modifications are rejected
- Missing tests and public API changes are surfaced as warnings at minimum
- Review output is readable within a couple of minutes by a new user

## Dependencies

- Phase 2
- Phase 4

## Primary Tasks

- `T050` AST snapshot comparer
- `T051` semantic diff formatter
- `T052` file scope verifier
- `T053` forbidden scope verifier
- `T054` test and typecheck result ingestion
- `T055` warning and violation rule engine
- `T056` review report renderer
- `T057` verification summary CLI formatter
