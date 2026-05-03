# XieZhi

[![License: AGPL v3+](https://img.shields.io/badge/license-AGPL%20v3%2B-0f766e.svg)](/Users/terenceliu/Downloads/development/xiezhi/LICENSE)
![Status](https://img.shields.io/badge/status-alpha-b45309)
![Node](https://img.shields.io/badge/node-%3E%3D22-3c873a)
![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6)

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

For more background on the motivation behind controlled vibe coding, see [🤓 Humans do Marginalia, AIs doe Zettelkasten - 构建科研民工的第二大脑 (2)](https://blog.cklau.cc/post/sapientia-development-2/).

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
xiezhi init
xiezhi index
xiezhi plan "add team invitation feature"
xiezhi dag show
xiezhi task list
xiezhi task run task.add_create_invite_api --runtime opencode
xiezhi verify <patch-id>
xiezhi review <patch-id>
xiezhi patch accept <patch-id>
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

## Demo: Budgeting App

Imagine a user is building a personal finance app and wants to add a monthly budget alert:

> Add a feature so users get a warning when spending in a category exceeds the monthly budget.

With a normal coding agent, that request might lead to broad edits across transactions, notifications, and unrelated settings screens.

With XieZhi, the flow is narrower and easier to review:

```bash
xiezhi init
xiezhi index
xiezhi plan "add monthly category budget alerts to the budgeting app"
xiezhi dag show
xiezhi task list
```

At this point, XieZhi can turn the request into a small task graph such as:

```text
Feature: Monthly category budget alerts

Tasks:
  1. Confirm touchpoints for budget alerts
  2. Implement budget alert calculation
  3. Verify budget alert coverage
```

Then the user runs one task in isolation:

```bash
xiezhi task run <task-id> --runtime opencode
```

XieZhi creates a dedicated git worktree for that task, injects the task goal and allowed file scope, and captures the resulting patch.

After the runtime finishes, the user verifies the patch:

```bash
xiezhi verify <patch-id>
xiezhi review <patch-id>
```

Example review output for the budgeting app might look like:

```text
Semantic Diff:
  Added:
    - function calculateBudgetAlert
    - route GET /budgets/:categoryId/alerts
    - test budget alert triggers after monthly limit is crossed

Warnings:
  - public type changed: BudgetAlert
```

If the patch looks good, the user can explicitly accept it:

```bash
xiezhi patch accept <patch-id>
```

If the runtime edits something out of scope, like `src/auth/session.ts` or `src/settings/currency.ts`, XieZhi can reject the patch and tell the user to retry or discard it instead of silently letting unrelated changes through.

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

## Install

```bash
pnpm install
pnpm build
pnpm link --global
xiezhi doctor
```

More detailed install and preset guidance lives in [docs/install.md](/Users/terenceliu/Downloads/development/xiezhi/docs/install.md:1).

## Roadmap Focus

The immediate goal is to prove a tight v1 loop:

1. Index a real TypeScript repository.
2. Turn a natural language request into a runnable task graph.
3. Execute one task in an isolated worktree.
4. Produce a semantic diff and verification report.
5. Accept a good patch or reject an out-of-scope one.

## License

XieZhi is licensed under the GNU Affero General Public License v3.0 or later.

See [LICENSE](/Users/terenceliu/Downloads/development/xiezhi/LICENSE:1).
