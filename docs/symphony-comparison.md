# Symphony Comparison

XieZhi should learn from Symphony, especially its workspace-first approach to autonomous implementation work.

## What To Learn

Symphony reinforces several useful principles:

- autonomous work should run in isolated workspaces
- long-running orchestration needs durable local state
- agents should produce proof of work
- retries and reconciliation need explicit lifecycle handling
- humans should manage work, not line-by-line agent output

XieZhi should adopt the workspace discipline:

```text
task/subagent -> isolated workspace -> changeset -> proof -> promotion
```

## Core Difference

Symphony is primarily an issue-driven coding-agent runner.

XieZhi is a contract orchestration framework.

```text
Symphony:
Issue -> Workspace -> Agent Run -> Proof/PR

XieZhi:
Work Order -> Governance -> Supervisor Contract DAG -> Agent Workspaces -> Evidence -> Acceptance
```

## Responsibility Difference

In XieZhi:

- the supervisor agent is the first responsible contractor
- XieZhi is the governance and evidence layer
- the human can co-manage or delegate
- subagents execute scoped tasks in isolated workspaces

XieZhi should not become a hidden planner. It should require the supervisor to declare plans, decisions, assumptions, subagent strategy, and recovery proposals.

## Domain Difference

Symphony focuses on software implementation workflows.

XieZhi should support code first, but its DAG and evidence model should generalize:

- code
- email
- documents
- CRM
- calendars
- operational workflows

AST evidence is one adapter. Other domains need their own constraint adapters.

## Product Difference

Symphony is closer to a daemon/runner.

XieZhi should become a local governance console:

- decision panel
- delegation charter
- supervisor progress
- subagent workspace map
- contract DAG
- evidence timeline
- final acceptance
