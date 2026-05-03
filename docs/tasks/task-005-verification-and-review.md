# Verification and Review Tasks

## T050 AST snapshot comparer

- Priority: `P0`
- Phase: `5`
- Goal: compare pre- and post-run code graph state for changed files
- Acceptance:
  - added, removed, and modified nodes can be derived for a patch

## T051 Semantic diff formatter

- Priority: `P1`
- Phase: `5`
- Goal: turn AST-level before/after deltas into a compact semantic change summary
- Acceptance:
  - review output can say more than raw textual diff and identify symbol-level changes

## T052 File scope verifier

- Priority: `P0`
- Phase: `5`
- Goal: block changes outside the allowed file set
- Acceptance:
  - unauthorized file changes are raised as blocking violations

## T053 Forbidden scope verifier

- Priority: `P0`
- Phase: `5`
- Goal: block changes inside explicitly forbidden files or modules
- Acceptance:
  - forbidden changes are raised with clear rationale

## T054 Test and typecheck ingestion

- Priority: `P0`
- Phase: `5`
- Goal: ingest command results for tests, lint, and typecheck into verification
- Acceptance:
  - failed checks surface in a structured way, not as opaque terminal dumps

## T055 Warning and violation rule engine

- Priority: `P0`
- Phase: `5`
- Goal: implement the blocking and warning rules defined in the PRD
- Deliverables:
  - unauthorized file change
  - forbidden scope change
  - missing tests
  - public API change warning
  - exported symbol warning
  - acceptance coverage warning
- Acceptance:
  - one patch can be accepted, warned, or rejected with stable rule names

## T056 Review report renderer

- Priority: `P1`
- Phase: `5`
- Goal: make semantic review understandable in CLI output
- Acceptance:
  - report includes task goal, diff summary, semantic changes, checks, warnings, and next actions

## T057 Verification CLI formatter

- Priority: `P1`
- Phase: `5`
- Goal: present verify output clearly enough for fast human decision-making
- Acceptance:
  - blocking issues and warnings are visually distinct and easy to scan
