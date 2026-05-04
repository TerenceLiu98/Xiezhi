import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

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
      "  } else if (input.includes('main coding agent being harnessed')) {",
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
  })

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
        dryRunPlan: true
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
})
