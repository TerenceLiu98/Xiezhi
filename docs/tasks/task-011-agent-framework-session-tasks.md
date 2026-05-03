# Agent Framework Session Tasks

Status: `todo`

## T110 AgentPlan schema and importer

- Priority: `P0`
- Phase: `11`
- Goal: accept strict AgentPlan JSON from a planning runtime and persist it as normalized XieZhi graph state
- Deliverables:
  - AgentPlan v1 schema
  - `importAgentPlan(cwd, plan, provenance)`
  - dependency, cycle, path, scope, and acceptance validation
- Acceptance:
  - valid AgentPlan JSON creates feature DAG, task DAG, Intent IR v2, and task policies
  - malformed or unsafe plans fail before creating runnable tasks

## T111 Agent session persistence

- Priority: `P0`
- Phase: `11`
- Goal: record planning runtime evidence using agent-session terminology
- Deliverables:
  - `agent_sessions` table
  - raw agent output storage
  - normalized plan summary storage
- Acceptance:
  - every `agent plan` command links a runtime, goal, feature id, raw output, normalized summary, and status

## T112 Assignment contract MVP

- Priority: `P0`
- Phase: `11`
- Goal: convert one task into a bounded worker contract
- Deliverables:
  - assignment shape with goal, file scope, symbol scope, acceptance, checks, expected outputs, and policy summary
  - persisted `assignments` record
  - adapter mapping from assignment to runtime task execution
- Acceptance:
  - agents receive structured contracts rather than broad prompts
  - `task show` can display the latest assignment evidence

## T113 Agent run command

- Priority: `P0`
- Phase: `11`
- Goal: run one task through an external coding agent while preserving patch and evidence traceability
- Deliverables:
  - `xiezhi agent run <task-id> --runtime opencode`
  - `agent_runs` table linkage to assignment, task, runtime, patch, and status
  - compact `agent_events`
- Acceptance:
  - every task run can be traced to an agent run and assignment
  - empty patches are recorded as launched-but-no-edits rather than successful edits

## T116 Semantic guardrails in delegated execution

- Priority: `P1`
- Phase: `11`
- Goal: ensure agent execution respects file and symbol scope
- Deliverables:
  - semantic scope included in assignments
  - verifier integration for delegated patches
  - stable `semantic_scope_violation`
- Acceptance:
  - patches can be rejected for symbol drift even when the file is allowed

## T126 Note-taking MVP demo

- Priority: `P0`
- Phase: `11`
- Goal: rebuild `demo/notetaking` from a reset local repo using XieZhi + OpenCode
- Deliverables:
  - `pnpm demo:notetaking:reset`
  - AgentPlan fixture or real OpenCode plan for an Electron notes app
  - scoped tasks for shell, persistence, create/edit/delete, search, tags, tests, and build
- Acceptance:
  - promoted app source exists in `demo/notetaking`
  - `npm test` and `npm run build` pass
  - Electron launches nonblank
  - manual use confirms create, edit, delete, search, tags, and persistence are good enough for daily demo use
