import { describe, expect, it } from "vitest"

import { runDagShowCommand } from "../src/commands/dag.js"
import { runInit } from "../src/commands/init.js"
import { runTaskListCommand } from "../src/commands/task.js"
import { XieZhiError } from "../src/core/errors.js"
import { openDatabaseConnection } from "../src/db/client.js"
import { importAgentPlan } from "../src/services/planning-service.js"
import { createTempTsRepo } from "./support/git-fixture.js"
import { importRouterPlan, routerAgentPlan } from "./support/agent-plan-fixture.js"

describe("agent plan import", () => {
  it("persists an agent plan as feature DAG, task DAG, and Intent IR", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-plan-")
    await runInit(cwd)

    const plan = importRouterPlan(cwd)

    expect(plan.status).toBe("planned")
    expect(plan.featureId).toBeTruthy()
    expect(plan.taskCount).toBe(2)
    expect(plan.tasks[0]?.status).toBe("ready")
    expect(plan.tasks[1]?.dependsOnTaskIds).toEqual([plan.tasks[0]!.id])
    expect(plan.tasks.every((task) => task.allowedFiles.length > 0)).toBe(true)

    const dag = await runDagShowCommand(cwd, plan.featureId)
    const taskList = await runTaskListCommand(cwd, plan.featureId)

    expect(dag.status).toBe("loaded")
    expect(dag.structure[0]).toContain("Update router user flow")
    expect(dag.dependencies[0]).toContain("Implement router user flow")
    expect(taskList.tasks).toHaveLength(2)
    expect(taskList.tasks[0]?.recommendedCommands).toContain("pnpm typecheck")

    const sqlite = openDatabaseConnection(cwd)
    try {
      const featureCount = sqlite.prepare("SELECT COUNT(*) as count FROM features").get() as { count: number }
      const taskCount = sqlite.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }
      const intent = sqlite.prepare("SELECT intent_ir_json FROM tasks WHERE id = ?").get(plan.tasks[0]!.id) as {
        intent_ir_json: string
      }

      expect(featureCount.count).toBe(1)
      expect(taskCount.count).toBe(2)
      expect(JSON.parse(intent.intent_ir_json)).toMatchObject({
        version: "v2",
        allowedFiles: expect.arrayContaining(["src/router.tsx"]),
        acceptance: expect.any(Array)
      })
    } finally {
      sqlite.close()
    }
  }, 15000)

  it("rejects invalid task dependencies", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-plan-invalid-dep-")
    await runInit(cwd)

    expect(() =>
      importAgentPlan(
        cwd,
        routerAgentPlan({
          tasks: [
            {
              ...routerAgentPlan().tasks[0]!,
              dependsOn: ["missing-task"]
            }
          ]
        }),
        { runtimeName: "test-agent" }
      )
    ).toThrow(/depends on unknown task/)
  }, 15000)

  it("rejects cyclic dependencies", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-plan-cycle-")
    await runInit(cwd)
    const base = routerAgentPlan()

    expect(() =>
      importAgentPlan(
        cwd,
        {
          ...base,
          tasks: [
            { ...base.tasks[0]!, dependsOn: ["verify-router"] },
            { ...base.tasks[1]!, dependsOn: ["implement-router"] }
          ]
        },
        { runtimeName: "test-agent" }
      )
    ).toThrow(/cycle/)
  }, 15000)

  it("rejects unsafe plan paths", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-plan-unsafe-")
    await runInit(cwd)

    expect(() =>
      importAgentPlan(
        cwd,
        routerAgentPlan({
          tasks: [{ ...routerAgentPlan().tasks[0]!, allowedFiles: ["../outside.ts"] }]
        }),
        { runtimeName: "test-agent" }
      )
    ).toThrow(XieZhiError)
  }, 15000)
})
