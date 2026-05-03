# XieZhi Phases

This directory defines the implementation phases for XieZhi.

The goal is not to create a heavyweight project plan. The goal is to create a build order that preserves the first control loop while moving toward the `v2` product thesis:

```text
init
  -> index
  -> plan
  -> task run
  -> verify
  -> review
```

The `v2` direction adds a supervisor layer on top:

```text
user request
  -> main agent creates DAG and scopes
  -> subagent executes bounded task
  -> AST verifies impact
  -> main agent accepts, retries, splits, or escalates
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
| 9 | Control Loop Hardening | close PRD gaps in patch lifecycle, verifier strictness, and review clarity | operators can accept, reject, and reason about patches with stronger evidence |
| 10 | Semantic Control and Planning | upgrade planning and policy from file scope toward semantic scope | tasks carry semantic intent and verifier can detect semantic scope drift |
| 11 | Supervisor and Subagent Orchestration | move from one-shot task execution toward a supervised multi-agent loop | the main agent can decompose goals, assign subagents, and advance the DAG with evidence |
| 12 | Agent Observability and Context | make agent work inspectable and give subagents high-quality context packs | operators can inspect task intent, agent runs, runtime mode, and context |
| 13 | Recovery and Integration | let the supervisor retry, split, reassign, and integrate patches | failed work can recover through structured supervisor decisions |
| 14 | Product and Governance Layer | translate the orchestrator into product-facing and team-facing surfaces | users can understand roadmap, risk, history, and policy without reading raw DAGs |

## Suggested Build Order

1. Complete Phase 0 and Phase 1 before touching multiple runtimes.
2. Land a thin OpenCode path first in Phase 4.
3. Only after one runtime works, add Claude and Codex adapters.
4. Keep semantic diff and verifier minimal-but-real before polishing HTML or dashboard output.
5. After alpha and release workflow, close the remaining PRD gaps in lifecycle and verification before broadening planner ambition.
6. Only after the control loop is hardened, invest in semantic policy and richer planner output.
7. Only after semantic scope and richer DAG structure exist should XieZhi grow into a supervisor that coordinates subagents.
8. Add observability and recovery before product-layer UI, because users need to trust the orchestration before it becomes more autonomous.

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
- [phase-9-control-loop-hardening.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-9-control-loop-hardening.md:1)
- [phase-10-semantic-control-and-planning.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-10-semantic-control-and-planning.md:1)
- [phase-11-supervisor-subagent-orchestration.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-11-supervisor-subagent-orchestration.md:1)
- [phase-12-agent-observability-and-context.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-12-agent-observability-and-context.md:1)
- [phase-13-recovery-and-integration.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-13-recovery-and-integration.md:1)
- [phase-14-product-governance-layer.md](/Users/terenceliu/Downloads/development/xiezhi/docs/phases/phase-14-product-governance-layer.md:1)
