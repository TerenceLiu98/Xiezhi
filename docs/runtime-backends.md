# Runtime Backends

XieZhi orchestrates agent runtimes. It should not become an agent runtime itself.

## Backend Interface

A runtime backend should support:

```text
start_session(workspace, prompt, tools, policy) -> SessionId
send_message(session_id, message) -> EventStream
stop_session(session_id)
run_task(workspace, assignment) -> AgentRunResult
```

The Rust core normalizes backend events into XieZhi events.

## Target Backends

### OpenCode

Initial primary backend.

Needed capabilities:

- start long-running supervisor session
- run implementation turns in workspace
- stream text/tool/progress events when possible
- pass provider/model selection
- apply workspace-scoped permissions

### Codex

Future backend.

Needed capabilities:

- execute tasks in isolated workspace
- expose event stream or JSON output
- integrate with XieZhi tool contracts

### Claude Code

Future backend.

Needed capabilities:

- run in non-interactive workspace mode
- respect permissions
- emit parseable progress/evidence

## Tool Injection

Backends may receive XieZhi-provided tools.

Candidate tools:

- `work_get`
- `work_update`
- `decision_declare`
- `progress_report`
- `execution_graph_propose`
- `proof_report`
- `scope_revision`
- `tracker_get`
- `tracker_update`

Tool injection is how XieZhi avoids prompt-only orchestration over time.

## Event Normalization

Backend-specific events should normalize into:

- supervisor message
- progress report
- decision point
- execution graph proposal
- agent run started
- file change
- command log
- proof result
- problem report
- recovery proposal
- session stopped

The Tauri UI consumes normalized events, not backend-specific event formats.

## Current Skeleton

The Rust skeleton does not launch runtime processes yet.

`xiezhi run` now creates a `SupervisorSession` and writes a `xiezhi-supervisor-intake.md` artifact into the run workspace. That artifact is the first durable runtime contract: it contains the goal, workspace path, runtime/model selection, workflow instructions, proof requirements, and the supported structured outputs for the supervisor.

`xiezhi-runtime` can also extract supported structured JSON objects from mixed runtime text:

- `AgentDecisionPoint v1`
- `AgentProgressReport v1`
- `SupervisorHandoff v1`

The next backend step is to feed the intake prompt to the selected runtime, capture the returned event stream, and persist those normalized objects as store events and orchestration entities.

`xiezhi work intake <run-id>` is the current explicit command for that backend smoke path. It runs the configured command in the run workspace with the supervisor prompt on stdin, records raw stdout/stderr, and updates WorkRun state when a decision point or ready handoff is extracted.

When intake extracts a `SupervisorHandoff v1` with `readyToNormalize=true`, XieZhi creates a draft `ExecutionGraph` from the handoff:

- goal node
- supervisor plan feature node
- one task node per declared subagent plan

This is intentionally minimal. The next layer should replace it with a stricter graph normalization pass that preserves dependencies, proof requirements, declared scope, and assignment metadata.

## Runtime Policy

Runtime permissions are workspace-scoped by default.

Rules:

- no writes outside assigned workspace
- no promotion into target repo without XieZhi
- no deletion of orchestration metadata
- network and shell permissions follow workflow policy
- secrets are injected only through declared environment policy
