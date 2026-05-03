import { describe, expect, it } from "vitest"

import { runDagShowCommand } from "../src/commands/dag.js"
import { runIndexCommand } from "../src/commands/index.js"
import { runInit } from "../src/commands/init.js"
import { runPlanCommand } from "../src/commands/plan.js"
import { runTaskListCommand } from "../src/commands/task.js"
import { openDatabaseConnection } from "../src/db/client.js"
import { createTempTsRepo } from "./support/git-fixture.js"

describe("planning commands", () => {
  it("persists a feature plan, dag, and tasks", async () => {
    const cwd = await createTempTsRepo("xiezhi-plan-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })

    const plan = await runPlanCommand(cwd, "add user invitation flow and verify tests")

    expect(plan.status).toBe("planned")
    expect(plan.featureId).toBeTruthy()
    expect(plan.taskCount).toBe(3)
    expect(plan.tasks[0]?.status).toBe("ready")
    expect(plan.tasks[1]?.dependsOnTaskIds).toHaveLength(1)
    expect(plan.tasks.every((task) => task.allowedFiles.length > 0)).toBe(true)

    const dag = await runDagShowCommand(cwd, plan.featureId)
    expect(dag.status).toBe("loaded")
    expect(dag.nodeCount).toBeGreaterThanOrEqual(8)
    expect(dag.edgeCount).toBeGreaterThan(0)
    expect(dag.structure[0]).toContain("Add user invitation flow and verify tests")
    expect(dag.coverage.length).toBeGreaterThan(0)

    const taskList = await runTaskListCommand(cwd, plan.featureId)
    expect(taskList.status).toBe("loaded")
    expect(taskList.tasks).toHaveLength(3)
    expect(taskList.tasks[2]?.recommendedCommands.length).toBeGreaterThan(0)

    const sqlite = openDatabaseConnection(cwd)
    try {
      const featureCount = sqlite.prepare("SELECT COUNT(*) as count FROM features").get() as { count: number }
      const dagNodeCount = sqlite.prepare("SELECT COUNT(*) as count FROM dag_nodes").get() as { count: number }
      const taskCount = sqlite.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }

      expect(featureCount.count).toBe(1)
      expect(dagNodeCount.count).toBe(dag.nodeCount)
      expect(taskCount.count).toBe(3)
    } finally {
      sqlite.close()
    }
  }, 15000)
})
