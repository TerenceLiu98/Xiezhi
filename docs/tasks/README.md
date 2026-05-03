# XieZhi Task Backlog

This directory contains the implementation task backlog derived from the PRD and the finalized `v1` stack.

## Task Conventions

- Task IDs use the form `T###`
- Status values:
  - `todo`
  - `doing`
  - `done`
  - `blocked`
- Priority values:
  - `P0` core loop blocker
  - `P1` important but not blocking the first loop
  - `P2` nice-to-have

## Suggested Reading Order

1. [task-001-backlog.md](/Users/terenceliu/Downloads/development/xiezhi/docs/tasks/task-001-backlog.md:1)
2. [task-002-core-and-cli.md](/Users/terenceliu/Downloads/development/xiezhi/docs/tasks/task-002-core-and-cli.md:1)
3. [task-003-indexer-and-planning.md](/Users/terenceliu/Downloads/development/xiezhi/docs/tasks/task-003-indexer-and-planning.md:1)
4. [task-004-runtime-and-execution.md](/Users/terenceliu/Downloads/development/xiezhi/docs/tasks/task-004-runtime-and-execution.md:1)
5. [task-005-verification-and-review.md](/Users/terenceliu/Downloads/development/xiezhi/docs/tasks/task-005-verification-and-review.md:1)
6. [task-006-alpha-and-polish.md](/Users/terenceliu/Downloads/development/xiezhi/docs/tasks/task-006-alpha-and-polish.md:1)
7. [task-007-runtime-integration.md](/Users/terenceliu/Downloads/development/xiezhi/docs/tasks/task-007-runtime-integration.md:1)
8. [task-008-release-workflow.md](/Users/terenceliu/Downloads/development/xiezhi/docs/tasks/task-008-release-workflow.md:1)
9. [task-009-control-loop-hardening.md](/Users/terenceliu/Downloads/development/xiezhi/docs/tasks/task-009-control-loop-hardening.md:1)
10. [task-010-semantic-control-and-planning.md](/Users/terenceliu/Downloads/development/xiezhi/docs/tasks/task-010-semantic-control-and-planning.md:1)
11. [../install.md](/Users/terenceliu/Downloads/development/xiezhi/docs/install.md:1)
12. [../presets/README.md](/Users/terenceliu/Downloads/development/xiezhi/docs/presets/README.md:1)

## How to Use This Backlog

- Use the phase docs to decide what we should build next.
- Use the task docs to decide what specific unit of work to pick up.
- When a task grows too large for one implementation pass, split it into child tasks in the same file instead of expanding phase scope.
