import { describe, expect, it } from "vitest"

import { runDagShowCommand } from "../src/commands/dag.js"
import { runIndexCommand } from "../src/commands/index.js"
import { runInit } from "../src/commands/init.js"
import { runBootstrapCommand, runPlanCommand } from "../src/commands/plan.js"
import { runTaskListCommand } from "../src/commands/task.js"
import { XieZhiError } from "../src/core/errors.js"
import { openDatabaseConnection } from "../src/db/client.js"
import { createTempDir, createTempGitRepo, createTempTsRepo } from "./support/git-fixture.js"

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

  it("creates a greenfield bootstrap plan without requiring an index", async () => {
    const cwd = await createTempGitRepo("xiezhi-bootstrap-")
    await runInit(cwd)

    const plan = await runBootstrapCommand(cwd, "帮我做一个记账软件")

    expect(plan.status).toBe("planned")
    expect(plan.title).toBe("Bookkeeping app")
    expect(plan.template).toBe("greenfield-react-ts")
    expect(plan.taskCount).toBe(4)
    expect(plan.starterFiles).toContain("src/features/transactions/transaction-form.tsx")
    expect(plan.starterFiles).toContain("tests/monthly-budget.test.ts")
    expect(plan.tasks[0]?.status).toBe("ready")

    const dag = await runDagShowCommand(cwd, plan.featureId)
    const taskList = await runTaskListCommand(cwd, plan.featureId)

    expect(dag.status).toBe("loaded")
    expect(taskList.tasks).toHaveLength(4)
    expect(taskList.tasks[0]?.title).toContain("Define skeleton")
  }, 15000)

  it("suggests bootstrap when planning is attempted before indexing", async () => {
    const cwd = await createTempGitRepo("xiezhi-no-index-plan-")
    await runInit(cwd)

    await expect(runPlanCommand(cwd, "build a budgeting app")).rejects.toMatchObject({
      code: "CLI_USAGE_ERROR",
      hint: expect.stringContaining("xiezhi bootstrap")
    } satisfies Partial<XieZhiError>)
  }, 15000)

  it("bootstraps a greenfield app after init auto-creates a git repo", async () => {
    const cwd = await createTempDir("xiezhi-bootstrap-plain-")
    await runInit(cwd)

    const plan = await runBootstrapCommand(cwd, "I like to build a note taking app")

    expect(plan.status).toBe("planned")
    expect(plan.taskCount).toBe(4)
    expect(plan.starterFiles).toContain("src/app.tsx")
  }, 15000)
})
