# Runtime Compatibility Notes

This file explains the current state of each runtime in the alpha.

## Shared Guarantees

- All runtimes enter through `xz task run`
- All runtimes compile the same execution policy
- All runtimes produce normalized events, command logs, and a patch record
- Verification and review are runtime-agnostic once a patch exists

## OpenCode

- Status: `alpha-demo`
- Current mode: capability-aware adapter
- What works:
  - task orchestration
  - clean fallback when `opencode` is not installed
  - worktree isolation
  - patch persistence
  - verify / review loop
- What is deferred:
  - a validated real CLI path on this machine
  - richer event streaming

## Claude

- Status: `alpha-demo`
- Current mode: real CLI bridge when available
- What works:
  - runtime selection
  - normalized patch lifecycle
  - retry and discard flow
  - real file-edit capture
- What is deferred:
  - richer tool permission mapping

## Codex

- Status: `alpha-demo`
- Current mode: real CLI bridge when available
- What works:
  - runtime selection
  - normalized patch lifecycle
  - verify / review compatibility
  - real file-edit capture
- What is deferred:
  - richer command / approval capture

## Important Operator Note

Because runtime availability is machine-dependent, the most reliable demo flow today is:

1. run `xz task run ...`
2. if the adapter falls back, edit the generated worktree inside the planned scope
3. run `xz verify ...`
4. run `xz review ...`

That flow exercises the real XieZhi control layer while we postpone deeper runtime execution to Phase 7.
