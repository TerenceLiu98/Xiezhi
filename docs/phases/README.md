# XieZhi Phases

This directory defines the implementation phases for `v1`.

The goal is not to create a heavyweight project plan. The goal is to create a build order that preserves the `v1` product loop:

```text
init
  -> index
  -> plan
  -> task run
  -> verify
  -> review
```

## Principles

- Each phase should unlock a visible product capability.
- `P0` work is optimized for getting one controlled patch loop running end-to-end.
- `P1` work improves explainability, multi-runtime coverage, and polish after the core loop works.
- A phase is considered complete only when its acceptance criteria are satisfied, not when all code is written.

## Phase Overview

| Phase | Name | Focus | Exit Condition |
| --- | --- | --- | --- |
| 0 | Foundation | repo scaffold, toolchain, config, DB bootstrap | project boots and core commands can be stubbed |
| 1 | Local Core | storage models, worktree lifecycle, shared runtime contracts | local state and worktree execution are reliable |
| 2 | Indexer | TypeScript repo indexing and code graph | repo can be indexed and queried |
| 3 | Planning | Feature DAG, Task DAG, Intent IR | natural language request becomes runnable tasks |
| 4 | Execution | runtime adapters and controlled task execution | one task can run in isolated mode through a runtime |
| 5 | Verification | semantic diff, verifier, review report | patch can be accepted or rejected with evidence |
| 6 | Alpha | multi-runtime hardening and demo preparation | alpha release criteria are satisfied |
| 7 | Runtime Integration | replace scaffold adapters with real runtime execution | at least one runtime produces real controlled edits |
| 8 | Release Workflow | external alpha onboarding, reports, and CI guardrails | a new team can install, demo, and validate XieZhi repeatably |

## Suggested Build Order

1. Complete Phase 0 and Phase 1 before touching multiple runtimes.
2. Land a thin OpenCode path first in Phase 4.
3. Only after one runtime works, add Claude and Codex adapters.
4. Keep semantic diff and verifier minimal-but-real before polishing HTML or dashboard output.

## Files

- [phase-0-foundation.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-0-foundation.md:1)
- [phase-1-local-core.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-1-local-core.md:1)
- [phase-2-indexer.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-2-indexer.md:1)
- [phase-3-planning.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-3-planning.md:1)
- [phase-4-execution.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-4-execution.md:1)
- [phase-5-verification.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-5-verification.md:1)
- [phase-6-alpha.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-6-alpha.md:1)
- [phase-7-runtime-integration.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-7-runtime-integration.md:1)
- [phase-8-release-workflow.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-8-release-workflow.md:1)
