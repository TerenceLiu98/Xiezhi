# Phase 3: Planning

## Goal

Turn natural language intent into a structured execution plan with explicit scope and acceptance criteria.

## Scope

- Feature DAG data model and validation
- Task DAG generation
- Intent IR generation
- Allowed scope inference from repo index
- Plan persistence and CLI display

## Deliverables

- `xiezhi plan "<request>"` generates a feature and task structure
- Tasks include status, dependencies, acceptance, and initial scope
- `xiezhi dag show` and `xiezhi task list` render persisted planning results

## Acceptance Criteria

- A user can inspect generated tasks before running any code changes
- Each task has enough scope information to compile runtime permissions later
- Planning output is understandable without opening the DB directly

## Dependencies

- Phase 2

## Primary Tasks

- `T030` feature DAG schema and validators
- `T031` task DAG execution model and transitions
- `T032` planner prompt and planner response normalization
- `T033` scope inference from code index
- `T034` Intent IR schema and generator
- `T035` DAG persistence layer
- `T036` `xiezhi dag show` renderer
- `T037` `xiezhi task list` renderer
