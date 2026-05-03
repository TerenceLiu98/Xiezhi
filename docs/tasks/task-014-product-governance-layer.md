# Product and Governance Layer Tasks

Status: `todo`

## T130 Product roadmap view

- Priority: `P2`
- Phase: `14`
- Goal: present feature and task DAG progress in product language rather than raw graph records
- Deliverables:
  - roadmap-oriented CLI or report view
  - feature status summaries
  - task dependency summaries
- Acceptance:
  - a user can understand product progress without reading DAG internals
  - roadmap status links back to task and patch evidence

## T131 Version history

- Priority: `P2`
- Phase: `14`
- Goal: connect user goals, supervisor runs, accepted patches, and verification evidence into a navigable history
- Deliverables:
  - version or checkpoint records
  - accepted patch grouping
  - history report
- Acceptance:
  - users can answer what changed between two accepted checkpoints
  - history entries link to task and verification records

## T132 Product-language risk reports

- Priority: `P2`
- Phase: `14`
- Goal: translate technical verifier output into user-facing risk language while preserving underlying evidence
- Deliverables:
  - risk summary renderer
  - scope risk, API risk, test risk, and semantic risk categories
  - links to raw verifier evidence
- Acceptance:
  - users can understand why a patch is risky without reading full semantic diff output
  - technical reviewers can still inspect the underlying checks

## T133 Policy templates

- Priority: `P2`
- Phase: `14`
- Goal: let teams encode repository conventions and common forbidden areas without hand-writing policy per task
- Deliverables:
  - policy template format
  - preset loading
  - task policy merge rules
- Acceptance:
  - a repository can define reusable policy constraints
  - generated task policies inherit relevant templates predictably

## T134 Audit records

- Priority: `P2`
- Phase: `14`
- Goal: persist durable audit evidence for supervisor decisions, accepted patches, retries, and escalations
- Deliverables:
  - audit event model
  - audit report
  - links to supervisor, agent, task, patch, and verification records
- Acceptance:
  - accepted work can be traced from user request to decision evidence
  - retry and escalation history is inspectable

## T135 CI integration hooks

- Priority: `P2`
- Phase: `14`
- Goal: make core verification and review artifacts usable from CI without requiring a full interactive supervisor session
- Deliverables:
  - CI-oriented command notes or wrappers
  - machine-readable review artifact requirements
  - failure code conventions
- Acceptance:
  - CI can run or validate the same key checks used by local verification
  - CI output links back to patch or task identifiers where available
