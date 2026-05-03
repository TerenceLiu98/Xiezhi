# Supervisor and Subagent Architecture

Status: `planned`

## Goal

Move XieZhi from a controlled single-runtime patch loop into a supervised multi-agent software construction loop:

```text
user intent
  -> main agent
    -> understands intent
    -> builds Feature DAG and Task DAG
    -> infers AST-scoped task boundaries
    -> assigns tasks to subagents
  -> subagents
    -> execute one task each inside constrained scope
    -> return patches, logs, and intermediate status
  -> main agent
    -> verifies outputs
    -> retries, advances, or escalates
```

## Why This Exists

The current XieZhi loop is good at:

- constraining one runtime invocation to a task
- capturing one patch
- verifying whether that patch stayed in scope

It is not yet good at:

- supervising multiple workers across a larger goal
- showing what a runtime is doing while it runs
- letting one agent decompose work while other agents implement it
- carrying semantic task ownership across a longer-lived execution graph

The supervisor model addresses those gaps while preserving XieZhi's core strengths: DAG planning, AST-aware scope control, and patch verification.

## Core Principles

- The main agent owns intent understanding, decomposition, and task progression.
- Subagents own execution of one bounded task at a time.
- DAG and AST data are not just context; they are control surfaces.
- A subagent may propose a patch, but only the supervisor can advance the task graph.
- Human operators should be able to see what is running, what has finished, and why the supervisor made a decision.

## Roles

### Main Agent

The main agent is the supervisor.

Responsibilities:

- understand the user goal
- build or refine the Feature DAG and Task DAG
- infer file scope, symbol scope, and operation scope
- decide which tasks are ready and which subagent should own them
- merge evidence from patches, tests, and semantic diffs
- decide accept, retry, reassign, split, or escalate

The main agent should not directly do broad implementation work when that work can be delegated safely.

### Subagent

Each subagent is a bounded worker.

Responsibilities:

- execute a single task or a very small task bundle
- stay inside allowed file, symbol, and operation scope
- emit intermediate status updates
- return patch artifacts, command results, and a compact execution summary

A subagent should not:

- rewrite the DAG
- expand its own scope
- decide global sequencing
- silently modify unrelated modules

## DAG and AST Responsibilities

### DAG

The DAG becomes the supervisor's coordination model.

It should express:

- feature goals
- executable tasks
- dependencies
- review gates
- verification requirements
- escalation boundaries

### AST and Code Graph

The AST and code graph become the supervisor's semantic control plane.

They should support:

- file-level scope
- symbol-level scope
- operation-level scope
- semantic diffing against expected task touchpoints
- detection of cross-task interference

In this model, AST data is not optional planning context. It is how the supervisor decides whether a subagent actually stayed on task.

## Command Model

The likely command surface for this architecture is:

```bash
xiezhi supervisor run "<goal>"
xiezhi supervisor resume <run-id>
xiezhi agent list
xiezhi agent show <agent-id>
xiezhi task show <task-id>
xiezhi task watch <task-id>
```

High-level behavior:

- `xiezhi supervisor run` creates or updates a DAG from the user goal
- the supervisor assigns one or more ready tasks to subagents
- subagents emit status and artifacts
- the supervisor verifies outputs and advances the graph

## Data Model Additions

The current task and patch model is not enough. We will need at least:

- `supervisor_runs`
  - root goal
  - current status
  - active feature id
  - latest decision summary
- `agent_runs`
  - agent id
  - role
  - assigned task id
  - runtime
  - status
  - started at / heartbeat / finished at
- `agent_events`
  - assignment
  - step update
  - file focus
  - tool usage
  - patch proposed
  - escalation
- richer `tasks`
  - owner agent id
  - assignment status
  - patched state
  - failure state

## Lifecycle

The target execution loop becomes:

1. User provides a broad goal.
2. Main agent turns the goal into a Feature DAG and Task DAG.
3. Main agent infers semantic scope for each ready task.
4. Main agent assigns a task to a subagent.
5. Subagent runs inside a constrained worktree or equivalent sandbox.
6. Subagent emits progress and returns artifacts.
7. Main agent verifies patch and semantic relevance.
8. Main agent advances the DAG, retries, splits, or escalates.

## Operator Experience

To be trustworthy, the operator should be able to answer:

- which agent is working on what right now
- whether that agent is real or scaffolded
- what files or symbols it is expected to touch
- what patch it proposed
- why the supervisor accepted or rejected that patch

That means XieZhi eventually needs:

- live task and agent visibility
- per-task rationale views
- explicit supervisor decision summaries
- clear distinction between `running`, `patched`, `verified`, and `done`

## Non-Goals

This architecture does not require:

- free-form autonomous coding without boundaries
- removing human review
- replacing the semantic verifier with agent self-report
- turning every runtime into a fully interactive IDE

## Incremental Rollout

The safest rollout path is:

1. complete Phase 9 lifecycle and evidence hardening
2. complete Phase 10 semantic scope and richer planning groundwork
3. add a supervisor execution model on top of those controls
4. add subagent visibility and retry or escalation loops
5. only then broaden to more autonomous orchestration patterns

## Success Criteria

This architecture is successful when:

- the main agent, not the human, does most intent understanding and decomposition
- subagents implement bounded tasks rather than one giant free-form prompt
- semantic scope is enforced at least at file and symbol level
- operators can see why the system is progressing or stalling
- a larger product goal can be completed as a sequence of supervised task runs rather than isolated manual invocations
