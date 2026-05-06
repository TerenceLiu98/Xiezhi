# Work Run Lifecycle

The WorkRun is the center of XieZhi.

## States

```text
created
  -> workspace_ready
  -> supervisor_intake
  -> waiting_for_decision
  -> planning
  -> executing
  -> verifying
  -> recovering
  -> human_acceptance
  -> completed
```

Terminal states:

```text
completed
cancelled
failed
archived
```

## State Semantics

### created

The WorkItem has been accepted by XieZhi, but no workspace exists yet.

### workspace_ready

Workspace is created and bootstrapped by workflow hooks.

### supervisor_intake

The supervisor agent explores context, reports observations, and declares decision points if needed.

Current skeleton behavior:

- creates a durable `SupervisorSession`
- records the selected runtime and model
- transitions the WorkRun to `supervisor_intake`
- does not yet launch or reconnect the runtime process

### waiting_for_decision

XieZhi pauses only for user-facing decisions:

- product shape
- architecture
- UX style
- acceptance policy
- tradeoff that affects user intent

XieZhi should not pause for ordinary engineering errors.

### planning

The supervisor proposes or hands off an execution graph.

XieZhi validates:

- graph shape
- dependencies
- workspace policy
- scope declaration
- proof requirements

### executing

Agent runs modify isolated workspaces.

Execution may be sequential or parallel, but XieZhi treats parallelism as a declared supervisor plan bounded by workflow limits.

### verifying

XieZhi collects proof and checks declaration-vs-reality consistency.

Examples:

- changed files are declared
- changed symbols are declared
- required checks ran
- smoke proof exists
- review warnings are recorded

### recovering

Ordinary blockers are handed back to the supervisor agent.

Valid recovery outputs:

- revised execution graph
- scope revision
- proof revision
- retry plan
- problem report
- decision point, only if user judgment is truly required

### human_acceptance

The user reviews product-relevant outcome and proof summary.

The UI should show:

- what changed
- what decisions were made
- what proof passed
- what risks remain
- how to accept, reject, or request follow-up work

### completed

The work has been accepted, promoted or handed off, and archived according to workflow policy.

## Resume

Every state transition must be durable.

After process restart, XieZhi should be able to:

- reload active WorkRuns
- reconnect or restart supervisor sessions
- inspect workspace status
- continue recovery
- show exact current state in the UI

## Cancellation

Cancellation should:

- stop runtime sessions
- preserve logs
- preserve workspace by default
- mark WorkRun terminal
- avoid partial promotion
