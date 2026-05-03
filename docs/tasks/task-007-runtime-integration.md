# Runtime Integration Tasks

Status: `done`

## T070 OpenCode real execution bridge

- Priority: `P0`
- Phase: `7`
- Goal: add a capability-aware OpenCode bridge that uses the real CLI when present and degrades cleanly otherwise
- Acceptance:
  - OpenCode no longer hard-fails when the CLI is missing
  - when the CLI is unavailable, XieZhi reports a clear fallback instead of breaking the task loop

## T071 Claude headless execution bridge

- Priority: `P0`
- Phase: `7`
- Goal: wire Claude Code headless execution into the shared runtime contract
- Acceptance:
  - Claude can execute a task and produce normalized events, command logs, and file-edit capture

## T072 Codex noninteractive execution bridge

- Priority: `P0`
- Phase: `7`
- Goal: wire Codex noninteractive execution into the shared runtime contract
- Acceptance:
  - Codex can execute a task and produce normalized events, command logs, and file-edit capture

## T073 Runtime capability matrix

- Priority: `P1`
- Phase: `7`
- Goal: document exactly which runtime supports which control-layer capability
- Acceptance:
  - maintainers can explain runtime gaps without reading the adapter code
  - runtime availability and fallback behavior are documented

## T074 File-edit and approval event capture

- Priority: `P0`
- Phase: `7`
- Goal: retain richer execution traces from real runtimes
- Acceptance:
  - file edits and approval events are visible in the patch timeline

## T075 Runtime-specific policy compiler

- Priority: `P1`
- Phase: `7`
- Goal: lower the shared policy into the shapes expected by each runtime
- Acceptance:
  - policy enforcement remains consistent across adapters
  - prompt transport and permission mode differences are isolated inside runtime-specific bridges

## T076 Integration test matrix

- Priority: `P0`
- Phase: `7`
- Goal: prevent real runtime integration from regressing the control loop
- Acceptance:
  - automated tests cover Claude and Codex real-bridge command assembly plus scaffold fallbacks
