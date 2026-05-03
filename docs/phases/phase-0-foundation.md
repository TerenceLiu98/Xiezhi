# Phase 0: Foundation

## Goal

Create a stable local developer foundation for building XieZhi.

## Scope

- Initialize the TypeScript + Node.js 22 project
- Establish package, build, lint, and test setup
- Define top-level folder structure
- Add config loading and environment handling
- Create SQLite bootstrap and migration entrypoint
- Stub the `xiezhi` CLI commands

## In Scope

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `src/cli/*`
- `src/config/*`
- `src/db/*`
- `src/runtime/shared/*`

## Out of Scope

- Real repo indexing
- Real DAG planning
- Real runtime execution
- Real semantic diff

## Deliverables

- Project scaffold compiles with `pnpm build`
- Test runner works with at least one smoke test
- `xiezhi init`, `xiezhi index`, `xiezhi agent plan`, `xiezhi agent run`, `xiezhi verify`, `xiezhi review` exist as stubbed commands
- SQLite database can be created locally
- Drizzle schema and migration workflow are in place

## Acceptance Criteria

- A new contributor can clone the repo and run install, test, and build without manual fixes
- `xiezhi init` creates the XieZhi local metadata directory and config file scaffold
- Logging, config parsing, and DB bootstrap are reusable by all later phases

## Dependencies

- None

## Primary Tasks

- `T001` repo scaffold and package setup
- `T002` TypeScript build and Vitest setup
- `T003` CLI entrypoint and command registration
- `T004` config loader for YAML plus runtime-specific config parsing helpers
- `T005` SQLite bootstrap, Drizzle schema, migration runner
- `T006` logging, error model, and shared result helpers
