# XieZhi PRD

> Working title: **XieZhi / Agent-native Coding Orchestrator**  
> Version: Draft v0.1  
> Target stage: Technical MVP

---

## 1. Product Summary

**XieZhi is an agent-native DAG/multi-language AST framework that lets a main agent turn plans into durable task state and constrain code changes through patch evidence and semantic verification.**

In simpler terms:

> XieZhi gives coding agents task boundaries, engineering state, and code-impact guardrails.

XieZhi is **not** trying to replace Claude Code, Codex, Cursor, OpenCode, Copilot, or other coding agents. It also does not act as the product planner or hardcoded orchestrator. Instead, it gives those agents a control layer.

The main agent coordinates the work and emits structured plans. XieZhi validates those plans into DAGs, task contracts, and Intent IR. Subagents execute individual tasks. AST analysis verifies what the agents actually changed.

---

## 2. Problem Statement

Modern coding agents are increasingly capable of understanding repositories, editing files, running commands, fixing bugs, and implementing features. However, as agent capability increases, a new problem appears:

> Agents can write code, but their work is often not sufficiently structured, bounded, attributable, or verifiable.

Common pain points:

1. A user gives a high-level request, and the agent immediately starts editing without enough scope control.
2. The agent's plan is usually a chat message, not executable engineering state.
3. Subagents can be spawned, but their tasks, boundaries, dependencies, and outputs are not always first-class objects.
4. Patch review is still mostly text diff or PR diff based.
5. It is difficult to know whether an agent touched unrelated code.
6. It is difficult to coordinate multiple agents working on dependent tasks.
7. It is difficult to map a patch back to the original task or user intent.
8. Long-running vibe coding sessions can drift away from the original product direction.

XieZhi aims to solve this by turning agent plans into task graphs, giving subagents scoped work units, and verifying patches using file-level and multi-language AST/symbol-level analysis.

---

## 3. Product Positioning

### 3.1 One-line Positioning

> A task graph and multi-language AST guardrail layer for coding agents.

### 3.2 Longer Positioning

> XieZhi is an agent-native control plane that turns LLM plans into executable task graphs and verifies agent patches with multi-language AST-level impact analysis.

### 3.3 What XieZhi Is

XieZhi is:

- A main-agent orchestration runtime.
- A task graph system for coding agents.
- A multi-language AST-aware patch verification layer.
- A control plane for subagent execution.
- A bridge over existing coding agents such as Claude Code, Codex, OpenCode, and others.

### 3.4 What XieZhi Is Not

XieZhi is not:

- A new foundation model.
- A replacement for Claude Code, Codex, Cursor, or Copilot.
- A full IDE in the MVP.
- A full no-code app builder in the MVP.
- A deployment platform in the MVP.
- An enterprise SDLC platform in the MVP.

---

## 4. Target Users

### 4.1 Initial Target Users

The initial target users are technical or semi-technical users already experimenting with coding agents:

1. Developers using Claude Code, Codex, Cursor, OpenCode, Aider, or similar tools.
2. Small teams trying to use agents on larger repositories.
3. Builders who want to use vibe coding but need stronger task boundaries.
4. Engineers who are concerned about agents modifying unrelated code.
5. Developers who want better task-to-patch traceability.

### 4.2 Future Target Users

Potential future users include:

1. Non-technical builders who want to create software through natural language.
2. Teams that want safer AI coding workflows.
3. Organizations using multiple coding agents and needing a neutral orchestration layer.
4. Product teams that want AI-generated features to remain traceable and reviewable.

---

## 5. Core Product Hypothesis

The MVP should validate the following hypothesis:

> A main agent, combined with task DAGs, scoped subagent execution, and AST-based patch verification, can produce more controlled and trustworthy coding-agent output than asking a single agent to directly modify a repository.

This means the first version should focus on control, verification, and coordination rather than trying to become a complete application builder.

---

## 6. Core Design Principles

### 6.1 Let the Main Agent Think Dynamically

The workflow should not be rigidly hardcoded. The main agent should be able to decide when to:

- Clarify requirements.
- Make reasonable assumptions.
- Generate a feature DAG.
- Generate a task DAG.
- Spawn subagents.

The MVP starts with TypeScript, TSX, JavaScript, JSX, and Python semantic adapters. Unsupported languages must be shown as file-scope evidence rather than fake AST certainty.
- Split a task.
- Retry a failed task.
- Ask the user for a decision.
- Accept or reject a patch.

XieZhi should support those decisions with durable DAG state, AST evidence, task contracts, and verification results. It should not replace the main agent with fixed orchestration heuristics.

### 6.2 Enforce Hard Boundaries with Tools

The system should not rely only on prompts such as “do not touch unrelated files.”

Prompt instructions are soft constraints. XieZhi should enforce hard constraints through:

- File-level scope checks.
- Forbidden path checks.
- AST/symbol diffing.
- Public API change detection.
- Test/typecheck execution.
- Patch capture and rollback.

### 6.3 Plan as State, Not Text

A normal coding agent may produce a plan as chat text.

XieZhi should turn plans into structured state:

- Features.
- Tasks.
- Dependencies.
- Allowed scopes.
- Subagent assignments.
- Patches.
- Semantic diffs.
- Verification results.

### 6.4 AST as Ground Truth

The main agent may describe what it intended to do. The subagent may describe what it changed. But the AST tells the system what actually changed.

XieZhi should treat AST/symbol diff as the ground truth for code-impact verification.

### 6.5 Subagents as Task Workers

Subagents should not be given vague high-level requests. They should receive bounded task units with:

- Goal.
- Context.
- Allowed files.
- Forbidden files.
- Expected outputs.
- Acceptance criteria.
- Checks to run.

---

## 7. Core Workflow

The target workflow is:

```text
User request
  ↓
Main agent understands intent
  ↓
Main agent clarifies or makes assumptions
  ↓
Main agent creates feature/task DAG
  ↓
Main agent defines task scopes
  ↓
Main agent spawns subagents
  ↓
Subagents implement tasks
  ↓
System captures patches
  ↓
AST/file diff verifies impact
  ↓
Tests/typecheck run
  ↓
Main agent accepts, rejects, retries, or splits tasks
  ↓
User receives progress and review report
```

---

## 8. Layered Architecture

### 8.1 User Intent Layer

Captures what the user wants in natural language.

Examples:

- “Build a personal note-taking app.”
- “Add search to the note list.”
- “Add tags to notes.”
- “Make the editor autosave.”

### 8.2 Product / Feature DAG Layer

Represents user-facing capabilities and dependencies.

Example:

```text
Notes core
  ├── Create notes
  ├── Edit notes
  ├── Persist notes
  ├── Search notes
  └── Tag notes
```

### 8.3 Engineering Task DAG Layer

Represents implementation tasks for subagents.

Example:

```text
task.note.model
  ↓
task.note.storage
  ↓
task.note.editor
  ↓
task.note.search
```

### 8.4 Agent Execution Layer

Executes tasks through external coding agents or subagents.

Possible runtimes:

- Claude Code.
- Codex.
- OpenCode.
- Aider.
- Other coding-agent CLIs.

### 8.5 Code Intelligence Layer

Understands the repository and validates code changes.

Responsibilities:

- Index files.
- Extract symbols.
- Build AST/symbol graph.
- Compare semantic diffs.
- Detect forbidden changes.
- Detect public API changes.

### 8.6 Verification Layer

Runs checks and produces review reports.

Responsibilities:

- File scope verification.
- AST/symbol diff verification.
- Typecheck.
- Test execution.
- Patch status update.

---

## 9. Core Objects

### 9.1 Feature

A user-facing capability.

```yaml
id: feature.notes.search
description: Search notes by title and body
status: planned | running | done | blocked
```

### 9.2 Task

A bounded engineering unit assigned to a subagent.

```yaml
id: task.notes.search
feature: feature.notes.search
goal: Add search input and filtering for notes

depends_on:
  - task.notes.list

allowed_files:
  - src/features/notes/**

forbidden_files:
  - src/auth/**
  - src/billing/**

acceptance:
  - User can type a search query
  - Notes are filtered by title and body
  - Empty state is shown when no notes match

checks:
  - pnpm typecheck
  - pnpm test
```

### 9.3 Patch

A captured code change generated by a subagent.

```yaml
id: patch.123
task: task.notes.search
changed_files:
  - src/features/notes/NoteList.tsx
  - src/features/notes/search.ts
status: pending | accepted | rejected
```

### 9.4 SemanticDiff

AST/symbol-level summary of a patch.

```yaml
patch: patch.123

added_symbols:
  - filterNotes
  - SearchBox

modified_symbols:
  - NoteList

removed_symbols: []

policy_result:
  forbidden_files_touched: false
  public_symbols_removed: false
  typecheck_passed: true
  tests_passed: true
```

---

## 10. MVP Functional Requirements

## 10.1 P0 Requirements

The MVP must support:

1. Accepting a user request from CLI or simple chat interface.
2. Letting the main agent generate a task DAG.
3. Creating task objects with goal, dependencies, allowed files, forbidden files, and acceptance criteria.
4. Executing a task through a subagent runtime.
5. Capturing the patch produced by the subagent.
6. Checking whether changed files are within the allowed scope.
7. Checking whether forbidden paths were touched.
8. Extracting basic AST/symbol changes from TypeScript files.
9. Producing a semantic diff report.
10. Running typecheck and tests.
11. Marking a patch as accepted or rejected.
12. Producing a review report for the user.

## 10.2 P1 Requirements

After P0, add:

1. Context Pack Builder.
2. Retry failed task.
3. Split task when a task is too large.
4. Simple integration agent for patch conflicts.
5. Affected symbol reporting.
6. Multiple runtime support.
7. Persistent task/patch database.
8. Better review summaries.

## 10.3 P2 Requirements

Later-stage features:

1. Web UI.
2. Product roadmap view.
3. Live preview.
4. Browser-based verification.
5. Version history.
6. Non-technical user mode.
7. Deployment integration.
8. Team collaboration.

---

## 11. Non-goals for MVP

The MVP should not attempt to solve:

1. Full visual app building.
2. Full deployment lifecycle.
3. Enterprise permissions.
4. Payment/auth/database service selection.
5. Full product management.
6. Perfect semantic understanding of all languages.
7. Full monorepo build caching.
8. Complex multi-user collaboration.

The MVP should remain focused on the core proof:

> Can XieZhi make coding-agent output more bounded, traceable, and verifiable?

---

## 12. Example MVP Demo

### 12.1 Demo Repository

A simple React note-taking app.

### 12.2 User Request

```text
Add search and tags to the note app.
```

### 12.3 Main Agent Plan

The main agent creates two feature-level items:

```text
feature.notes.search
feature.notes.tags
```

Then it creates task-level units:

```text
task.notes.search
  - Add search input
  - Add filtering logic
  - Add empty state

task.notes.tags
  - Add tag model
  - Add tag selector
  - Add tag filter
```

### 12.4 Subagent Execution

Subagent A receives `task.notes.search`.

Scope:

```yaml
allowed_files:
  - src/features/notes/**
forbidden_files:
  - src/auth/**
  - src/config/**
```

Subagent B receives `task.notes.tags`.

Scope:

```yaml
allowed_files:
  - src/features/notes/**
forbidden_files:
  - src/auth/**
  - src/config/**
```

### 12.5 Verification Output

Example output:

```text
Task: task.notes.search

Changed files:
- src/features/notes/NoteList.tsx
- src/features/notes/search.ts

Added symbols:
- SearchBox
- filterNotes

Modified symbols:
- NoteList

Policy result:
✅ No forbidden files touched
✅ No public symbols removed
✅ Typecheck passed
✅ Tests passed
```

---

## 13. Competitive Landscape

## 13.1 Professional Coding Agents / Agent IDEs

Examples:

- Claude Code.
- OpenAI Codex.
- Cursor.
- GitHub Copilot coding agent.
- Aider.
- OpenHands.
- SWE-agent.
- Devin.

These products are strong at executing coding tasks. They can read repositories, modify code, run commands, fix bugs, create PRs, and assist developers.

However, most of them are primarily focused on making the agent more capable as a coding worker.

XieZhi is focused on making agent work more structured and verifiable.

### Difference

```text
Existing coding agents:
- Strong executor.
- Can plan and edit code.
- Often session/chat/PR based.

XieZhi:
- Main agent as coordinator.
- Subagents as task workers.
- DAG as executable engineering state.
- AST as code-impact ground truth.
- Policy as hard boundary.
```

## 13.2 AI App Builders / Vibe Coding Products

Examples:

- Lovable.
- Replit Agent.
- Bolt.new.
- v0.

These products are strong at turning natural language into apps, prototypes, websites, and deployable projects. They are especially strong for non-technical users and fast prototyping.

However, they are usually optimized for fast generation and product experience, not necessarily for agent-neutral orchestration or AST-level verification over existing repositories.

### Difference

```text
AI app builders:
- Prompt to app.
- Preview and deploy.
- Great for prototypes.

XieZhi:
- Prompt to controlled task graph.
- Subagent execution with scope.
- Patch verification with AST diff.
- Better suited for controlled evolution of existing repos.
```

## 13.3 Monorepo / Build Graph Tools

Examples:

- Nx.
- Bazel.
- Turborepo.
- Rush.

These tools manage project graphs, build graphs, affected tests, caching, and task scheduling.

XieZhi borrows the graph mindset, but applies it to agent-generated code changes.

### Difference

```text
Traditional monorepo tools:
Human changes code
  -> tool analyzes affected projects
  -> tool runs build/test

XieZhi:
User gives intent
  -> main agent creates task graph
  -> subagents modify scoped areas
  -> AST verifies actual impact
  -> main agent accepts/retries/rejects
```

## 13.4 Static Analysis / Code Review Tools

Examples:

- CodeQL.
- SonarQube.
- Semgrep.
- CodeRabbit.
- Sourcegraph Cody.

These tools are strong at code search, static analysis, security scanning, and PR review.

XieZhi should not compete directly on general static-analysis depth. Its verification is specifically tied to agent task boundaries.

### Difference

```text
Static analysis tools:
- Analyze code quality/security.
- Review PRs.
- Find vulnerabilities.

XieZhi:
- Verifies whether an agent patch stayed within the task boundary.
- Maps patches back to tasks.
- Uses AST diff as part of agent orchestration.
```

---

## 14. Differentiation

## 14.1 Plan Is Executable State

Most agents can produce a plan. XieZhi turns the plan into executable state:

```text
Feature DAG
Task DAG
Task scope
Subagent assignment
Patch record
Semantic diff
Verification result
```

## 14.2 Subagents Are Scoped Task Workers

Subagents do not receive vague prompts. They receive bounded task contracts.

## 14.3 AST Verifies Reality

XieZhi does not only rely on what the agent says it changed. It checks what the code actually changed.

## 14.4 Agent-neutral Control Plane

XieZhi can sit above different coding agents and use them as runtimes.

## 14.5 Existing Repo Evolution

XieZhi is especially valuable when the project already exists and needs controlled, iterative change.

---

## 15. Success Metrics

For MVP validation, measure:

1. Patch scope accuracy.
   - Percentage of patches that stay within allowed files.

2. Task-to-patch traceability.
   - Every patch should map to a task.

3. Review clarity.
   - Can the user understand what changed without reading the full diff?

4. Agent failure recovery.
   - Can failed patches be rejected, retried, or split?

5. Comparison against direct agent usage.
   - Does XieZhi produce smaller, more focused, more reviewable patches?

6. Verification usefulness.
   - Does AST/symbol diff catch changes that text diff review might miss?

---

## 16. Risks

## 16.1 Over-engineering Risk

The product may become too complex before the core hypothesis is proven.

Mitigation:

- Keep MVP focused on task DAG, subagent execution, patch capture, and AST verification.

## 16.2 Agent Capability Absorption Risk

Claude Code, Codex, Cursor, Copilot, or other platforms may build more workflow and subagent orchestration directly into their products.

Mitigation:

- Focus on agent-neutral orchestration.
- Focus on structured task state and AST-level verification.
- Avoid competing as another coding surface.

## 16.3 UX Complexity Risk

DAG and AST concepts may be too technical for non-expert users.

Mitigation:

- Initial target users should be technical.
- Later, translate DAG/AST into product language.

## 16.4 Verification Depth Risk

Basic AST diff may not be enough to prove correctness.

Mitigation:

- Start with simple, useful checks.
- Combine AST diff with typecheck/test.
- Add deeper contract verification later.

## 16.5 Runtime Integration Risk

Different coding agents have different CLI behavior, output formats, and sandbox assumptions.

Mitigation:

- Start with one runtime.
- Define a clean runtime adapter interface.
- Add additional runtimes after the core loop works.

---

## 17. Roadmap

## Phase 0: Technical Spike

Goal: Prove that one task can be scoped, delegated, patched, and verified.

Features:

- Manual task definition.
- One runtime adapter.
- Patch capture.
- File-level verification.
- Basic TypeScript AST symbol diff.

## Phase 1: MVP

Goal: End-to-end user request to task DAG to subagent patch to verification report.

Features:

- Main agent generates task DAG.
- Task objects persisted locally.
- Subagent executes one task at a time.
- Patch captured per task.
- Scope verification.
- AST semantic diff.
- Typecheck/test.
- Review report.

## Phase 2: Better Orchestration

Goal: Make the main agent a more capable coordinator.

Features:

- Context Pack Builder.
- Retry failed tasks.
- Split large tasks.
- Basic integration agent.
- Affected symbols.
- Multiple runtime adapters.

## Phase 3: Product Layer

Goal: Make the system more usable for builders and less technical users.

Features:

- Product roadmap view.
- Live preview.
- Version history.
- Product-language explanation.
- User-friendly risk reports.

## Phase 4: Team / Governance Layer

Goal: Support larger teams and repositories.

Features:

- Multi-agent scheduling.
- Better conflict handling.
- Policy templates.
- Audit records.
- Repo-level conventions.
- CI integration.

---

## 18. Open Questions

1. Which runtime should be supported first?
   - Claude Code?
   - Codex?
   - OpenCode?
   - Aider?

2. How much autonomy should the main agent have before asking the user?

3. What is the minimum useful AST diff for TypeScript projects?

4. Should task scopes be generated automatically or approved by the user?

5. How should failed subagent patches be repaired?

6. Should the MVP be CLI-only or include a minimal web dashboard?

7. Should XieZhi target existing repos first or generated demo repos first?

8. How should task DAG and product DAG map to each other?

---

## 19. Recommended MVP Scope

The recommended MVP should be:

```text
User request
  -> Main agent creates task DAG
  -> Main agent defines task scope
  -> Subagent executes task
  -> System captures patch
  -> System verifies file scope
  -> System generates AST/symbol diff
  -> System runs typecheck/test
  -> Main agent accepts or rejects patch
  -> User sees review report
```

Recommended demo:

```text
Repository: simple React note-taking app
Request: add search and tags
Goal: show that XieZhi produces scoped, traceable, verifiable patches
```

---

## 20. Final Product Thesis

The market already has many coding agents and AI app builders.

The missing layer is not another agent that writes code.

The missing layer is a control system that can answer:

```text
What did the user ask for?
How was it decomposed?
Which subagent worked on which task?
What was each subagent allowed to change?
What did it actually change?
Did it stay within bounds?
Did the checks pass?
Can this patch be accepted, retried, or reverted?
```

XieZhi's thesis:

> As coding agents become more capable, the bottleneck shifts from code generation to code-change governance.

Therefore:

> XieZhi is not another coding agent. It is the engineering control layer for coding agents.
