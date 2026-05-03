# Phase 2: Indexer

## Goal

Make the codebase queryable so planning, scope generation, semantic diff, and verification all have a shared understanding of the repo.

## Scope

- TypeScript project loading with `ts-morph`
- Code node extraction
- Code edge extraction
- Initial snapshot persistence
- Incremental re-index strategy
- Basic query surface for later planning and verification

## Deliverables

- `xz index --full` works on a real TypeScript repo
- `xz index --incremental` updates changed files
- Code nodes and edges are stored in SQLite
- CLI prints a human-readable index summary

## Acceptance Criteria

- The indexer identifies the v1 required node types
- Indexing a medium TypeScript repo finishes within the PRD target on a normal laptop
- Planning and verifier layers can ask for files, symbols, imports, exports, tests, and routes

## Dependencies

- Phase 1

## Primary Tasks

- `T020` ts-morph project loader
- `T021` file and symbol extractor
- `T022` import/export and reference edge extraction
- `T023` React component and test heuristics
- `T024` route heuristic extractor
- `T025` code node persistence layer
- `T026` incremental indexing strategy
- `T027` index summary formatter for CLI
