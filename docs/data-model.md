# Data Model

This document defines the first durable model for the Rust rewrite.

The model is contract-orchestration-first. Code graphs, AST nodes, and semantic diff are domain evidence attached to WorkRuns, ChangeSets, and Proofs. They are not the center of the system.

## Entity Overview

```text
WorkItem
  1 -> many WorkRuns

WorkRun
  1 -> 1 run Workspace
  1 -> many agent Workspaces
  1 -> many proof Workspaces
  1 -> many SupervisorSessions
  1 -> many DecisionPoints
  1 -> many ExecutionGraphs
  1 -> many AgentRuns
  1 -> many ChangeSets
  1 -> many Proofs
  1 -> many Events

ExecutionGraph task node
  1 -> 0..many AgentRuns

AgentRun
  1 -> 1 agent Workspace
  1 -> 0..1 ChangeSet
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

- `run`: supervisor coordination workspace for the WorkRun
- `agent`: isolated workspace for one AgentRun/subagent task
- `proof`: isolated verification, review, or smoke workspace

Statuses:

- `creating`
- `ready`
- `dirty`
- `archived`
- `removed`
- `failed`

Rules:

- the supervisor works in the run workspace
- every subagent writes inside one assigned agent workspace
- proof collection can use proof workspaces when it needs isolation
- promotion into target repo is a XieZhi-controlled operation
- failed workspaces are retained by default
- downstream agent workspaces should be created from accepted/promoted upstream state

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

The supervisor is the first responsible contractor. XieZhi should not silently rewrite the supervisor's plan; it should request a corrected proposal when the plan conflicts with governance, dependencies, workspace policy, or proof requirements.

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

An ExecutionGraph is the normalized contract structure declared by the supervisor.

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

Rules:

- task nodes represent delegable units of responsibility
- task nodes can be materialized into AgentRuns
- each AgentRun receives an isolated agent Workspace
- dependencies gate workspace creation and execution
- scope/proof declarations are validated against ChangeSets and Proofs
- graph revisions are explicit supervisor proposals, not hidden XieZhi rewrites

## AgentRun

An AgentRun is one backend execution against one agent workspace.

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

Rules:

- normal subagent AgentRuns use `WorkspaceKind::Agent`
- the run workspace is for supervisor coordination, not shared writes
- an AgentRun should be tied to an ExecutionGraph task node whenever possible
- agent parallelism is proposed by the supervisor and bounded by workflow limits

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

Rules:

- ChangeSets are captured from agent workspaces
- promotion into the target repo is controlled by XieZhi
- overlapping ChangeSets require conflict evidence and supervisor recovery
- unpromoted ChangeSets do not unlock downstream work that depends on promoted state

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
