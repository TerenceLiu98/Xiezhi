# Contract DAG

The ExecutionGraph is the contract DAG for a WorkRun.

It is not XieZhi's hidden plan. It is the supervisor agent's declared responsibility structure, normalized so XieZhi can validate, visualize, and execute it.

## Principles

- the supervisor proposes the DAG
- XieZhi validates the DAG
- the human approves decisions according to governance policy
- subagents execute task nodes in isolated workspaces
- ChangeSets and Proofs attach back to the DAG

## Graph Contents

Node kinds:

- goal
- feature
- requirement
- task
- proof requirement
- workspace
- changeset

Edge kinds:

- contains
- depends_on
- satisfies
- produces
- verified_by
- blocks

## Task Materialization

A task node becomes executable when:

- dependencies are satisfied
- governance policy allows execution
- scope/domain declarations are valid
- required proof is known or explicitly deferred
- workspace base policy is clear

Materialization creates:

```text
Task Node
  -> AgentWorkspace
  -> AgentRun
```

The AgentRun can then produce:

```text
AgentRun
  -> ChangeSet
  -> Proof
```

## Validation

XieZhi validates:

- acyclic dependencies
- missing dependency targets
- unsafe workspace paths
- conflicting parallel scopes
- undeclared external side effects
- proof requirement consistency
- domain constraint compatibility

XieZhi should not validate whether the product idea is good. That belongs to the human/supervisor governance process.

## Graph Revisions

When reality conflicts with the DAG, the supervisor must propose a revision.

Examples:

- scope revision
- dependency revision
- proof revision
- recovery subgraph
- new DecisionPoint
- DelegatedDecision evidence

XieZhi records revisions as explicit events. It should not silently rewrite the contract.

## Visualization

The UI should not show one giant graph by default.

Preferred views:

- WorkRun overview
- pending decisions
- current execution group
- active agent workspaces
- proof status
- full DAG debug view
