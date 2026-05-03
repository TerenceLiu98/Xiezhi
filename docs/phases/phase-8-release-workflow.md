# Phase 8: Release Workflow

Status: `done`

## Goal

Make XieZhi repeatable for external alpha users instead of only for the primary development repo.

## Scope

- install and onboarding flow
- doctor / troubleshooting support
- HTML or artifact export for review results
- CI smoke automation
- configuration presets
- operator-facing release notes

## Deliverables

- repeatable install path
- CI smoke workflow
- exported review artifact format
- operator onboarding checklist
- config presets
- release-note and feedback templates

## Acceptance Criteria

- A new developer can install XieZhi and finish the alpha demo without source spelunking
- CI can enforce the alpha loop on a fixture repo
- Review results can be shared outside the terminal
- A maintainer can package, diagnose, demo, and collect alpha feedback from written docs alone

## Dependencies

- Phase 6 for stable alpha behavior
- Phase 7 for at least one real runtime path

## Primary Tasks

- `T080` onboarding and doctor flow
- `T081` install and packaging path
- `T082` CI alpha smoke workflow
- `T083` exported review artifact
- `T084` config profiles and presets
- `T085` operator release notes
- `T086` external alpha feedback loop
