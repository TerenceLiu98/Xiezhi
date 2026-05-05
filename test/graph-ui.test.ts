import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"
import Database from "better-sqlite3"

import { runInit } from "../src/commands/init.js"
import { createId } from "../src/core/ids.js"
import { clearRuntimeAvailabilityCache } from "../src/runtime/shared/capabilities.js"
import { getGraphState, getGraphView } from "../src/services/graph-view-service.js"
import { startGraphUiServer } from "../src/services/graph-ui-server.js"
import { createTempTsRepo } from "./support/git-fixture.js"
import { importRouterPlan, routerAgentPlan } from "./support/agent-plan-fixture.js"

async function withFakeOpenCode(cwd: string, output: string, fn: () => Promise<void>) {
  const binDir = path.join(cwd, ".xiezhi", "test-bin-graph-ui")
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

describe("graph harness UI", () => {
  it("exports feature DAG as Cytoscape elements", async () => {
    const cwd = await createTempTsRepo("xiezhi-graph-view-")
    await runInit(cwd)
    const plan = importRouterPlan(cwd)

    const graph = getGraphView(cwd, { featureId: plan.featureId })

    expect(graph.status).toBe("loaded")
    expect(graph.nodes.some((node) => node.data.type === "feature")).toBe(true)
    expect(graph.nodes.some((node) => node.data.type === "task" && node.data.taskId)).toBe(true)
    expect(graph.edges.some((edge) => edge.data.type === "depends_on")).toBe(true)
  })

  it("serves graph state and resolves web decisions", async () => {
    const cwd = await createTempTsRepo("xiezhi-graph-server-")
    await runInit(cwd)
    const plan = importRouterPlan(cwd)
    const sessionId = createId()
    const db = new Database(`${cwd}/.xiezhi/xiezhi.db`)
    try {
      const timestamp = new Date().toISOString()
      db.prepare(
        "INSERT INTO agent_sessions (id, goal, feature_id, planning_runtime_name, raw_agent_output, plan_summary_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(sessionId, "graph test", plan.featureId, "opencode", "{}", "{}", "planned", timestamp, timestamp)
    } finally {
      db.close()
    }
    const server = await startGraphUiServer({ cwd, port: 0, openBrowser: false })

    try {
      const state = await fetch(`${server.url}/api/state`).then((response) => response.json() as Promise<ReturnType<typeof getGraphState>>)
      expect(state.status).toBe("loaded")

      const decisionPromise = server.resolveDecision({
        agentSessionId: state.session!.id,
        decisionPoint: {
          version: "v1",
          type: "decision_point",
          goal: "choose app shell",
          problem: "Choose the app shell.",
          impact: "This determines the generated task graph.",
          recommendedOptionId: "electron",
          options: [
            { id: "electron", label: "Electron", tradeoff: "Desktop app.", planDelta: "Plan Electron tasks." },
            { id: "web", label: "Web", tradeoff: "Browser only.", planDelta: "Plan web tasks." }
          ],
          defaultIfUnanswered: "electron"
        }
      })
      const pendingState = await fetch(`${server.url}/api/state`).then((response) => response.json() as Promise<{ pendingDecision: { id: string } }>)
      expect(pendingState.pendingDecision.id).toBeTruthy()

      const resolveResponse = await fetch(`${server.url}/api/decision/${pendingState.pendingDecision.id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ optionId: "web" })
      })
      expect(resolveResponse.status).toBe(200)
      await expect(decisionPromise).resolves.toBe("web")
    } finally {
      await server.close()
    }
  })

  it("lets the web UI ask the agent for a blocked task recovery plan", async () => {
    const cwd = await createTempTsRepo("xiezhi-graph-recover-")
    await runInit(cwd)
    const plan = importRouterPlan(cwd)
    const recoveryPlan = JSON.stringify(routerAgentPlan({ goal: "recover blocked task", title: "Recover blocked task" }))
    const server = await startGraphUiServer({ cwd, port: 0, openBrowser: false, runtime: "opencode" })

    try {
      await withFakeOpenCode(cwd, recoveryPlan, async () => {
        const response = await fetch(`${server.url}/api/task/${plan.tasks[0]!.id}/recover`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note: "Fix the blocked patch." })
        })
        expect(response.status).toBe(200)
        const result = (await response.json()) as { title: string; taskCount: number }
        expect(result.title).toBe("Recover blocked task")
        expect(result.taskCount).toBe(2)

        const state = await fetch(`${server.url}/api/state`).then((stateResponse) => stateResponse.json() as Promise<{ operation: { status: string } }>)
        expect(state.operation.status).toBe("completed")
      })
    } finally {
      await server.close()
    }
  }, 15000)
})
