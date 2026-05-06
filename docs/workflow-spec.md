# Workflow Spec

XieZhi should not hardcode a single team process. A repository or project should define how autonomous work is orchestrated through a workflow file.

Candidate file names:

- `XIEZHI.md`
- `.xiezhi/workflow.md`

The file uses YAML front matter for machine-readable configuration and markdown body for supervisor instructions.

## Example

```md
---
work:
  source:
    kind: local

workspace:
  root: ~/.xiezhi/workspaces
  run_prefix: run
  agent_prefix: agent
  proof_prefix: proof
  base_policy: from_promoted_parent
  cleanup:
    completed: archive
    failed: retain

agent_runtime:
  kind: opencode
  command: opencode serve
  model: xiaomi-token-plan-ams/mimo-v2.5-pro

limits:
  max_concurrent_agent_runs: 4
  max_recovery_attempts: 5

proof:
  required:
    - type: command
      command: npm run build
    - type: smoke
      target: app_launch

hooks:
  after_workspace_create: |
    git status --short
  before_promote: |
    git status --short
---

You are the supervisor agent for this repository.

Ask the human only for product, architecture, UX, or acceptance-policy decisions.
Handle ordinary engineering blockers automatically through recovery proposals.
Keep progress concise and evidence-oriented.
```

## Top-Level Sections

### work

Defines where WorkItems come from.

Initial kinds:

- `local`
- `markdown`

Future kinds:

- `github`
- `linear`
- `jira`

### workspace

Defines where and how isolated workspaces are created.

Important fields:

- `root`
- `run_prefix`
- `agent_prefix`
- `proof_prefix`
- `base_policy`
- `cleanup.completed`
- `cleanup.failed`

Workspace policy should distinguish:

- run workspace: supervisor coordination and intake
- agent workspace: one subagent/task execution
- proof workspace: isolated verification or review

Subagents should not share a writable workspace.

### agent_runtime

Defines the supervisor runtime.

Supported target runtimes:

- `opencode`
- `codex`
- `claude_code`

Runtime backends are adapters. The workflow spec should avoid leaking backend-specific behavior into the orchestration model.

### limits

Defines resource limits.

Examples:

- `max_concurrent_agent_runs`
- `max_turns`
- `max_recovery_attempts`
- `command_timeout_ms`

These are safety limits. The supervisor agent may propose subagent parallelism, but XieZhi validates it against these limits. `max_concurrent_agent_runs` is an agent workspace concurrency ceiling, not XieZhi's planning brain.

### proof

Defines required proof before work can be accepted.

Proof can be declared by workflow, by work item, or by supervisor plan.

XieZhi should never invent product acceptance criteria, but it can enforce proof that has been declared.

### hooks

Hooks allow the repository to customize lifecycle points.

Potential hooks:

- `after_run_workspace_create`
- `after_agent_workspace_create`
- `after_proof_workspace_create`
- `before_supervisor_start`
- `before_agent_run`
- `after_agent_run`
- `after_patch_capture`
- `after_proof`
- `before_promote`
- `after_complete`
- `before_workspace_remove`

Hooks are evidence-producing steps. Their command logs should be attached to the WorkRun.

The current Rust skeleton uses `after_workspace_create` as a transitional hook name. It should be split into run/agent/proof workspace hooks as the workspace model matures.

## Protocol Policy

The workflow markdown body is the supervisor's operating guide.

It should define:

- decision posture
- progress reporting expectations
- validation bar
- out-of-scope handling
- recovery expectations
- final handoff format

The workflow should not replace XieZhi's hard guardrails:

- workspace isolation
- unsafe path rejection
- undeclared scope cannot promote
- proof requirements must be satisfied
- terminal states are durable
- subagent writes are workspace-isolated
- agent workspace promotion is explicit and evidence-backed
