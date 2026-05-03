# Core and CLI Tasks

## T002 TypeScript build and Vitest setup

- Priority: `P0`
- Phase: `0`
- Goal: make the repo runnable, type-safe, and regression-testable from the start
- Deliverables:
  - `tsconfig.json`
  - `vitest.config.ts`
  - build script
  - typecheck script
  - test script
- Acceptance:
  - `pnpm exec tsc --noEmit` passes
  - `pnpm test` runs in a fresh clone

## T001 Repo scaffold and package setup

- Priority: `P0`
- Phase: `0`
- Goal: create the baseline Node.js 22 + TypeScript + pnpm project
- Deliverables:
  - `package.json`
  - `tsconfig.json`
  - `src/` skeleton
  - scripts for build, test, lint, dev
- Acceptance:
  - `pnpm install` works
  - `pnpm build` produces output

## T003 CLI entrypoint and command registration

- Priority: `P0`
- Phase: `0`
- Goal: define the public CLI surface early
- Deliverables:
  - `xiezhi init`
  - `xiezhi index`
  - `xiezhi plan`
  - `xiezhi dag show`
  - `xiezhi task list`
  - `xiezhi task run`
  - `xiezhi verify`
  - `xiezhi review`
- Acceptance:
  - all commands parse arguments and print structured placeholder output

## T004 Config loader and runtime config parsers

- Priority: `P0`
- Phase: `0`
- Goal: support XieZhi config plus runtime-specific config compilation targets
- Deliverables:
  - YAML project config loader
  - JSONC parsing helper
  - TOML parsing helper
  - config validation with `zod`
- Acceptance:
  - invalid config yields stable user-facing errors

## T005 SQLite bootstrap and Drizzle migrations

- Priority: `P0`
- Phase: `0`
- Goal: create local-first persistence with reproducible schema setup
- Deliverables:
  - DB open/init path
  - schema definitions
  - migration generation and apply flow
- Acceptance:
  - a fresh repo can create and migrate the DB in one command path

## T006 Logging and shared error model

- Priority: `P0`
- Phase: `0`
- Goal: create stable operator-facing errors before runtime work begins
- Deliverables:
  - shared `XieZhiError`
  - stable error codes
  - CLI-safe formatting helpers
  - logger bootstrap for future runtime traces
- Acceptance:
  - common failure paths return readable messages and hints

## T010 Persistent schema finalization

- Priority: `P0`
- Phase: `1`
- Goal: stabilize tables and record lifecycles for features, tasks, code nodes, patches, checks, and violations
- Acceptance:
  - all P0 flows have a place to persist state without schema churn

## T011 Repository metadata service

- Priority: `P0`
- Phase: `1`
- Goal: persist repo identity and current git state for every initialized workspace
- Deliverables:
  - repo root discovery
  - git dir resolution
  - current branch capture
  - head commit capture
  - dirty state capture
- Acceptance:
  - XieZhi can recover the active repo record without asking the user again

## T012 Worktree manager

- Priority: `P0`
- Phase: `1`
- Goal: isolate every task run in its own git worktree
- Deliverables:
  - create worktree
  - inspect worktree
  - delete worktree
  - resolve base commit
- Acceptance:
  - main working tree is never mutated by a task run path

## T013 Patch record service

- Priority: `P0`
- Phase: `1`
- Goal: persist run artifacts before verification exists
- Deliverables:
  - patch record creation
  - patch status updates
  - changed file capture
  - diff storage hooks
- Acceptance:
  - every execution attempt can be inspected later even if the run fails

## T014 Command log persistence

- Priority: `P1`
- Phase: `1`
- Goal: keep shell command evidence as structured patch metadata
- Deliverables:
  - command log row format
  - append API
  - ordering by timestamp
- Acceptance:
  - verifier and review layers can read command history without scraping raw terminal output

## T015 Shared runtime contracts

- Priority: `P0`
- Phase: `1`
- Goal: define the internal adapter contract before implementing any vendor integration
- Deliverables:
  - `CodingRuntime`
  - `RuntimeEvent`
  - `ExecutionPolicy`
  - `RunTaskInput`
  - `RunTaskResult`
- Acceptance:
  - OpenCode, Claude, and Codex adapters can all target the same interface

## T016 Failure taxonomy and recovery messaging

- Priority: `P1`
- Phase: `1`
- Goal: name the main failure classes early so runtime and verifier work share a common vocabulary
- Deliverables:
  - git failure category
  - config failure category
  - runtime failure category
  - verification failure category
  - recovery-oriented user messaging
- Acceptance:
  - common failure cases map to stable labels and next-step hints
