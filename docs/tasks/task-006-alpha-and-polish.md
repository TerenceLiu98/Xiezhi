# Alpha and Polish Tasks

Status: `done`

## T060 Fixture repo suite

- Priority: `P0`
- Phase: `6`
- Goal: build stable demo repos that exercise the end-to-end controlled patch flow
- Acceptance:
  - at least one small TypeScript fixture exists for deterministic runtime and verifier testing
  - accepted, warning, and rejected demo targets are covered by automated alpha smoke tests

## T061 End-to-end smoke tests

- Priority: `P0`
- Phase: `6`
- Goal: verify the first controlled patch loop across init, index, plan, run, and verify
- Acceptance:
  - one automated smoke path covers the alpha-critical lifecycle
  - `pnpm smoke:alpha` exercises warning, accepted, and rejected verification outcomes

## T062 Multi-runtime compatibility notes

- Priority: `P1`
- Phase: `6`
- Goal: document what works, what differs, and what is deferred across OpenCode, Claude, and Codex
- Acceptance:
  - maintainers can explain runtime limitations without reading source
  - notes live in `docs/alpha/runtime-compatibility.md`

## T063 CLI UX polish

- Priority: `P1`
- Phase: `6`
- Goal: make the CLI output easier to scan during demos and daily use
- Deliverables:
  - cleaner section formatting
  - clearer success and failure summaries
  - less noisy default output
- Acceptance:
  - the core commands feel intentional rather than scaffold-like
  - `verify`, `review`, and `task run` all produce explicit next steps

## T064 Failure recovery polish

- Priority: `P1`
- Phase: `6`
- Goal: improve the retry, discard, and operator-guidance paths around failed runs
- Acceptance:
  - a user can recover from the most common failure modes without manual repo surgery
  - `task retry` exists and common error states render actionable hints

## T065 Alpha release checklist

- Priority: `P0`
- Phase: `6`
- Goal: define the exact bar for calling `v1 alpha` ready
- Acceptance:
  - checklist exists and can be executed without guessing hidden requirements
  - checklist lives in `docs/alpha/release-checklist.md`

## T066 Demo script and operator notes

- Priority: `P0`
- Phase: `6`
- Goal: make the first external demos repeatable
- Acceptance:
  - a maintainer can run one accepted patch demo and one rejected patch demo from written notes
  - script lives in `docs/alpha/demo-script.md`
