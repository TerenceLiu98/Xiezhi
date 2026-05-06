# Agent Framework Architecture

Status: `active`

## Goal

XieZhi is the DAG, multi-language AST, assignment, patch, and evidence framework for coding agents. It does not decide product strategy, invent greenfield scaffolds, or replace the main agent. OpenCode, Codex, Claude Code, or another main agent owns planning and product judgment.

```text
user goal
  -> main agent
    -> understands intent
    -> explores, reports observations, declares decisions, or emits SupervisorHandoff
  -> XieZhi
    -> records supervisor evidence and normalizes handoff into AgentPlan
  -> XieZhi
    -> validates and persists Feature DAG, Task DAG, Intent IR, policy, and agent evidence
  -> main agent
    -> declares subagent execution groups, progress, recovery plans, or user decision points
  -> XieZhi
    -> compiles assignment contracts, captures patches, verifies evidence
  -> main agent / user decision point
    -> automatic recovery, promotion decision, or product choice
```

## Principles

- The agent owns intent understanding, decomposition, sequencing, retries, and product judgment.
- XieZhi owns normalization, persistence, scope contracts, multi-language AST evidence, patch lifecycle, and verification.
- Plans are imported as structured state, not inferred by XieZhi heuristics.
- Assignments are contracts over an existing task, not a new planning brain.
- Product acceptance remains an agent/user judgment backed by XieZhi evidence.

## Command Model

```bash
xiezhi agent build "<goal>" --runtime opencode --ui --parallel 4 --decision-runtime opencode
xiezhi agent build "<goal>" --runtime opencode --strict-plan-first --dry-run-plan
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

OpenCode provider/model selection is passed through as `--model <provider/model>`, for example:

```bash
xiezhi agent build "build a pomodoro app" --runtime opencode --model anthropic/claude-sonnet-4-5 --ui
```

`--decision-model` can override the model used for warning-promotion decisions; by default it reuses `--model`.

`task run` remains a low-level compatibility alias for running a scoped task. The documentation mainline uses `agent run` and `agent run-ready`.

`agent build --ui` is the ordinary natural-language entrypoint. It is a harness loop, not a built-in supervisor: the OpenCode supervisor agent first runs a flexible intake where it can explore the repo, report observations, expose decision points, plan subagent strategy, or report problems without being forced to produce an immediate AgentPlan. For app goals, those decision points should cover MVP feature scope, UI/interaction style, and validation/check policy in addition to platform or architecture when they materially affect the result. When the supervisor is ready, it emits `SupervisorHandoff v1`; XieZhi stores the handoff and asks the same runtime to normalize it into strict `AgentPlan v1`.

`--strict-plan-first` keeps the older debugging path where the first runtime response must be an `AgentPlan`, `AgentDecisionPoint`, or `ProblemReport`. The public build path should prefer supervisor intake because it reduces schema friction and gives the agent room to discover the project before DAG normalization.

## Multi-language Semantic Layer

XieZhi indexes code through language adapters. The first adapters use Tree-sitter native bindings for TypeScript, TSX, JavaScript, JSX, and Python.

- TS/JS adapters extract files, functions, classes, methods, interfaces/types, components/hooks, routes, and tests.
- Python extracts module files, functions, classes, methods, and test functions.
- Unknown languages remain protected by file-scope verification and are reported as `semantic coverage: file-only`.
- Semantic scope verification is language-neutral: modified symbols outside `allowedSymbols` produce `semantic_scope_violation`.

## AgentPlan v1

The normalized planning contract is strict JSON:

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

## SupervisorHandoff v1

During `agent build`, the first runtime call is allowed to be exploratory. The supervisor may emit natural-language observations and structured progress events while it inspects the repository. Once it has enough context, it returns a handoff:

```json
{
  "version": "v1",
  "type": "supervisor_handoff",
  "goal": "Build a pomodoro app",
  "summary": "The repository is empty and ready for a small local app DAG.",
  "assumptions": ["Use a local desktop-friendly app shell unless the user chooses otherwise."],
  "resolvedDecisions": ["Default persistence can be local-first."],
  "subagentPlan": [
    {
      "id": "impl-1",
      "role": "implementation",
      "summary": "Create the timer shell and core state.",
      "suggestedScope": ["src/**", "package.json"]
    }
  ],
  "normalizationInstructions": ["Create bounded tasks with checks and acceptance."],
  "readyToNormalize": true
}
```

XieZhi records `supervisor_handoff`, then asks the runtime to convert the handoff and transcript excerpt into exactly one `AgentPlan v1`. Malformed normalization output gets bounded schema repair. Runtime/model/provider/auth failures are reported as runtime errors, not as schema failures.

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

Validation/check policy is treated as a user-facing decision because it controls speed versus confidence. A supervisor can ask whether the build should use fast smoke checks, build/typecheck as a promotion gate, or build plus tests as the gate. XieZhi records the answer and expects normalized task checks and recovery plans to follow it.

When the main agent detects a blocker or important issue, it returns strict `ProblemReport v1` JSON. XieZhi stores `agent_problem_reported` and `agent_solution_proposed` so `agent session show` can explain why the loop stopped or what the agent recommended next.

## AgentProgressReport v1 and AgentExecutionPlan v1

The supervisor agent may report progress before its final plan/decision/problem object:

```json
{
  "version": "v1",
  "type": "progress_report",
  "phase": "building",
  "summary": "Implementing the timer core and tests.",
  "currentTaskId": "task-id-or-null",
  "executionGroup": "core",
  "subagents": [
    {
      "id": "impl-1",
      "role": "implementation",
      "taskId": "task-id-or-null",
      "status": "running",
      "summary": "Editing the timer state machine."
    }
  ],
  "risks": [],
  "nextAction": "Verify and promote clean patches."
}
```

The supervisor agent may also declare an `AgentExecutionPlan v1` with execution groups and subagent roles. XieZhi records it as evidence and treats `--parallel` as a hard safety/resource limit, not a scheduling decision. Scope conflicts, dependency gaps, blocking verification, and promotion failures are returned to the main agent as recovery evidence; users are only asked for structured product decisions.

## Data Model

- `agent_sessions`: planning runtime, raw output, normalized feature/task summary, status.
- `assignments`: task contract containing goal, file scope, symbol scope, acceptance, checks, expected outputs, and policy.
- `agent_runs`: runtime invocation for one task, linked to assignment, task, patch, and status.
- `agent_events`: compact lifecycle evidence, including runtime events, promotion decisions, decision points, progress reports, execution plans, problem reports, proposed solutions, and build execution-group events.

## Ready Execution Groups and Promotion Decisions

`xiezhi agent ready --json` exposes ready tasks, blocked tasks, subagent role metadata, parallel group metadata, and `canRunWith` scope compatibility so the main agent can choose sequential or parallel execution. `xiezhi agent run-ready` is intentionally mechanical: it runs one safe execution group and does not decide product direction.

Dependency readiness is promotion-gated: a downstream task is runnable only after every dependency has been promoted into the main repository. `verified` means a patch has passed verification in its worktree and can enter review/promotion; it does not mean the dependent task can see those files in the repo root. Ready/blocked output distinguishes `dependency verified but not promoted`, held patches, rejected dependencies, and ordinary draft dependencies.

`xiezhi agent build` composes those primitives with a maximum execution count. Each execution group records `build_wave_started` and `build_wave_completed` for compatibility; CLI/UI labels present them as execution groups. Clean patches are promoted, warning patches use `PromotionDecision v1`, and blocking evidence is fed back to the supervisor agent for automatic recovery unless the agent declares a user-facing DecisionPoint. If a warning is caused by missing checks and no validation policy has been resolved, the supervisor should ask for that policy instead of silently choosing a strictness level.

OpenCode task execution runs inside XieZhi-created git worktrees with `opencode run --format json --dangerously-skip-permissions`. This avoids non-interactive permission prompts inside the isolated task workspace. The assignment prompt explicitly forbids reading from or writing to the parent repository and sibling `.xiezhi/worktrees` directories; XieZhi, not OpenCode, captures and promotes patches back to the main repository.

When `--auto` is used, XieZhi first runs only the task checks declared by the agent plan, appends command logs to patch evidence, then verifies and reviews patches. Clean patches promote automatically. Warning patches are sent to the decision runtime as strict `PromotionDecision v1` JSON; XieZhi enforces hard rules, so blocking patches cannot be promoted even if the agent asks.

Out-of-scope changes are not treated as XieZhi product judgment. The verifier still blocks promotion for undeclared files or symbols, but build recovery sends the changed files, current declarations, checks, and dependency state back to the supervisor agent. If the agent decides the patch is valid and the declaration was too narrow, it can return `AgentScopeRevision v1` to add allowed files, forbidden files, checks, or acceptance criteria and either reverify the same patch or rerun the task. XieZhi validates path safety and ownership, but it does not decide which product files should exist.

## Demo Acceptance

The note-taking MVP proves the framework when a deleted and reset `demo/notetaking` repo can be rebuilt through the agent-driven loop:

```text
init -> agent build -> ready/session inspect -> run-ready evidence -> app smoke -> feedback plan
```

The final app must be promoted into the `demo/notetaking` main repository, not left only inside `.xiezhi/worktrees`.
