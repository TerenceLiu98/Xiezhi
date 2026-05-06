# Data Model

This document defines the first durable model for the Rust rewrite.

The model is intentionally orchestration-first. Code graphs, AST nodes, and semantic diff return later as evidence attached to WorkRuns and Proofs.

## Entity Overview

```text
WorkItem
  1 -> many WorkRuns

WorkRun
  1 -> 1 active Workspace
  1 -> many SupervisorSessions
  1 -> many DecisionPoints
  1 -> many ExecutionGraphs
  1 -> many AgentRuns
  1 -> many ChangeSets
  1 -> many Proofs
  1 -> many Events
```

## WorkItem

A WorkItem is the thing the user or tracker wants done.

Fields:

- `id`
- `source`
- `title`
- `description`
- `external_ref`
- `status`
- `created_at`
- `updated_at`

Sources:

- `local_goal`
- `markdown`
- `github_issue`
- `linear_issue`
- `jira_issue`

The first implementation only needs `local_goal`.

## WorkRun

A WorkRun is a durable orchestration attempt for a WorkItem.

Fields:

- `id`
- `work_item_id`
- `status`
- `goal`
- `workspace_id`
- `active_supervisor_session_id`
- `created_at`
- `updated_at`
- `completed_at`

Statuses:

- `created`
- `workspace_ready`
- `supervisor_intake`
- `waiting_for_decision`
- `planning`
- `executing`
- `verifying`
- `recovering`
- `human_acceptance`
- `completed`
- `cancelled`
- `failed`
- `archived`

Rules:

- every transition records an Event
- terminal states cannot transition back to active states without creating a new WorkRun
- a WorkRun can be resumed from durable state after process restart

## Workspace

A Workspace is an isolated filesystem area.

Fields:

- `id`
- `work_run_id`
- `kind`
- `path`
- `base_ref`
- `status`
- `created_at`
- `updated_at`

Kinds:

- `run`
- `agent`
- `proof`

Statuses:

- `creating`
- `ready`
- `dirty`
- `archived`
- `removed`
- `failed`

Rules:

- agents write inside assigned workspaces
- promotion into target repo is a XieZhi-controlled operation
- failed workspaces are retained by default

## SupervisorSession

A SupervisorSession is the main agent conversation for a WorkRun.

Fields:

- `id`
- `work_run_id`
- `runtime`
- `model`
- `status`
- `started_at`
- `ended_at`
- `last_event_id`

Statuses:

- `starting`
- `running`
- `waiting`
- `stopped`
- `failed`

The supervisor session owns product and implementation judgment. XieZhi owns orchestration safety and evidence.

## DecisionPoint

A DecisionPoint is the only normal reason to pause for the user.

Fields:

- `id`
- `work_run_id`
- `status`
- `problem`
- `impact`
- `recommended_option_id`
- `options`
- `selected_option_id`
- `created_at`
- `resolved_at`

Valid decision topics:

- product shape
- architecture
- UX and visual style
- acceptance policy
- tradeoff that materially changes user intent

Ordinary engineering blockers should go to recovery, not to the user.

## ExecutionGraph

An ExecutionGraph is the normalized work structure declared by the supervisor.

Fields:

- `id`
- `work_run_id`
- `version`
- `status`
- `nodes`
- `edges`
- `created_at`

Node kinds:

- `goal`
- `feature`
- `requirement`
- `task`
- `proof_requirement`
- `workspace`
- `changeset`

Edge kinds:

- `contains`
- `depends_on`
- `satisfies`
- `produces`
- `verified_by`
- `blocks`

The graph is a contract. It does not decide whether a product file should exist; it records what the supervisor declared and what reality produced.

## AgentRun

An AgentRun is one backend execution against a workspace.

Fields:

- `id`
- `work_run_id`
- `execution_graph_node_id`
- `workspace_id`
- `runtime`
- `model`
- `role`
- `status`
- `started_at`
- `ended_at`

Roles:

- `supervisor`
- `implementation`
- `test`
- `design`
- `review`
- `integration`

## ChangeSet

A ChangeSet is captured output from an AgentRun.

Fields:

- `id`
- `work_run_id`
- `agent_run_id`
- `workspace_id`
- `status`
- `changed_files`
- `diff_ref`
- `created_at`
- `updated_at`

Statuses:

- `captured`
- `verified`
- `held`
- `promoted`
- `rejected`

## Proof

Proof is evidence for acceptance.

Fields:

- `id`
- `work_run_id`
- `changeset_id`
- `proof_type`
- `status`
- `summary`
- `metadata`
- `created_at`

Types:

- `command`
- `semantic_diff`
- `scope_verdict`
- `review`
- `screenshot`
- `app_launch`
- `manual_walkthrough`
- `promotion_commit`
- `tracker_update`

Statuses:

- `pending`
- `passed`
- `warning`
- `failed`
- `blocked`

## Event

Events are the audit trail for everything.

Fields:

- `id`
- `work_run_id`
- `actor`
- `event_type`
- `summary`
- `payload`
- `created_at`

Actors:

- `xiezhi`
- `supervisor_agent`
- `subagent`
- `runtime`
- `user`
- `tracker`

The Work Console should be renderable from WorkRun state plus Events.

