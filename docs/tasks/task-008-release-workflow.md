# Release Workflow Tasks

Status: `done`

## T080 Onboarding and doctor flow

- Priority: `P0`
- Phase: `8`
- Goal: help a new user bootstrap or recover without repo spelunking
- Acceptance:
  - common setup and metadata errors surface clear recovery steps
  - `xz doctor` exists and covers node, git, config, DB, and runtime checks

## T081 Install and packaging path

- Priority: `P0`
- Phase: `8`
- Goal: make XieZhi installable outside the dev repo
- Acceptance:
  - maintainers can document one repeatable install flow
  - `README` and `docs/install.md` cover local link and tarball install

## T082 CI alpha smoke workflow

- Priority: `P0`
- Phase: `8`
- Goal: run the alpha loop automatically in CI on a fixture repo
- Acceptance:
  - CI catches lifecycle regressions before merge
  - `.github/workflows/alpha-smoke.yml` runs typecheck, test, build, and alpha smoke

## T083 Exported review artifact

- Priority: `P1`
- Phase: `8`
- Goal: let users share verification and review results outside the terminal
- Acceptance:
  - one export format exists for the review summary
  - `xz review --format json|markdown --output <path>` writes a shareable artifact

## T084 Config profiles and presets

- Priority: `P1`
- Phase: `8`
- Goal: reduce setup friction for common runtime and repo styles
- Acceptance:
  - at least two example presets exist and are documented
  - `xz init --preset local-fast|ci-guarded` is supported

## T085 Operator release notes

- Priority: `P1`
- Phase: `8`
- Goal: keep external alpha users aligned with what changed and what is deferred
- Acceptance:
  - one concise release note template exists
  - template lives in `docs/alpha/release-notes-template.md`

## T086 External alpha feedback loop

- Priority: `P1`
- Phase: `8`
- Goal: turn demo feedback into structured product input
- Acceptance:
  - a maintainer can capture, bucket, and replay alpha feedback into the backlog
  - workflow lives in `docs/alpha/feedback-loop.md`
