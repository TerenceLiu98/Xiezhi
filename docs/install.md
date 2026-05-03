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
xiezhi --version
xiezhi doctor
```

## Tarball Install

If you want a shareable local package without publishing:

```bash
pnpm install
pnpm pack
pnpm add -g ./xiezhi-0.1.0.tgz
xiezhi doctor
```

## First-Run Setup

Inside the target repository:

```bash
xiezhi init --preset local-fast
xiezhi doctor
xiezhi index --full
```

If the directory is not a git repository yet, `xiezhi init` will initialize one for you.

If the repository has no commit yet, you can still run `xiezhi bootstrap`, `xiezhi index`, and `xiezhi plan`, but `xiezhi task run` will require a baseline commit first:

```bash
git add .
git commit -m "chore: initial baseline"
```

## Recommended Presets

- `local-fast`
  - best for interactive local use
  - defaults to `claude`
- `ci-guarded`
  - best for stricter automation and packaging demos
  - defaults to `codex`

## Recovery

If `xiezhi doctor` reports missing metadata:

```bash
rm -rf .xiezhi
xiezhi init
xiezhi doctor
```
