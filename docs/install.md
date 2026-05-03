# Install XieZhi

This document describes the supported install paths for the current alpha.

## Prerequisites

- Node.js `22+`
- `pnpm`
- Git
- At least one runtime CLI on `PATH`
  - `claude`
  - `codex`
  - or `opencode`

## Local Repo Install

From the repository root:

```bash
pnpm install
pnpm build
pnpm link --global
xz --version
xz doctor
```

## Tarball Install

If you want a shareable local package without publishing:

```bash
pnpm install
pnpm pack
pnpm add -g ./xiezhi-0.1.0.tgz
xz doctor
```

## First-Run Setup

Inside the target repository:

```bash
xz init --preset local-fast
xz doctor
xz index --full
```

## Recommended Presets

- `local-fast`
  - best for interactive local use
  - defaults to `claude`
- `ci-guarded`
  - best for stricter automation and packaging demos
  - defaults to `codex`

## Recovery

If `xz doctor` reports missing metadata:

```bash
rm -rf .xiezhi
xz init
xz doctor
```
