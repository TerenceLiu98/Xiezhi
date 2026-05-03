# Indexer and Planning Tasks

## T020 ts-morph project loader

- Priority: `P0`
- Phase: `2`
- Goal: load a TypeScript project with stable compiler options and file discovery
- Acceptance:
  - supports normal repo layouts without manual file enumeration

## T021 File and symbol extractor

- Priority: `P0`
- Phase: `2`
- Goal: extract v1 code node types from source files
- Deliverables:
  - files
  - functions
  - classes
  - interfaces
  - types
  - tests
- Acceptance:
  - extracted nodes can be persisted and queried by path or symbol

## T022 Import/export and reference edges

- Priority: `P0`
- Phase: `2`
- Goal: build the minimum graph needed for scope reasoning and semantic diff
- Acceptance:
  - import/export changes are visible in stored graph data

## T023 Component and test heuristics

- Priority: `P1`
- Phase: `2`
- Goal: classify likely UI components, hooks, and tests without waiting for full semantic analysis
- Deliverables:
  - component heuristic
  - hook heuristic
  - test heuristic
- Acceptance:
  - planning and review can distinguish likely product code from likely test coverage

## T024 Route heuristic extractor

- Priority: `P1`
- Phase: `2`
- Goal: surface HTTP or app route touchpoints from indexed source files
- Acceptance:
  - route-like files or symbols become queryable planning context

## T025 Code graph persistence

- Priority: `P0`
- Phase: `2`
- Goal: store and query code nodes and edges efficiently in SQLite
- Acceptance:
  - planner and verifier can fetch code context by repo, file, symbol, and edge type

## T026 Incremental indexing

- Priority: `P1`
- Phase: `2`
- Goal: reindex only changed files when the repo state allows it
- Acceptance:
  - tracked and untracked file changes can be indexed without forcing a full rebuild every time

## T027 Index summary formatter

- Priority: `P0`
- Phase: `2`
- Goal: make index results human-readable in the CLI
- Acceptance:
  - users can quickly tell what was indexed and whether the run was full or incremental

## T030 Feature DAG schema and validation

- Priority: `P0`
- Phase: `3`
- Goal: represent product intent structurally
- Deliverables:
  - node model
  - edge model
  - DAG validators
  - status transitions
- Acceptance:
  - invalid edges or cycles are rejected clearly

## T031 Task DAG execution model

- Priority: `P0`
- Phase: `3`
- Goal: represent runnable tasks and their status lifecycle
- Acceptance:
  - tasks can transition from draft to ready to running to verified or rejected

## T032 Planner prompt and response normalization

- Priority: `P0`
- Phase: `3`
- Goal: convert natural language requirements into a consistent intermediate plan
- Acceptance:
  - planner output is normalized before persistence

## T033 Scope inference from code index

- Priority: `P0`
- Phase: `3`
- Goal: infer likely files, symbols, and tests relevant to a task
- Acceptance:
  - every generated task has at least an initial allowed file set

## T034 Intent IR schema and generator

- Priority: `P0`
- Phase: `3`
- Goal: bridge planned tasks into executable runtime input
- Deliverables:
  - goal
  - allowed scope
  - forbidden scope
  - acceptance
  - recommended commands
- Acceptance:
  - Intent IR is sufficient to compile runtime permissions and verifier inputs

## T035 DAG persistence

- Priority: `P0`
- Phase: `3`
- Goal: store feature, node, edge, and task planning state in SQLite
- Acceptance:
  - a generated plan can be reloaded later without recomputing it from the prompt

## T036 DAG show CLI renderer

- Priority: `P1`
- Phase: `3`
- Goal: render a saved planning graph in a way that is understandable from the terminal
- Acceptance:
  - users can inspect feature structure, task ordering, and dependency shape without opening the DB

## T037 Task list CLI renderer

- Priority: `P1`
- Phase: `3`
- Goal: render planned runnable tasks with status, dependencies, and initial scope
- Acceptance:
  - users can decide what to run next by reading `xiezhi task list`
