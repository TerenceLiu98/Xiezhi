# Agent Framework Architecture

Status: `active`

## Goal

XieZhi is the DAG, multi-language AST, assignment, patch, and evidence framework for coding agents. It does not decide product strategy, invent greenfield scaffolds, or replace the main agent. OpenCode, Codex, Claude Code, or another main agent owns planning and product judgment.

```text
user goal
  -> main agent
    -> understands intent
    -> emits strict AgentPlan JSON, AgentDecisionPoint JSON, or ProblemReport JSON
  -> XieZhi
    -> validates and persists Feature DAG, Task DAG, Intent IR, policy, and agent evidence
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
xiezhi agent build "<goal>" --runtime opencode --parallel 2 --decision-runtime opencode
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

`agent build` is the ordinary natural-language entrypoint. It is a harness loop, not a built-in supervisor: the main agent decides whether to plan, expose a decision point, or report a problem. XieZhi validates the shape, records the evidence, and then uses ready queues, assignments, verification, review, and promotion safety to keep execution bounded.

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

## AgentDecisionPoint v1 and ProblemReport v1

When the main agent needs user judgment, it returns strict `AgentDecisionPoint v1` JSON:

```json
{
  "version": "v1",
  "type": "decision_point",
  "goal": "Build a pomodoro app",
  "problem": "The target platform is ambiguous.",
  "impact": "Platform choice changes packaging and persistence.",
  "recommendedOptionId": "electron",
  "options": [
    {
      "id": "electron",
      "label": "Electron desktop app",
      "tradeoff": "Local-first and easy to smoke test.",
      "planDelta": "Plan Electron app tasks."
    }
  ],
  "defaultIfUnanswered": "electron"
}
```

XieZhi validates option ids, stores `decision_point_declared`, and either waits or resolves the default when `--assume-defaults` is used. XieZhi does not invent these product questions.

When the main agent detects a blocker or important issue, it returns strict `ProblemReport v1` JSON. XieZhi stores `agent_problem_reported` and `agent_solution_proposed` so `agent session show` can explain why the loop stopped or what the agent recommended next.

## Data Model

- `agent_sessions`: planning runtime, raw output, normalized feature/task summary, status.
- `assignments`: task contract containing goal, file scope, symbol scope, acceptance, checks, expected outputs, and policy.
- `agent_runs`: runtime invocation for one task, linked to assignment, task, patch, and status.
- `agent_events`: compact lifecycle evidence, including runtime events, promotion decisions, decision points, problem reports, proposed solutions, and build wave events.

## Ready Waves and Promotion Decisions

`xiezhi agent ready --json` exposes ready tasks, blocked tasks, and `canRunWith` scope compatibility so a main agent can choose sequential or parallel execution. `xiezhi agent run-ready` is intentionally mechanical: it runs one safe ready wave and does not decide product direction.

`xiezhi agent build` composes those primitives with a maximum wave count. Each wave records `build_wave_started` and `build_wave_completed`; clean patches are promoted, warning patches use `PromotionDecision v1`, and blocking evidence stops the loop for agent/user recovery.

When `--auto` is used, XieZhi verifies and reviews patches. Clean patches promote automatically. Warning patches are sent to the decision runtime as strict `PromotionDecision v1` JSON; XieZhi enforces hard rules, so blocking patches cannot be promoted even if the agent asks.

## Demo Acceptance

The note-taking MVP proves the framework when a deleted and reset `demo/notetaking` repo can be rebuilt through the agent-driven loop:

```text
init -> agent build -> ready/session inspect -> run-ready evidence -> app smoke -> feedback plan
```

The final app must be promoted into the `demo/notetaking` main repository, not left only inside `.xiezhi/worktrees`.
