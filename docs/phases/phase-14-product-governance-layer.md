# Phase 14: Product and Governance Layer

Status: `planned`

## Goal

Translate the technical orchestrator into product-facing and team-facing surfaces without losing the DAG, patch, and AST evidence that makes XieZhi trustworthy.

## Scope

- product roadmap view
- product-language explanations of DAG and AST evidence
- version history
- user-friendly risk reports
- policy templates
- audit records
- CI integration hooks

## Deliverables

- roadmap-oriented view of features and task status
- version history that links goals, tasks, patches, and verification
- risk report that explains scope, semantic impact, and checks in product language
- policy templates for repository conventions
- audit trail for agent decisions and promoted patches
- CI integration notes or command hooks

## Acceptance Criteria

- a technical user can explain current project progress without reading raw database rows
- accepted patches are traceable from user goal to task to patch to verification result
- policy decisions and agent decisions are auditable
- CI can consume or reproduce the key verification checks

## Dependencies

- Phase 12 for observability surfaces
- Phase 13 for recovery and decision records

## Primary Tasks

- `T130` product roadmap view
- `T131` version history
- `T132` product-language risk reports
- `T133` policy templates
- `T134` audit records
- `T135` CI integration hooks
