# Alpha Demo Script

This script is the shortest reliable demo for the current alpha.

## Setup

```bash
pnpm install
pnpm build
pnpm smoke:alpha
```

## Manual Walkthrough

```bash
xz init
xz index --full
xz plan "update router user flow"
xz task list
xz task run <task-id> --runtime opencode
```

At this point XieZhi prints the worktree path. Open that worktree and make one of the following edits:

## Warning Demo

- Make no code edits
- Run:

```bash
xz verify <patch-id>
xz review <patch-id>
```

Expected result: `warning`

## Accepted Demo

- Edit one allowed test file inside the worktree
- Optionally run the recommended commands inside the worktree
- Run:

```bash
xz verify <patch-id>
xz review <patch-id>
```

Expected result: `accepted`

## Rejected Demo

- Edit `README.md` or another file outside the allowed scope inside the worktree
- Run:

```bash
xz verify <patch-id>
```

Expected result: `rejected`

## Recovery Demo

```bash
xz task discard <patch-id>
# or
xz task retry <patch-id> --runtime codex
```
