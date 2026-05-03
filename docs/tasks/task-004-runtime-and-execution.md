# Runtime and Execution Tasks

## T040 Runtime event model and normalizers

- Priority: `P0`
- Phase: `4`
- Goal: normalize vendor-specific runtime output into XieZhi-owned events
- Deliverables:
  - common event types for tool call, file edit, message, approval, usage, error, and completion
- Acceptance:
  - verifier and review code do not branch on vendor-specific event shapes

## T041 Execution policy compiler

- Priority: `P0`
- Phase: `4`
- Goal: convert Intent IR into runtime-specific permissions and allowed tool scopes
- Acceptance:
  - runtime config can be generated for OpenCode, Claude, and Codex without leaking vendor concerns into the planner

## T042 Task run orchestrator

- Priority: `P0`
- Phase: `4`
- Goal: coordinate worktree creation, runtime launch, event collection, command capture, and patch finalization
- Acceptance:
  - one command can drive the full controlled execution path for one task

## T043 OpenCode adapter

- Priority: `P0`
- Phase: `4`
- Goal: deliver the first deep runtime path using OpenCode
- Acceptance:
  - `xz task run <task-id> --runtime opencode` can produce a patch record

## T044 Claude adapter

- Priority: `P1`
- Phase: `4`
- Goal: add Claude Code support through the TypeScript agent SDK
- Acceptance:
  - normalized events and patch output match the shared runtime interface

## T045 Codex adapter

- Priority: `P1`
- Phase: `4`
- Goal: add Codex support through the SDK, with exec mode as a fallback path
- Acceptance:
  - one task can run through Codex without changing planner or verifier code

## T046 Patch capture and persistence

- Priority: `P0`
- Phase: `4`
- Goal: persist textual diff, changed files, command logs, base commit, and runtime metadata for a run
- Acceptance:
  - every run attempt creates an inspectable patch artifact, even if verification later fails

## T047 Patch discard and retry flow

- Priority: `P1`
- Phase: `4`
- Goal: make task execution safely repeatable
- Acceptance:
  - a rejected or abandoned patch can be discarded without manual git cleanup
