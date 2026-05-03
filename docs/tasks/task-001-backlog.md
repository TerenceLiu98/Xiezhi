# Task Backlog

## Current Recommendation

The first controlled patch loop is complete. Based on PRD v2, the best next path is:

1. Finish Phase 9 clarity work so task state and runtime evidence are trustworthy.
2. Land Phase 10 semantic scope so AST and symbol data can act as hard guardrails.
3. Build the Phase 11 agent-framework MVP around one AgentPlan-to-agent-run vertical path.
4. Add Phase 12 observability and context packs so operators can see what agents are doing.
5. Add Phase 13 recovery loops for retry, split, reassign, and integration.
6. Leave Phase 14 product and governance surfaces until the technical MVP has proven itself.

## Backlog Summary

| ID | Title | Phase | Priority | Status | Depends On |
| --- | --- | --- | --- | --- | --- |
| T001 | Repo scaffold and package setup | 0 | P0 | done | - |
| T002 | TypeScript build and Vitest setup | 0 | P0 | done | T001 |
| T003 | CLI entrypoint and command registration | 0 | P0 | done | T001 |
| T004 | Config loader and runtime config parsers | 0 | P0 | done | T001 |
| T005 | SQLite bootstrap and Drizzle migrations | 0 | P0 | done | T001 |
| T006 | Logging and shared error model | 0 | P0 | done | T001 |
| T010 | Persistent schema finalization | 1 | P0 | done | T005 |
| T011 | Repository metadata service | 1 | P0 | done | T005 |
| T012 | Worktree manager | 1 | P0 | done | T010 |
| T013 | Patch record service | 1 | P0 | done | T010 |
| T014 | Command log persistence | 1 | P1 | done | T010 |
| T015 | Shared runtime contracts | 1 | P0 | done | T006 |
| T016 | Failure taxonomy and recovery messaging | 1 | P1 | done | T006 |
| T020 | ts-morph project loader | 2 | P0 | done | T010 |
| T021 | File and symbol extractor | 2 | P0 | done | T020 |
| T022 | Import/export and reference edges | 2 | P0 | done | T021 |
| T023 | Component and test heuristics | 2 | P1 | done | T021 |
| T024 | Route heuristic extractor | 2 | P1 | done | T021 |
| T025 | Code graph persistence | 2 | P0 | done | T021 |
| T026 | Incremental indexing | 2 | P1 | done | T025 |
| T027 | Index summary formatter | 2 | P0 | done | T025 |
| T030 | Feature DAG schema and validation | 3 | P0 | done | T010 |
| T031 | Task DAG execution model | 3 | P0 | done | T030 |
| T032 | AgentPlan prompt and response normalization | 3 | P0 | done | T031 |
| T033 | AgentPlan scope validation | 3 | P0 | done | T025 |
| T034 | Intent IR schema and generator | 3 | P0 | done | T031,T033 |
| T035 | DAG persistence | 3 | P0 | done | T030 |
| T036 | DAG show CLI renderer | 3 | P1 | done | T035 |
| T037 | Task list CLI renderer | 3 | P1 | done | T035 |
| T040 | Runtime event model and normalizers | 4 | P0 | done | T015 |
| T041 | Execution policy compiler | 4 | P0 | done | T034,T040 |
| T042 | Task run orchestrator | 4 | P0 | done | T012,T013,T041 |
| T043 | OpenCode adapter | 4 | P0 | done | T040,T042 |
| T044 | Claude adapter | 4 | P1 | done | T040,T042 |
| T045 | Codex adapter | 4 | P1 | done | T040,T042 |
| T046 | Patch capture and persistence | 4 | P0 | done | T042,T043 |
| T047 | Patch discard and retry flow | 4 | P1 | done | T046 |
| T050 | AST snapshot comparer | 5 | P0 | done | T025,T046 |
| T051 | Semantic diff formatter | 5 | P1 | done | T050 |
| T052 | File scope verifier | 5 | P0 | done | T034,T046 |
| T053 | Forbidden scope verifier | 5 | P0 | done | T034,T046 |
| T054 | Test and typecheck ingestion | 5 | P0 | done | T046 |
| T055 | Warning and violation rule engine | 5 | P0 | done | T052,T053,T054 |
| T056 | Review report renderer | 5 | P1 | done | T051,T055 |
| T057 | Verification CLI formatter | 5 | P1 | done | T055 |
| T060 | Fixture repo suite | 6 | P0 | done | T043,T050,T055 |
| T061 | End-to-end smoke tests | 6 | P0 | done | T060 |
| T062 | Multi-runtime compatibility notes | 6 | P1 | done | T044,T045 |
| T063 | CLI UX polish | 6 | P1 | done | T056,T057 |
| T064 | Failure recovery polish | 6 | P1 | done | T016,T057 |
| T065 | Alpha release checklist | 6 | P0 | done | T061 |
| T066 | Demo script and operator notes | 6 | P0 | done | T065 |
| T070 | OpenCode real execution bridge | 7 | P0 | done | T060,T043 |
| T071 | Claude headless execution bridge | 7 | P0 | done | T060,T044 |
| T072 | Codex noninteractive execution bridge | 7 | P0 | done | T060,T045 |
| T073 | Runtime capability matrix | 7 | P1 | done | T070,T071,T072 |
| T074 | File-edit and approval event capture | 7 | P0 | done | T070,T071,T072 |
| T075 | Runtime-specific policy compiler | 7 | P1 | done | T041,T070,T071,T072 |
| T076 | Integration test matrix | 7 | P0 | done | T070,T071,T072,T074 |
| T080 | Onboarding and doctor flow | 8 | P0 | done | T064,T065 |
| T081 | Install and packaging path | 8 | P0 | done | T065 |
| T082 | CI alpha smoke workflow | 8 | P0 | done | T061,T076 |
| T083 | Exported review artifact | 8 | P1 | done | T056,T057 |
| T084 | Config profiles and presets | 8 | P1 | done | T041,T065 |
| T085 | Operator release notes | 8 | P1 | done | T065,T066 |
| T086 | External alpha feedback loop | 8 | P1 | done | T065,T085 |
| T090 | Patch acceptance and promotion flow | 9 | P0 | todo | T046,T055 |
| T091 | Patch integrity verifier rules | 9 | P0 | todo | T046,T055 |
| T092 | Verification command policy hardening | 9 | P0 | todo | T041,T054,T055 |
| T093 | Semantic diff completeness | 9 | P1 | todo | T050,T051 |
| T094 | Review and verify evidence upgrade | 9 | P1 | todo | T056,T057,T093 |
| T095 | Structured failure summaries in CLI | 9 | P1 | todo | T016,T064 |
| T096 | Patch history and task linkage views | 9 | P1 | todo | T047,T090 |
| T117 | Task lifecycle clarity | 9 | P0 | todo | T090,T096 |
| T118 | Runtime launch evidence | 9 | P0 | todo | T042,T046,T096 |
| T100 | Intent IR v2 schema and persistence | 10 | P1 | todo | T034,T035 |
| T101 | Semantic policy compiler | 10 | P1 | todo | T041,T100 |
| T102 | Semantic scope verifier | 10 | P1 | todo | T055,T101 |
| T103 | AgentPlan-backed DAG import | 10 | P1 | todo | T032,T033,T035 |
| T104 | Richer DAG model and status transitions | 10 | P1 | todo | T030,T031,T035,T103 |
| T105 | Risk and dependency heuristics | 10 | P2 | todo | T055,T093 |
| T106 | Acceptance traceability and goal-match scoring | 10 | P2 | todo | T094,T103 |
| T125 | MVP semantic scope verifier | 10 | P0 | todo | T100,T101,T102 |
| T110 | AgentPlan schema and importer | 11 | P1 | todo | T103,T104 |
| T111 | Subagent run persistence and event stream | 11 | P1 | todo | T110,T096 |
| T112 | Subagent runtime contract and assignment adapter | 11 | P1 | todo | T110,T101 |
| T113 | DAG-to-assignment compiler | 11 | P1 | todo | T103,T110,T112 |
| T116 | Semantic guardrails in delegated execution | 11 | P1 | todo | T102,T112,T125 |
| T120 | Agent framework session skeleton | 11 | P0 | todo | T103,T104,T117 |
| T121 | Agent run persistence MVP | 11 | P0 | todo | T110,T118 |
| T122 | Assignment contract MVP | 11 | P0 | todo | T100,T112,T121 |
| T126 | Note-taking MVP demo | 11 | P0 | todo | T117,T118,T120,T121,T122,T125 |
| T114 | Agent and task observability surfaces | 12 | P1 | todo | T111,T121 |
| T119 | Task show deep view | 12 | P0 | todo | T096,T117,T118 |
| T123 | Context Pack Builder | 12 | P1 | todo | T100,T122 |
| T115 | Agent decision evidence and recovery loop | 13 | P1 | todo | T094,T111,T113 |
| T124 | Agent decision loop MVP | 13 | P0 | todo | T115,T118,T125 |
| T127 | Task split and retry policy | 13 | P1 | todo | T104,T115,T124 |
| T128 | Simple integration agent | 13 | P2 | todo | T112,T124,T127 |
| T130 | Product roadmap view | 14 | P2 | todo | T114,T126 |
| T131 | Version history | 14 | P2 | todo | T090,T115,T124 |
| T132 | Product-language risk reports | 14 | P2 | todo | T094,T125,T126 |
| T133 | Policy templates | 14 | P2 | todo | T101,T122 |
| T134 | Audit records | 14 | P2 | todo | T111,T115,T131 |
| T135 | CI integration hooks | 14 | P2 | todo | T092,T094,T132 |

## First Build Slice

If we want the fastest path to the PRD v2 technical MVP, the next slice should be:

- `T117` and `T118`
- `T120`, `T121`, and `T122`
- `T119`
- `T125`
- `T126`

That slice is enough to demo one agent-planned task with clear runtime evidence, task visibility, patch capture, and semantic verification.
