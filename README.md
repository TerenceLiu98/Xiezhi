# XieZhi

XieZhi is a controlled vibe coding platform for AI-assisted software development.

Instead of letting an agent directly edit a codebase and hoping the diff looks reasonable, XieZhi adds a control layer on top of an agent runtime such as OpenCode. It turns natural language requests into structured tasks, constrains what the agent is allowed to change, and verifies whether the resulting patch actually matches the task.

## Why

AI coding tools are getting better at writing code, but software teams still struggle with control:

- Requirements are not traceable to code changes.
- Agents can modify unrelated files or modules.
- Text diffs are hard to review at a semantic level.
- Tests and acceptance criteria are often incomplete or unstable.
- After multiple rounds of vibe coding, it becomes hard to explain what changed and why.

XieZhi is built to make AI-generated changes more:

- Planned
- Constrained
- Traceable
- Verifiable

## Core Idea

XieZhi sits between user intent and an AI coding runtime:

```text
User Intent
  -> Feature DAG
  -> Task DAG
  -> Intent IR
  -> Policy
  -> Coding Runtime
  -> Patch
  -> AST Semantic Diff
  -> Consistency Verifier
  -> Human Review
```

The goal is simple:

> No task, no patch.

Every meaningful code change should be tied to a task, scoped to allowed files or symbols, and reviewed with semantic context instead of raw diff alone.

## What v1 Includes

The first version is intentionally CLI-first and local-first.

- A CLI for planning, running, verifying, and reviewing AI-generated patches
- Feature DAG and Task DAG generation from natural language requirements
- Intent IR and task-scoped execution policy
- Repository indexing for TypeScript projects
- AST-based semantic diff
- Patch verification for out-of-scope changes, missing tests, and risky API changes
- Worktree-isolated task execution through OpenCode

## What v1 Does Not Include

- A full IDE
- A multi-tenant cloud platform
- Support for every language
- A custom agent runtime
- Automatic merge to `main`

## Example Workflow

```bash
xz init
xz index
xz plan "add team invitation feature"
xz dag show
xz task list
xz task run task.add_create_invite_api --runtime opencode
xz verify <patch-id>
xz review <patch-id>
```

Example review output:

```text
Semantic Diff:
  Added:
    - route POST /teams/:teamId/invitations
    - function createInvitation
    - test non-admin cannot invite

Warnings:
  - public type changed: TeamRole
  - missing test: invitation expiry
```

## Design Principles

- OpenCode executes, XieZhi controls.
- AI should operate inside tasks, not free-form sessions.
- Text diff is not enough; semantic diff matters.
- Patch validation is mandatory.
- Local execution comes first.

## Status

This repo is now at a `v1 alpha` with real runtime bridges for the CLIs available on the local machine.

- The control loop is real
- OpenCode, Claude, and Codex share one runtime orchestration surface
- Claude and Codex can use real CLI bridges when available
- OpenCode degrades cleanly to a scaffold fallback when the CLI is unavailable

## Alpha Smoke

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:alpha
```

The alpha smoke path covers:

- `warning` verification
- `accepted` verification
- `rejected` verification
- discard / retry operator recovery

## Roadmap Focus

The immediate goal is to prove a tight v1 loop:

1. Index a real TypeScript repository.
2. Turn a natural language request into a runnable task graph.
3. Execute one task in an isolated worktree.
4. Produce a semantic diff and verification report.
5. Accept a good patch or reject an out-of-scope one.
