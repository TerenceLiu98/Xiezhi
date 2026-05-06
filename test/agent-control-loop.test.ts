import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

import {
  runAgentBuildCommand,
  runAgentFeedbackCommand,
  runAgentPlanCommand,
  runAgentReadyCommand,
  runAgentRunReadyCommand,
  runAgentSessionShowCommand
} from "../src/commands/agent.js"
import { runInit } from "../src/commands/init.js"
import { clearRuntimeAvailabilityCache } from "../src/runtime/shared/capabilities.js"
import { createTempTsRepo } from "./support/git-fixture.js"
import { importRouterPlan, routerAgentPlan } from "./support/agent-plan-fixture.js"

async function withFakeOpenCode(cwd: string, output: string, fn: () => Promise<void>) {
  const binDir = path.join(cwd, ".test-bin")
  await mkdir(binDir, { recursive: true })
  const executable = path.join(binDir, "opencode")
  await writeFile(executable, `#!/bin/sh\ncat <<'JSON'\n${output}\nJSON\n`, "utf8")
  await chmod(executable, 0o755)

  const originalPath = process.env.PATH
  const originalForceScaffold = process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  process.env.PATH = `${binDir}:${originalPath ?? ""}`
  delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  clearRuntimeAvailabilityCache()
  try {
    await fn()
  } finally {
    process.env.PATH = originalPath
    if (originalForceScaffold === undefined) {
      delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
    } else {
      process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES = originalForceScaffold
    }
    clearRuntimeAvailabilityCache()
  }
}

async function withDecisionFakeOpenCode(cwd: string, fn: () => Promise<void>) {
  const binDir = path.join(cwd, ".xiezhi", "test-bin-decision")
  await mkdir(binDir, { recursive: true })
  const executable = path.join(binDir, "opencode")
  await writeFile(
    executable,
    [
      "#!/usr/bin/env node",
      "let input = '';",
      "process.stdin.on('data', chunk => input += chunk);",
      "process.stdin.on('end', () => {",
      "  if (input.includes('PromotionDecision')) {",
      "    const matches = [...input.matchAll(/\"patchId\"\\s*:\\s*\"([^\"]+)\"/g)];",
      "    const patchId = matches.length ? matches[matches.length - 1][1] : 'unknown';",
      "    console.log(JSON.stringify({ version: 'v1', decisions: [{ patchId, decision: 'promote', rationale: ['Synthetic warning accepted.'] }] }));",
      "  } else {",
      "    console.log(JSON.stringify({ type: 'message', text: 'fake opencode completed without edits' }));",
      "  }",
      "});"
    ].join("\n"),
    "utf8"
  )
  await chmod(executable, 0o755)

  const originalPath = process.env.PATH
  const originalForceScaffold = process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  process.env.PATH = `${binDir}:${originalPath ?? ""}`
  delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  clearRuntimeAvailabilityCache()
  try {
    await fn()
  } finally {
    process.env.PATH = originalPath
    if (originalForceScaffold === undefined) {
      delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
    } else {
      process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES = originalForceScaffold
    }
    clearRuntimeAvailabilityCache()
  }
}

async function withBuildFakeOpenCode(cwd: string, planOutput: string, fn: () => Promise<void>) {
  const binDir = path.join(cwd, ".xiezhi", "test-bin-build")
  await mkdir(binDir, { recursive: true })
  const executable = path.join(binDir, "opencode")
  await writeFile(
    executable,
    [
      "#!/usr/bin/env node",
      "import fs from 'node:fs';",
      "let input = '';",
      "process.stdin.on('data', chunk => input += chunk);",
      "process.stdin.on('end', () => {",
      "  if (input.includes('PromotionDecision')) {",
      "    const matches = [...input.matchAll(/\\\"patchId\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"/g)];",
      "    const patchId = matches.length ? matches[matches.length - 1][1] : 'unknown';",
      "    console.log(JSON.stringify({ version: 'v1', decisions: [{ patchId, decision: 'promote', rationale: ['Synthetic build warning accepted.'] }] }));",
      "  } else if (input.includes('main coding agent being harnessed') || input.includes('OpenCode supervisor agent')) {",
      `    console.log(${JSON.stringify(planOutput)});`,
      "  } else {",
      "    if (fs.existsSync('src/helpers.ts')) fs.appendFileSync('src/helpers.ts', '\\nexport const buildLoopTouched = true\\n');",
      "    console.log(JSON.stringify({ type: 'complete', text: 'fake opencode edited one file' }));",
      "  }",
      "});"
    ].join("\n"),
    "utf8"
  )
  await chmod(executable, 0o755)

  const originalPath = process.env.PATH
  const originalForceScaffold = process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  process.env.PATH = `${binDir}:${originalPath ?? ""}`
  delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  clearRuntimeAvailabilityCache()
  try {
    await fn()
  } finally {
    process.env.PATH = originalPath
    if (originalForceScaffold === undefined) {
      delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
    } else {
      process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES = originalForceScaffold
    }
    clearRuntimeAvailabilityCache()
  }
}

async function withSupervisorHandoffFakeOpenCode(cwd: string, handoffOutput: string, planOutput: string, fn: () => Promise<void>) {
  const binDir = path.join(cwd, ".xiezhi", "test-bin-supervisor-handoff")
  await mkdir(binDir, { recursive: true })
  const executable = path.join(binDir, "opencode")
  await writeFile(
    executable,
    [
      "#!/usr/bin/env node",
      "let input = '';",
      "process.stdin.on('data', chunk => input += chunk);",
      "process.stdin.on('end', () => {",
      "  if (input.includes('Convert the supervisor handoff into exactly one strict AgentPlan')) {",
      `    console.log(${JSON.stringify(planOutput)});`,
      "    return;",
      "  }",
      `  console.log(${JSON.stringify(handoffOutput)});`,
      "});"
    ].join("\n"),
    "utf8"
  )
  await chmod(executable, 0o755)

  const originalPath = process.env.PATH
  const originalForceScaffold = process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  process.env.PATH = `${binDir}:${originalPath ?? ""}`
  delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  clearRuntimeAvailabilityCache()
  try {
    await fn()
  } finally {
    process.env.PATH = originalPath
    if (originalForceScaffold === undefined) {
      delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
    } else {
      process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES = originalForceScaffold
    }
    clearRuntimeAvailabilityCache()
  }
}

async function withSchemaRepairFakeOpenCode(cwd: string, planOutput: string, fn: () => Promise<void>) {
  const binDir = path.join(cwd, ".xiezhi", "test-bin-schema-repair")
  await mkdir(binDir, { recursive: true })
  const executable = path.join(binDir, "opencode")
  const counterFile = path.join(binDir, "counter.txt")
  await writeFile(
    executable,
    [
      "#!/usr/bin/env node",
      "import fs from 'node:fs';",
      `const counterFile = ${JSON.stringify(counterFile)};`,
      "let input = '';",
      "process.stdin.on('data', chunk => input += chunk);",
      "process.stdin.on('end', () => {",
      "  const count = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) : 0;",
      "  fs.writeFileSync(counterFile, String(count + 1));",
      "  if (input.includes('Schema repair attempt')) {",
      `    console.log(${JSON.stringify(planOutput)});`,
      "    return;",
      "  }",
      "  console.log(JSON.stringify({ version: 'v1', type: 'plan', tasks: [{ id: 'T1', scope: { files: ['src/app.ts'] }, steps: ['wrong shape'] }] }));",
      "});"
    ].join("\n"),
    "utf8"
  )
  await chmod(executable, 0o755)

  const originalPath = process.env.PATH
  const originalForceScaffold = process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  process.env.PATH = `${binDir}:${originalPath ?? ""}`
  delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  clearRuntimeAvailabilityCache()
  try {
    await fn()
  } finally {
    process.env.PATH = originalPath
    if (originalForceScaffold === undefined) {
      delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
    } else {
      process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES = originalForceScaffold
    }
    clearRuntimeAvailabilityCache()
  }
}

async function withScopeRevisionFakeOpenCode(cwd: string, input: { featureId: string; taskId: string }, fn: () => Promise<void>) {
  const binDir = path.join(cwd, ".xiezhi", "test-bin-scope-revision")
  await mkdir(binDir, { recursive: true })
  const executable = path.join(binDir, "opencode")
  await writeFile(
    executable,
    [
      "#!/usr/bin/env node",
      "import fs from 'node:fs';",
      "let input = '';",
      "process.stdin.on('data', chunk => input += chunk);",
      "process.stdin.on('end', () => {",
      "  if (input.includes('PromotionDecision')) {",
      "    const matches = [...input.matchAll(/\\\"patchId\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"/g)];",
      "    const patchId = matches.length ? matches[matches.length - 1][1] : 'unknown';",
      "    console.log(JSON.stringify({ version: 'v1', decisions: [{ patchId, decision: 'promote', rationale: ['Scope revision warning accepted.'] }] }));",
      "    return;",
      "  }",
      "  if (input.includes('XieZhi evidence summary') && input.includes('heldOrBlocked')) {",
      "    const patchMatches = [...input.matchAll(/\\\"patchId\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"/g)];",
      "    const patchId = patchMatches.length ? patchMatches[patchMatches.length - 1][1] : null;",
      "    console.log(JSON.stringify({",
      "      version: 'v1',",
      "      type: 'scope_revision',",
      `      featureId: ${JSON.stringify(input.featureId)},`,
      `      taskId: ${JSON.stringify(input.taskId)},`,
      "      patchId,",
      "      reason: 'README.md is part of the declared user-facing scaffold evidence.',",
      "      addAllowedFiles: ['README.md'],",
      "      addForbiddenFiles: [],",
      "      addChecks: [],",
      "      addAcceptance: ['README documents the generated app scaffold.'],",
      "      rationale: ['The main agent intentionally created README.md and is revising the task declaration.'],",
      "      action: 'reverify_patch'",
      "    }));",
      "    return;",
      "  }",
      "  fs.appendFileSync('README.md', '\\nScope revision scaffold note\\n');",
      "  console.log(JSON.stringify({ type: 'complete', text: 'fake opencode edited README' }));",
      "});"
    ].join("\n"),
    "utf8"
  )
  await chmod(executable, 0o755)

  const originalPath = process.env.PATH
  const originalForceScaffold = process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  process.env.PATH = `${binDir}:${originalPath ?? ""}`
  delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  clearRuntimeAvailabilityCache()
  try {
    await fn()
  } finally {
    process.env.PATH = originalPath
    if (originalForceScaffold === undefined) {
      delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
    } else {
      process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES = originalForceScaffold
    }
    clearRuntimeAvailabilityCache()
  }
}

describe("agent control loop", () => {
  it("shows ready queue and session evidence", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-ready-")
    await runInit(cwd)
    await withFakeOpenCode(cwd, JSON.stringify(routerAgentPlan()), async () => {
      await runAgentPlanCommand(cwd, "update router user flow", "opencode")

      const ready = runAgentReadyCommand(cwd)
      const session = runAgentSessionShowCommand(cwd)

      expect(ready.readyTasks).toHaveLength(1)
      expect(ready.readyTasks[0]?.canRunWith).toEqual([])
      expect(ready.blockedTasks).toHaveLength(1)
      expect(session.feature?.readyCount).toBe(1)
      expect(session.nextAction).toContain("run-ready")
    })
  }, 15000)

  it("runs one non-conflicting ready wave", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-run-ready-")
    await runInit(cwd)
    const plan = importRouterPlan(cwd, {
      tasks: [
        {
          ...routerAgentPlan().tasks[0]!,
          key: "router",
          dependsOn: [],
          allowedFiles: ["src/router.tsx"]
        },
        {
          ...routerAgentPlan().tasks[1]!,
          key: "helpers",
          dependsOn: [],
          allowedFiles: ["src/helpers.ts"]
        },
        {
          ...routerAgentPlan().tasks[0]!,
          key: "router-conflict",
          title: "Conflicting router task",
          dependsOn: [],
          allowedFiles: ["src/router.tsx"]
        }
      ]
    })

    const result = await runAgentRunReadyCommand(cwd, {
      featureId: plan.featureId,
      runtime: "opencode",
      parallel: 2,
      auto: false,
      decisionRuntime: "opencode"
    })

    expect(result.selectedTaskIds).toHaveLength(2)
    expect(result.skipped.some((skip) => skip.reason.includes("scope conflicts") || skip.reason.includes("parallel limit"))).toBe(true)
    expect(result.runs.every((run) => run.promotion === "not_auto")).toBe(true)
  }, 30000)

  it("keeps draft tasks blocked until dependencies are promoted", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-effective-ready-")
    await runInit(cwd)
    const plan = importRouterPlan(cwd)
    const dependency = plan.tasks[0]!
    const dependent = plan.tasks[1]!

    const db = new Database(path.join(cwd, ".xiezhi", "xiezhi.db"))
    try {
      db.prepare("UPDATE tasks SET status = 'verified' WHERE id = ?").run(dependency.id)
      db.prepare("UPDATE tasks SET status = 'draft' WHERE id = ?").run(dependent.id)
    } finally {
      db.close()
    }

    const ready = runAgentReadyCommand(cwd, plan.featureId)
    expect(ready.readyTasks.map((task) => task.id)).not.toContain(dependent.id)
    const blocked = ready.blockedTasks.find((task) => task.id === dependent.id)
    expect(blocked?.blockedReasons[0]?.reason).toBe("dependency verified but not promoted")
  })

  it("unlocks draft tasks after dependencies are promoted", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-promoted-ready-")
    await runInit(cwd)
    const plan = importRouterPlan(cwd)
    const dependency = plan.tasks[0]!
    const dependent = plan.tasks[1]!

    const db = new Database(path.join(cwd, ".xiezhi", "xiezhi.db"))
    try {
      db.prepare("UPDATE tasks SET status = 'promoted' WHERE id = ?").run(dependency.id)
      db.prepare("UPDATE tasks SET status = 'draft' WHERE id = ?").run(dependent.id)
    } finally {
      db.close()
    }

    const ready = runAgentReadyCommand(cwd, plan.featureId)
    expect(ready.readyTasks.map((task) => task.id)).toContain(dependent.id)
    expect(ready.blockedTasks.some((task) => task.id === dependent.id)).toBe(false)
  })

  it("turns feedback into a follow-up agent plan", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-feedback-")
    await runInit(cwd)
    const source = importRouterPlan(cwd)
    const followup = routerAgentPlan({
      title: "Follow up on feedback",
      goal: "address feedback"
    })

    await withFakeOpenCode(cwd, JSON.stringify(followup), async () => {
      const result = await runAgentFeedbackCommand(cwd, "The editor needs save status.", "opencode", source.featureId)

      expect(result.status).toBe("planned")
      expect(result.sourceFeatureId).toBe(source.featureId)
      expect(result.featureId).not.toBe(source.featureId)
      expect(result.taskCount).toBeGreaterThan(0)
    })
  }, 15000)

  it("uses agent promotion decisions for warning patches in auto mode", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-run-ready-auto-")
    await runInit(cwd)
    const plan = importRouterPlan(cwd, {
      tasks: [{ ...routerAgentPlan().tasks[0]!, checks: [] }]
    })
    await withDecisionFakeOpenCode(cwd, async () => {
        const result = await runAgentRunReadyCommand(cwd, {
          featureId: plan.featureId,
          runtime: "opencode",
          parallel: 1,
          auto: true,
          decisionRuntime: "opencode"
        })

        expect(result.runs).toHaveLength(1)
        expect(result.runs[0]?.verifyStatus).toBe("warning")
        expect(result.runs[0]?.promotion).toBe("promoted")
      }
    )
  }, 20000)

  it("runs agent-declared task checks before auto verification", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-declared-checks-")
    await runInit(cwd)
    const command = 'node -e "process.exit(0)"'
    const plan = importRouterPlan(cwd, {
      tasks: [
        {
          ...routerAgentPlan().tasks[0]!,
          dependsOn: [],
          allowedFiles: ["src/helpers.ts"],
          allowedSymbols: [],
          checks: [command]
        }
      ]
    })

    await withBuildFakeOpenCode(cwd, JSON.stringify(routerAgentPlan()), async () => {
      const result = await runAgentRunReadyCommand(cwd, {
        featureId: plan.featureId,
        runtime: "opencode",
        parallel: 1,
        auto: true,
        decisionRuntime: "opencode"
      })

      const patchId = result.runs[0]!.patchId
      const db = new Database(path.join(cwd, ".xiezhi", "xiezhi.db"))
      try {
        const commandLog = db.prepare("SELECT command, exit_code FROM command_logs WHERE patch_id = ? AND command = ?").get(patchId, command) as
          | { command: string; exit_code: number }
          | undefined
        expect(commandLog).toEqual({ command, exit_code: 0 })
      } finally {
        db.close()
      }
    })
  }, 30000)

  it("build dry-run imports an agent plan without executing waves", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-build-dry-")
    await runInit(cwd)
    const plan = routerAgentPlan({
      tasks: [{ ...routerAgentPlan().tasks[0]!, checks: [], allowedSymbols: [] }]
    })

    await withFakeOpenCode(cwd, JSON.stringify(plan), async () => {
      const result = await runAgentBuildCommand(cwd, {
        goal: "build a pomodoro app",
        runtime: "opencode",
        parallel: 2,
        decisionRuntime: "opencode",
        maxWaves: 20,
        assumeDefaults: false,
        dryRunPlan: true
      })

      expect(result.status).toBe("planned")
      expect(result.featureId).toBeTruthy()
      expect(result.waves).toHaveLength(0)
      const session = runAgentSessionShowCommand(cwd, result.agentSessionId)
      expect(session.session.planSummary).toMatchObject({ assumptions: plan.requirements })
    })
  }, 15000)

  it("runs flexible supervisor intake then normalizes handoff into an AgentPlan", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-supervisor-handoff-")
    await runInit(cwd)
    const plan = routerAgentPlan({
      title: "Pomodoro app normalized plan",
      goal: "build a pomodoro app",
      tasks: [{ ...routerAgentPlan().tasks[0]!, checks: [], allowedSymbols: [] }]
    })
    const handoff = {
      version: "v1",
      type: "supervisor_handoff",
      goal: "build a pomodoro app",
      summary: "Supervisor inspected the empty project and is ready to normalize a bounded DAG.",
      assumptions: ["Use a local web app shell for the MVP."],
      resolvedDecisions: ["Default to local-first UI for smoke testing."],
      subagentPlan: [
        {
          id: "impl-1",
          role: "implementation",
          summary: "Create the timer shell and core state.",
          suggestedScope: ["src/**", "package.json"]
        }
      ],
      normalizationInstructions: ["Create one bounded implementation task with build checks."],
      readyToNormalize: true
    }
    const handoffOutput = [
      JSON.stringify({ type: "text", part: { type: "text", text: "I inspected the repository and found an empty app baseline." } }),
      JSON.stringify({ type: "text", part: { type: "text", text: JSON.stringify(handoff) } })
    ].join("\n")

    await withSupervisorHandoffFakeOpenCode(cwd, handoffOutput, JSON.stringify(plan), async () => {
      const result = await runAgentBuildCommand(cwd, {
        goal: "build a pomodoro app",
        runtime: "opencode",
        parallel: 2,
        decisionRuntime: "opencode",
        maxWaves: 20,
        assumeDefaults: false,
        dryRunPlan: true
      })

      expect(result.status).toBe("planned")
      expect(result.featureId).toBeTruthy()
      const session = runAgentSessionShowCommand(cwd, result.agentSessionId)
      expect(session.supervisorHandoffs[0]?.summary).toContain("ready to normalize")
      expect(session.normalizationEvents.some((event) => event.type === "normalization_completed")).toBe(true)
    })
  }, 15000)

  it("stores agent-declared decision points and waits unless defaults are assumed", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-build-decision-")
    await runInit(cwd)
    const decisionPoint = {
      version: "v1",
      type: "decision_point",
      goal: "build a pomodoro app",
      problem: "The target platform is ambiguous.",
      impact: "Platform choice changes packaging and persistence decisions.",
      recommendedOptionId: "electron",
      options: [
        { id: "electron", label: "Electron desktop app", tradeoff: "Local-first and easy to smoke test.", planDelta: "Plan Electron app tasks." },
        { id: "web", label: "Web app", tradeoff: "Simpler runtime but not a desktop app.", planDelta: "Plan browser-only tasks." }
      ],
      defaultIfUnanswered: "electron"
    }

    await withFakeOpenCode(cwd, JSON.stringify(decisionPoint), async () => {
      const result = await runAgentBuildCommand(cwd, {
        goal: "build a pomodoro app",
        runtime: "opencode",
        parallel: 2,
        decisionRuntime: "opencode",
        maxWaves: 20,
        assumeDefaults: false,
        dryRunPlan: true
      })

      expect(result.status).toBe("waiting_for_decision")
      expect(result.decisionPoints).toHaveLength(1)
      const session = runAgentSessionShowCommand(cwd, result.agentSessionId)
      expect(session.decisionPoints[0]?.summary).toContain("target platform")
    })
  }, 15000)

  it("extracts decision points from OpenCode JSON event text parts", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-build-event-decision-")
    await runInit(cwd)
    const decisionPoint = {
      version: "v1",
      type: "decision_point",
      goal: "build a pomodoro app",
      problem: "Choose the app platform.",
      impact: "The platform determines the implementation plan.",
      recommendedOptionId: "electron",
      options: [
        { id: "electron", label: "Electron", tradeoff: "Desktop app packaging.", planDelta: "Plan Electron tasks." },
        { id: "web", label: "Web", tradeoff: "Browser-only app.", planDelta: "Plan Vite tasks." }
      ],
      defaultIfUnanswered: "electron"
    }
    const opencodeEventOutput = [
      JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
      JSON.stringify({ type: "text", part: { type: "text", text: JSON.stringify(decisionPoint) } })
    ].join("\n")

    await withFakeOpenCode(cwd, opencodeEventOutput, async () => {
      const result = await runAgentBuildCommand(cwd, {
        goal: "build a pomodoro app",
        runtime: "opencode",
        parallel: 2,
        decisionRuntime: "opencode",
        maxWaves: 20,
        assumeDefaults: false,
        dryRunPlan: false
      })

      expect(result.status).toBe("waiting_for_decision")
      expect(result.decisionPoints[0]?.problem).toContain("platform")
    })
  }, 15000)

  it("records problem reports from the main agent", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-build-problem-")
    await runInit(cwd)
    const problemReport = {
      version: "v1",
      type: "problem_report",
      problem: "The repository has no app runtime baseline.",
      evidence: ["No Electron entrypoint exists."],
      proposedSolution: "Generate a bounded bootstrap AgentPlan first.",
      requiresUserDecision: false
    }

    await withFakeOpenCode(cwd, JSON.stringify(problemReport), async () => {
      const result = await runAgentBuildCommand(cwd, {
        goal: "build a pomodoro app",
        runtime: "opencode",
        parallel: 2,
        decisionRuntime: "opencode",
        maxWaves: 20,
        assumeDefaults: false,
        dryRunPlan: false
      })

      expect(result.status).toBe("problem_reported")
      const session = runAgentSessionShowCommand(cwd, result.agentSessionId)
      expect(session.problemReports[0]?.summary).toContain("no app runtime baseline")
      expect(session.proposedSolutions[0]?.summary).toContain("bootstrap AgentPlan")
    })
  }, 15000)

  it("reports OpenCode runtime model errors before build-loop schema validation", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-build-model-error-")
    await runInit(cwd)
    const runtimeError = {
      type: "error",
      error: {
        name: "UnknownError",
        data: {
          message: "Model not found: xiaomi/mimo-v2.5-pro. Did you mean: xiaomi-token-plan-ams?"
        }
      }
    }

    await withFakeOpenCode(cwd, JSON.stringify(runtimeError), async () => {
      await expect(
        runAgentBuildCommand(cwd, {
          goal: "build a pomodoro app",
          runtime: "opencode",
          parallel: 2,
          decisionRuntime: "opencode",
          maxWaves: 20,
          assumeDefaults: false,
          dryRunPlan: false
        })
      ).rejects.toMatchObject({
        message: expect.stringContaining("Agent build runtime failed: Model not found")
      })
    })
  }, 15000)

  it("records supervisor progress and execution plan events from build output", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-build-progress-")
    await runInit(cwd)
    const plan = routerAgentPlan({
      tasks: [{ ...routerAgentPlan().tasks[0]!, checks: [], allowedSymbols: [], parallelGroup: "core", subagentRole: "implementation" }]
    })
    const progress = {
      version: "v1",
      type: "progress_report",
      phase: "planning",
      summary: "Supervisor is splitting the pomodoro app into scoped subagent work.",
      currentTaskId: null,
      executionGroup: "core",
      subagents: [
        {
          id: "impl-1",
          role: "implementation",
          taskId: null,
          status: "planned",
          summary: "Will implement timer core."
        }
      ],
      risks: [],
      nextAction: "Import the AgentPlan and run the first safe execution group."
    }
    const executionPlan = {
      version: "v1",
      type: "execution_plan",
      executionGroups: [
        {
          id: "core",
          summary: "Build the core timer flow.",
          tasks: [plan.tasks[0]!.key],
          parallelism: 1,
          subagents: [{ role: "implementation", taskKey: plan.tasks[0]!.key, reason: "Timer core is isolated." }]
        }
      ]
    }
    const output = [JSON.stringify(progress), JSON.stringify(executionPlan), JSON.stringify(plan)].join("\n")

    await withFakeOpenCode(cwd, output, async () => {
      const result = await runAgentBuildCommand(cwd, {
        goal: "build a pomodoro app",
        runtime: "opencode",
        parallel: 2,
        decisionRuntime: "opencode",
        maxWaves: 20,
        assumeDefaults: false,
        dryRunPlan: true,
        strictPlanFirst: true
      })

      expect(result.status).toBe("planned")
      const session = runAgentSessionShowCommand(cwd, result.agentSessionId)
      expect(session.progressReports.some((report) => report.summary.includes("Supervisor is splitting"))).toBe(true)
      expect(session.executionPlans[0]?.summary).toContain("1 execution group")
    })
  }, 15000)

  it("repairs malformed build-loop output through the main agent", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-build-repair-")
    await runInit(cwd)
    const plan = routerAgentPlan({
      tasks: [{ ...routerAgentPlan().tasks[0]!, checks: [], allowedSymbols: [] }]
    })

    await withSchemaRepairFakeOpenCode(cwd, JSON.stringify(plan), async () => {
      const result = await runAgentBuildCommand(cwd, {
        goal: "build a pomodoro app",
        runtime: "opencode",
        parallel: 2,
        decisionRuntime: "opencode",
        maxWaves: 20,
        assumeDefaults: false,
        dryRunPlan: true,
        strictPlanFirst: true
      })

      expect(result.status).toBe("planned")
      expect(result.featureId).toBeTruthy()
      const session = runAgentSessionShowCommand(cwd, result.agentSessionId)
      expect(session.problemReports[0]?.summary).toContain("schema validation")
      expect(session.proposedSolutions[0]?.summary).toContain("schema repair")
    })
  }, 15000)

  it("runs one build wave and records build events", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-build-wave-")
    await runInit(cwd)
    const plan = routerAgentPlan({
      tasks: [
        {
          ...routerAgentPlan().tasks[0]!,
          dependsOn: [],
          allowedFiles: ["src/helpers.ts"],
          allowedSymbols: [],
          checks: []
        }
      ]
    })

    await withBuildFakeOpenCode(cwd, JSON.stringify(plan), async () => {
      const result = await runAgentBuildCommand(cwd, {
        goal: "build a pomodoro app",
        runtime: "opencode",
        parallel: 1,
        decisionRuntime: "opencode",
        maxWaves: 1,
        assumeDefaults: false,
        dryRunPlan: false
      })

      expect(result.waves).toHaveLength(1)
      expect(result.waves[0]?.runs[0]?.promotion).toBe("promoted")
      const session = runAgentSessionShowCommand(cwd, result.agentSessionId)
      expect(session.buildEvents.some((event) => event.type === "build_wave_started")).toBe(true)
      expect(session.buildEvents.some((event) => event.type === "build_wave_completed")).toBe(true)
    })
  }, 30000)

  it("lets the main agent recover out-of-scope patches with AgentScopeRevision", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-scope-revision-")
    await runInit(cwd)
    const plan = importRouterPlan(cwd, {
      tasks: [
        {
          ...routerAgentPlan().tasks[0]!,
          dependsOn: [],
          allowedFiles: ["src/helpers.ts"],
          allowedSymbols: [],
          checks: []
        }
      ]
    })
    const task = plan.tasks[0]!
    const sqlite = new Database(path.join(cwd, ".xiezhi", "xiezhi.db"))
    try {
      const timestamp = new Date().toISOString()
      sqlite
        .prepare(
          "INSERT INTO agent_sessions (id, goal, feature_id, planning_runtime_name, raw_agent_output, plan_summary_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run("scope-revision-session", "build a pomodoro app", plan.featureId, "opencode", "{}", "{}", "running", timestamp, timestamp)
    } finally {
      sqlite.close()
    }

    await withScopeRevisionFakeOpenCode(cwd, { featureId: plan.featureId, taskId: task.id }, async () => {
      const result = await runAgentBuildCommand(cwd, {
        goal: "build a pomodoro app",
        runtime: "opencode",
        parallel: 1,
        decisionRuntime: "opencode",
        maxWaves: 2,
        assumeDefaults: false,
        dryRunPlan: false
      })

      expect(result.status).toBe("completed")
      const db = new Database(path.join(cwd, ".xiezhi", "xiezhi.db"))
      try {
        const taskRow = db.prepare("SELECT status, intent_ir_json FROM tasks WHERE id = ?").get(task.id) as {
          status: string
          intent_ir_json: string
        }
        expect(taskRow.status).toBe("promoted")
        expect(JSON.parse(taskRow.intent_ir_json).allowedFiles).toContain("README.md")
      } finally {
        db.close()
      }
    })
  }, 30000)

  it("asks the main agent for recovery when a DAG stalls without ready tasks", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-build-stalled-")
    await runInit(cwd)
    const stalledPlan = importRouterPlan(cwd)
    const recoveryPlan = routerAgentPlan({
      title: "Recover stalled DAG",
      tasks: [
        {
          ...routerAgentPlan().tasks[0]!,
          key: "recover-helper",
          title: "Recover helper implementation",
          dependsOn: [],
          allowedFiles: ["src/helpers.ts"],
          allowedSymbols: [],
          checks: [],
          rationale: ["Recover from a stalled rejected DAG with a bounded helper edit."]
        }
      ]
    })
    const sqlite = new Database(path.join(cwd, ".xiezhi", "xiezhi.db"))
    try {
      const timestamp = new Date().toISOString()
      sqlite
        .prepare(
          "INSERT INTO agent_sessions (id, goal, feature_id, planning_runtime_name, raw_agent_output, plan_summary_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run("stalled-build-session", "build a pomodoro app", stalledPlan.featureId, "opencode", "{}", "{}", "running", timestamp, timestamp)
      sqlite.prepare("UPDATE tasks SET status = 'rejected' WHERE feature_id = ?").run(stalledPlan.featureId)
    } finally {
      sqlite.close()
    }

    await withBuildFakeOpenCode(cwd, JSON.stringify(recoveryPlan), async () => {
      const result = await runAgentBuildCommand(cwd, {
        goal: "build a pomodoro app",
        runtime: "opencode",
        parallel: 1,
        decisionRuntime: "opencode",
        maxWaves: 3,
        assumeDefaults: false,
        dryRunPlan: false
      })

      expect(result.status).toBe("completed")
      expect(result.featureId).not.toBe(stalledPlan.featureId)
      expect(result.waves).toHaveLength(1)
      const session = runAgentSessionShowCommand(cwd, "stalled-build-session")
      expect(session.problemReports.some((report) => report.summary.includes("stalled"))).toBe(true)
    })
  }, 30000)
})
