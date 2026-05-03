# Alpha Assets

This directory contains the operator-facing material for the current `v1 alpha`.

## Files

- [release-checklist.md](/Users/terenceliu/Downloads/development/xiezhi/docs/alpha/release-checklist.md:1)
- [runtime-compatibility.md](/Users/terenceliu/Downloads/development/xiezhi/docs/alpha/runtime-compatibility.md:1)
- [demo-script.md](/Users/terenceliu/Downloads/development/xiezhi/docs/alpha/demo-script.md:1)

## Current Alpha Shape

- The control loop is real: `init -> index -> plan -> task run -> verify -> review`
- The runtime layer is still scaffold-first: OpenCode, Claude, and Codex all normalize into the same orchestration surface
- Verification now re-reads the live worktree before deciding `accepted`, `warning`, or `rejected`
- The canonical smoke command is `pnpm smoke:alpha`
