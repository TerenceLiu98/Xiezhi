# Agent Framework Architecture

Status: `planned`

## Goal

XieZhi is the DAG, AST, assignment, patch, and evidence framework for coding agents. It does not decide product strategy, invent greenfield scaffolds, or run a hardcoded orchestration loop. OpenCode, Codex, Claude Code, or another main agent owns planning and orchestration.

```text
user goal
  -> main agent
    -> understands intent
    -> emits strict AgentPlan JSON
  -> XieZhi
    -> validates and persists Feature DAG, Task DAG, Intent IR, and policy
  -> main agent
    -> chooses the next task and runtime
  -> XieZhi
    -> compiles an assignment contract and captures the agent patch
  -> main agent / user
    -> reads evidence, verifies, promotes, retries, or revises the plan
```

## Principles

- The agent owns intent understanding, decomposition, sequencing, retries, and product judgment.
- XieZhi owns normalization, persistence, scope contracts, AST evidence, patch lifecycle, and verification.
- Plans are imported as structured state, not inferred by XieZhi heuristics.
- Assignments are contracts over an existing task, not a new planning brain.
- Product acceptance remains an agent/user judgment backed by XieZhi evidence.

## Command Model

```bash
xiezhi agent plan "<goal>" --runtime opencode
xiezhi dag show
xiezhi task list
xiezhi task show <task-id>
xiezhi agent run <task-id> --runtime opencode
xiezhi verify <patch-id>
xiezhi review <patch-id>
xiezhi patch promote <patch-id>
```

`task run` remains a low-level compatibility alias for running a scoped task. The documentation mainline uses `agent run`.

## AgentPlan v1

The planning runtime must return strict JSON:

```json
{
  "version": "v1",
  "feature": {
    "title": "Usable note-taking app",
    "summary": "Build a local Electron notes app"
  },
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
      "rationale": "The product needs a runnable baseline before feature work."
    }
  ]
}
```

XieZhi validates dependencies, cycles, path safety, required acceptance criteria, and scope fields before persisting the graph.

## Data Model

- `agent_sessions`: planning runtime, raw output, normalized feature/task summary, status.
- `assignments`: task contract containing goal, file scope, symbol scope, acceptance, checks, expected outputs, and policy.
- `agent_runs`: runtime invocation for one task, linked to assignment, task, patch, and status.
- `agent_events`: compact lifecycle and evidence events from the runtime.

## Demo Acceptance

The note-taking MVP proves the framework when a deleted and reset `demo/notetaking` repo can be rebuilt through the agent-driven loop:

```text
init -> agent plan -> DAG/task inspect -> agent run -> verify -> review -> promote -> app smoke -> feedback plan
```

The final app must be promoted into the `demo/notetaking` main repository, not left only inside `.xiezhi/worktrees`.
