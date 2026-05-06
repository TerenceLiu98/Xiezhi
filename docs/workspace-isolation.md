# Workspace Isolation

XieZhi should follow a workspace-first orchestration model.

Agents do not write directly to the target repository. They work inside isolated workspaces and produce ChangeSets. XieZhi verifies and promotes accepted ChangeSets.

## Topology

```text
Target Repository
  |
  +-- RunWorkspace
  |     supervisor intake
  |     coordination artifacts
  |     progress and handoff evidence
  |
  +-- AgentWorkspace A
  |     subagent task A
  |     ChangeSet A
  |
  +-- AgentWorkspace B
  |     subagent task B
  |     ChangeSet B
  |
  +-- ProofWorkspace
        verification, review, smoke, screenshots
```

## Run Workspace

The run workspace belongs to the WorkRun.

It is used for:

- supervisor intake
- repository exploration
- prompt artifacts
- coordination summaries
- graph proposals

It is not the shared writable workspace for all subagents.

## Agent Workspace

An agent workspace belongs to one AgentRun.

It is used for:

- implementation work
- design artifacts
- test creation
- integration work
- review fixes

Rules:

- one subagent writes to one agent workspace
- agent workspaces do not write to each other
- agent workspaces do not write directly to the target repository
- ChangeSets are captured from agent workspaces

## Proof Workspace

A proof workspace isolates verification when needed.

It is used for:

- command checks
- app launch smoke
- screenshot capture
- review reproduction
- integration verification

## Base Policy

Agent workspace base state should be explicit.

Common policies:

- `from_target_head`: workspace starts from current target repo state
- `from_promoted_parent`: workspace starts from state with dependencies promoted
- `from_changeset`: workspace starts from selected ChangeSet output

Downstream tasks should not assume unpromoted upstream changes.

## Promotion

Promotion is controlled by XieZhi.

Before promotion:

- ChangeSet is captured
- scope/domain constraints are checked
- proof requirements are satisfied
- conflicts are detected
- governance policy is respected

Promotion produces evidence, such as a commit, patch application log, or external handoff record.

## Cleanup

Cleanup is policy-controlled.

Default posture:

- retain failed workspaces
- archive completed workspaces
- remove only when policy explicitly allows it
