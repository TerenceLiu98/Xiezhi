# Alpha Release Checklist

Use this checklist before calling the current branch `v1 alpha` ready.

## Core Loop

- `xiezhi init` creates `.xiezhi/`, config, and database without manual fixes
- `xiezhi index --full` completes on the demo repo
- `xiezhi agent plan "<request>" --runtime opencode` creates a feature and runnable tasks from strict AgentPlan JSON
- `xiezhi agent run <task-id> --runtime opencode` creates an assignment, worktree, agent run, and patch record
- `xiezhi verify <patch-id>` returns a structured result
- `xiezhi review <patch-id>` returns a semantic summary

## Alpha Demo Paths

- The warning path is demoable with a scaffold patch and no extra edits
- The accepted path is demoable by editing the task worktree inside the allowed scope and rerunning `verify`
- The rejected path is demoable by touching an out-of-scope file and rerunning `verify`

## Runtime Coverage

- `opencode`, `claude`, and `codex` all run through the same task orchestrator
- Runtime differences are documented in [runtime-compatibility.md](/Users/terenceliu/Downloads/development/xiezhi/docs/alpha/runtime-compatibility.md:1)
- Unsupported behavior fails with actionable operator hints instead of raw stack traces

## Test And Regression Bar

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm smoke:alpha`

## Operator Readiness

- The demo script in [demo-script.md](/Users/terenceliu/Downloads/development/xiezhi/docs/alpha/demo-script.md:1) is current
- Recovery flows for `discard` and `retry` are documented and tested
- The backlog marks all Phase 6 tasks as `done`
