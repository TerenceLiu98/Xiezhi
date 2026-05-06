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

## Runtime Policy

Runtime permissions are workspace-scoped by default.

Rules:

- no writes outside assigned workspace
- no promotion into target repo without XieZhi
- no deletion of orchestration metadata
- network and shell permissions follow workflow policy
- secrets are injected only through declared environment policy

