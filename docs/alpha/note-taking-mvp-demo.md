# Note-taking MVP Demo

The MVP demo target is a local Electron note-taking app under:

```sh
/Users/terenceliu/Downloads/development/Xiezhi/demo/notetaking
```

`demo/` is gitignored by the parent XieZhi repo. `demo/notetaking` should be treated as its own local git repository so XieZhi can create isolated task worktrees for the app.

## Runtime

Use the local OpenCode binary from the interactive shell environment:

```sh
source ~/.zshrc
command -v opencode
# /Users/terenceliu/.opencode/bin/opencode
```

Do not build the demo app by manually editing files from the parent workspace. App changes should be produced by XieZhi agent tasks using `--runtime opencode`.

## Product Boundary

The demo is not meant to prove that XieZhi can replace OpenCode, Codex, or another coding agent. It should prove that an agent can use XieZhi as a framework for controlled software work:

- the agent owns orchestration, product judgment, retries, and recovery strategy
- XieZhi owns DAG state, task contracts, AST/code graph evidence, patch capture, verification, review, and promotion
- the agent may revise the DAG when the running app exposes a new gap
- XieZhi should make those revisions visible, bounded, and auditable so the agent does not drift far from the user's goal

For the note-taking MVP, "usable" is therefore an agent/user judgment backed by XieZhi evidence, not a hardcoded XieZhi decision.

## Reset

From the XieZhi repository root:

```sh
pnpm demo:notetaking:reset
```

This deletes and recreates `demo/notetaking` as an ignored local git repository with only reset metadata. It does not create the app source.

## Current Local Flow

From `demo/notetaking`:

```text
node ../../dist/cli.js init
node ../../dist/cli.js agent build "build an Electron note-taking app with local notes, search, tags, and a polished editor" --runtime opencode --parallel 2 --decision-runtime opencode
node ../../dist/cli.js agent session show
npm test
npm run build
```

`agent build` is the preferred user-level flow. The main agent can make reasonable assumptions, expose a structured decision point, or report a problem with a proposed solution. XieZhi records those declarations and then executes only through DAG/AST/patch evidence.

For debugging the loop one step at a time:

```text
node ../../dist/cli.js init
node ../../dist/cli.js agent plan "build an Electron note-taking app with local notes, search, tags, and a polished editor" --runtime opencode
node ../../dist/cli.js dag show
node ../../dist/cli.js task list
node ../../dist/cli.js agent session show
node ../../dist/cli.js agent ready --json
node ../../dist/cli.js task show <task-id>
node ../../dist/cli.js agent run <task-id> --runtime opencode
node ../../dist/cli.js task show <task-id>
node ../../dist/cli.js verify <patch-id>
node ../../dist/cli.js review <patch-id>
node ../../dist/cli.js patch promote <patch-id>
npm test
npm run build
```

For ready waves that have non-overlapping scope, the agent may use:

```text
node ../../dist/cli.js agent run-ready --runtime opencode --parallel 2 --auto --decision-runtime opencode
```

The OpenCode planning run must return strict AgentPlan JSON. XieZhi validates that JSON into a feature DAG, task DAG, Intent IR v2, assignment contracts, and patch evidence.

The generated app files live in the XieZhi task worktree until the patch is promoted into the `demo/notetaking` repository. MVP acceptance requires the app source to exist in the main demo repository and the Electron app to start from that directory.

When manual smoke testing reveals a product gap, such as a blank Electron renderer or awkward note editing, the next step is not to hand-edit the demo:

```text
node ../../dist/cli.js agent feedback "describe the app issue" --runtime opencode
```

The feedback command asks the agent for a follow-up AgentPlan and starts a new bounded loop.
