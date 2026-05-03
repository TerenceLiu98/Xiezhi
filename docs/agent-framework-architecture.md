# Agent Framework Architecture

Status: `active`

## Goal

XieZhi is the DAG, multi-language AST, assignment, patch, and evidence framework for coding agents. It does not decide product strategy, invent greenfield scaffolds, or replace the main agent. OpenCode, Codex, Claude Code, or another main agent owns planning and product judgment.

```text
user goal
  -> main agent
    -> understands intent
    -> emits strict AgentPlan JSON
  -> XieZhi
    -> validates and persists Feature DAG, Task DAG, Intent IR, and policy
  -> main agent
    -> chooses the next task, ready wave, or feedback plan
  -> XieZhi
    -> compiles assignment contracts, captures patches, verifies evidence
  -> main agent / user
    -> promotes, holds, retries, or revises from feedback
```

## Principles

- The agent owns intent understanding, decomposition, sequencing, retries, and product judgment.
- XieZhi owns normalization, persistence, scope contracts, multi-language AST evidence, patch lifecycle, and verification.
- Plans are imported as structured state, not inferred by XieZhi heuristics.
- Assignments are contracts over an existing task, not a new planning brain.
- Product acceptance remains an agent/user judgment backed by XieZhi evidence.

## Command Model

```bash
xiezhi agent plan "<goal>" --runtime opencode
xiezhi dag show
xiezhi task list
xiezhi agent session show
xiezhi agent ready --json
xiezhi task show <task-id>
xiezhi agent run <task-id> --runtime opencode
xiezhi agent run-ready --runtime opencode --parallel 2 --auto --decision-runtime opencode
xiezhi verify <patch-id>
xiezhi review <patch-id>
xiezhi patch promote <patch-id>
xiezhi agent feedback "what felt wrong in the running app" --runtime opencode
```

`task run` remains a low-level compatibility alias for running a scoped task. The documentation mainline uses `agent run` and `agent run-ready`.

## Multi-language Semantic Layer

XieZhi indexes code through language adapters. The first adapters use Tree-sitter native bindings for TypeScript, TSX, JavaScript, JSX, and Python.

- TS/JS adapters extract files, functions, classes, methods, interfaces/types, components/hooks, routes, and tests.
- Python extracts module files, functions, classes, methods, and test functions.
- Unknown languages remain protected by file-scope verification and are reported as `semantic coverage: file-only`.
- Semantic scope verification is language-neutral: modified symbols outside `allowedSymbols` produce `semantic_scope_violation`.

## AgentPlan v1

The planning runtime must return strict JSON:

```json
{
  "version": "v1",
  "goal": "Build a local Electron notes app",
  "title": "Usable note-taking app",
  "requirements": ["The app starts without a blank window"],
  "tasks": [
    {
      "key": "app.shell",
      "title": "Create Electron app shell",
      "summary": "Set up the app entrypoints and first usable shell",
      "dependsOn": [],
      "allowedFiles": ["package.json", "src/**", "tests/**"],
      "forbiddenFiles": [".xiezhi/**"],
      "allowedSymbols": [],
      "forbiddenSymbols": [],
      "acceptance": ["The app starts without a blank window"],
      "checks": ["npm test", "npm run build"],
      "expectedOutputs": ["Electron app source"],
      "rationale": ["The product needs a runnable baseline before feature work."]
    }
  ]
}
```

XieZhi validates dependencies, cycles, path safety, required acceptance criteria, and scope fields before persisting the graph.

## Data Model

- `agent_sessions`: planning runtime, raw output, normalized feature/task summary, status.
- `assignments`: task contract containing goal, file scope, symbol scope, acceptance, checks, expected outputs, and policy.
- `agent_runs`: runtime invocation for one task, linked to assignment, task, patch, and status.
- `agent_events`: compact lifecycle evidence, including runtime events and agent promotion decisions.

## Ready Waves and Promotion Decisions

`xiezhi agent ready --json` exposes ready tasks, blocked tasks, and `canRunWith` scope compatibility so a main agent can choose sequential or parallel execution. `xiezhi agent run-ready` is intentionally mechanical: it runs one safe ready wave and does not decide product direction.

When `--auto` is used, XieZhi verifies and reviews patches. Clean patches promote automatically. Warning patches are sent to the decision runtime as strict `PromotionDecision v1` JSON; XieZhi enforces hard rules, so blocking patches cannot be promoted even if the agent asks.

## Demo Acceptance

The note-taking MVP proves the framework when a deleted and reset `demo/notetaking` repo can be rebuilt through the agent-driven loop:

```text
init -> agent plan -> ready/session inspect -> run-ready -> verify/review/promote -> app smoke -> feedback plan
```

The final app must be promoted into the `demo/notetaking` main repository, not left only inside `.xiezhi/worktrees`.
