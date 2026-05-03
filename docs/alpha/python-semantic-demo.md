# Python Semantic Demo

This fixture proves that XieZhi's semantic guardrails are not TypeScript-only.

## Goal

Use a small Python package to validate:

- `xiezhi index` records Python files, functions, classes, methods, and tests.
- semantic diff reports modified Python symbols.
- `allowedSymbols` catches same-file drift when an agent edits the wrong function.
- unsupported extensions are reported as file-only semantic coverage.

## Minimal Flow

```sh
xiezhi init
xiezhi index --full
xiezhi agent plan "update one Python function without touching neighboring functions" --runtime opencode
xiezhi agent ready --json
xiezhi agent run <task-id> --runtime opencode
xiezhi verify <patch-id>
xiezhi review <patch-id>
```

Expected evidence for a scoped Python task:

```text
semantic coverage: ast
modified function: add
blocking violations: none
```

Expected evidence for drift:

```text
semantic_scope_violation
modified function: subtract
```
