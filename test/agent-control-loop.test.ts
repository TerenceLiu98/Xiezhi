import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
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
})
