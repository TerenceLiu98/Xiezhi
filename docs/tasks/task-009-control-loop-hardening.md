# Control Loop Hardening Tasks

Status: `todo`

## T090 Patch acceptance and promotion flow

- Priority: `P0`
- Phase: `9`
- Goal: add an explicit operator action that accepts a verified patch and advances it in the lifecycle without relying on manual database changes
- Deliverables:
  - `xiezhi patch accept <patch-id>` or equivalent operator command
  - persisted accepted status and timestamps
  - task and patch state transitions that remain auditable
- Acceptance:
  - a verified patch can be explicitly accepted from the CLI
  - patch lifecycle state is visible without direct DB inspection
  - acceptance does not imply automatic merge to `main`

## T091 Patch integrity verifier rules

- Priority: `P0`
- Phase: `9`
- Goal: align blocking verifier rules with the PRD around task binding, base commit integrity, and patch legitimacy
- Deliverables:
  - task-binding verification
  - base-commit drift check
  - existing-test deletion detection
  - stable blocking rule names for integrity failures
- Acceptance:
  - patches without a valid task binding are rejected
  - base commit mismatch is surfaced as a blocking violation
  - deleting existing tests is surfaced as a blocking violation

## T092 Verification command policy hardening

- Priority: `P0`
- Phase: `9`
- Goal: make required verification commands enforceable instead of mostly advisory when a task claims test or typecheck coverage
- Deliverables:
  - required check classification from config and intent
  - stricter handling for failed or missing required checks
  - clearer verify output for test and typecheck enforcement
- Acceptance:
  - failed required checks reject the patch
  - tasks that require verification cannot silently pass without relevant checks
  - verify output explains which checks were required, missing, or failed

## T093 Semantic diff completeness

- Priority: `P1`
- Phase: `9`
- Goal: upgrade semantic diff from a minimal added or removed snapshot into a fuller review artifact closer to the PRD
- Deliverables:
  - modified node detection
  - import delta summary
  - test delta summary
  - public API oriented export summary
- Acceptance:
  - semantic diff can describe more than added and removed nodes
  - review output can distinguish test, import, and API-relevant changes

## T094 Review and verify evidence upgrade

- Priority: `P1`
- Phase: `9`
- Goal: give operators better evidence for decision-making by combining textual diff context, semantic diff, checks, and verdict framing
- Deliverables:
  - textual diff summary or stats
  - clearer verification verdict language
  - richer next-step guidance
  - exported artifact fields for stronger offline review
- Acceptance:
  - review report includes enough context for a quick accept or reject decision
  - verify and review agree on outcome language and next actions

## T095 Structured failure summaries in CLI

- Priority: `P1`
- Phase: `9`
- Goal: route plan, run, verify, and environment failures through one stable failure taxonomy visible to operators
- Deliverables:
  - failure type and stage rendering in CLI output
  - standardized recovery actions
  - command-level integration with the shared failure summarizer
- Acceptance:
  - major command failures render failure type, stage, explanation, and next action
  - operators do not need raw stack traces for common recovery paths

## T096 Patch history and task linkage views

- Priority: `P1`
- Phase: `9`
- Goal: make patch lifecycle history visible from task-oriented views so operators can understand retries, discards, and latest verification state
- Deliverables:
  - task-level linked patch summaries
  - latest patch verdict in task views
  - retry and discard history exposure
- Acceptance:
  - an operator can see which patches belong to a task and what happened to them
  - `xiezhi task list` or related views expose the latest actionable patch state

## T117 Task lifecycle clarity

- Priority: `P0`
- Phase: `9`
- Goal: remove ambiguity between active runtime execution and captured patches that are awaiting verification
- Deliverables:
  - task status model that distinguishes `running`, `patched`, `verified`, `rejected`, and `failed`
  - CLI output updates for task list, task run, verify, and review
  - compatibility handling for existing `running` task rows
- Acceptance:
  - `running` means a task is actively executing
  - a captured but unverified patch appears as `patched` or equivalent
  - operators no longer need to infer lifecycle state from patch status alone

## T118 Runtime launch evidence

- Priority: `P0`
- Phase: `9`
- Goal: make it obvious whether a task used a real runtime or scaffold fallback and whether the runtime produced edits
- Deliverables:
  - runtime mode in latest patch summaries
  - latest command and runtime binary in task or patch views
  - explicit empty-patch messaging when real runtime execution succeeds without edits
- Acceptance:
  - `xiezhi task run` reports real or scaffold execution clearly
  - `xiezhi task list` exposes latest patch runtime mode
  - empty patches are described as launched-but-no-edits rather than ambiguous success
