# Phase 9: Control Loop Hardening

Status: `planned`

## Goal

Close the highest-priority PRD gaps in patch lifecycle, verification strictness, and operator decision support so the control loop can accept, reject, and promote patches intentionally.

## Scope

- explicit patch acceptance and promotion flow
- patch integrity and base-commit verification
- stricter test and typecheck enforcement
- richer semantic diff coverage
- stronger verify and review evidence
- structured failure attribution in CLI output
- clearer task lifecycle states for patched, verified, rejected, and failed work
- runtime launch evidence that distinguishes real subagent execution from scaffold fallback

## Deliverables

- one explicit patch acceptance path after verification
- blocking verifier rules for task binding, base commit drift, and failed required checks
- semantic diff support for modified nodes plus import, export, and test deltas
- clearer verify and review summaries with textual diff context
- unified failure summary rendering with stage, type, and next action
- task and patch views that show runtime mode, latest command, and empty-patch outcomes

## Acceptance Criteria

- a verified patch can be explicitly accepted without manual DB edits
- verifier can reject patches with base-commit drift or missing required checks
- review output is strong enough for an operator to decide in a couple of minutes
- CLI failure output is structured and recovery-oriented instead of ad hoc
- `running` is reserved for active execution and does not describe already-captured patches
- an operator can tell whether the latest patch came from a real runtime or scaffold fallback

## Dependencies

- Phase 5 for semantic diff and verifier foundations
- Phase 7 for real runtime evidence capture
- Phase 8 for operator-facing install and docs baseline

## Primary Tasks

- `T090` patch acceptance and promotion flow
- `T091` patch integrity verifier rules
- `T092` verification command policy hardening
- `T093` semantic diff completeness
- `T094` review and verify evidence upgrade
- `T095` structured failure summaries in CLI
- `T096` patch history and task linkage views
- `T117` task lifecycle clarity
- `T118` runtime launch evidence
