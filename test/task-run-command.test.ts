import { existsSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { runIndexCommand } from "../src/commands/index.js"
import { runInit } from "../src/commands/init.js"
import { runPlanCommand } from "../src/commands/plan.js"
import { runTaskRetryCommand, runTaskRunCommand } from "../src/commands/task.js"
import { openDatabaseConnection } from "../src/db/client.js"
import { createTempTsRepo } from "./support/git-fixture.js"

describe("task run command", () => {
  it("creates a task worktree and persists a patch record", async () => {
    const cwd = await createTempTsRepo("xiezhi-task-run-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = await runPlanCommand(cwd, "add user invitation flow")

    const taskId = plan.tasks[0]?.id
    expect(taskId).toBeTruthy()

    const result = await runTaskRunCommand(cwd, taskId!, "opencode")

    expect(result.status).toBe("captured")
    expect(result.runtime).toBe("opencode")
    expect(result.mode).toBe("scaffold")
    expect(result.patchId).toBeTruthy()
    expect(result.patchStatus).toBe("pending")
    expect(result.commandLogs).toBeGreaterThan(0)
    expect(result.eventCount).toBeGreaterThan(0)
    expect(result.timeline.length).toBeGreaterThanOrEqual(5)
    expect(result.commands.length).toBeGreaterThan(0)
    expect(existsSync(result.worktreePath)).toBe(true)

    const sqlite = openDatabaseConnection(cwd)
    try {
      const patchCount = sqlite.prepare("SELECT COUNT(*) as count FROM patches").get() as { count: number }
      const taskStatus = sqlite.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as {
        status: string
      } | null

      expect(patchCount.count).toBe(1)
      expect(taskStatus?.status).toBe("running")
    } finally {
      sqlite.close()
    }
  }, 15000)

  it("retries a patch by discarding its worktree and capturing a new patch", async () => {
    const cwd = await createTempTsRepo("xiezhi-task-retry-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = await runPlanCommand(cwd, "add user invitation flow")

    const taskId = plan.tasks[0]?.id
    expect(taskId).toBeTruthy()

    const firstRun = await runTaskRunCommand(cwd, taskId!, "opencode")
    const retried = await runTaskRetryCommand(cwd, firstRun.patchId, "codex")

    expect(retried.status).toBe("retried")
    expect(retried.previousPatchId).toBe(firstRun.patchId)
    expect(retried.patchId).not.toBe(firstRun.patchId)
    expect(retried.runtime).toBe("codex")
    expect(retried.mode).toBe("scaffold")
    expect(retried.worktreePath).toBe(firstRun.worktreePath)
    expect(existsSync(retried.worktreePath)).toBe(true)

    const sqlite = openDatabaseConnection(cwd)
    try {
      const discardedPatch = sqlite.prepare("SELECT status FROM patches WHERE id = ?").get(firstRun.patchId) as {
        status: string
      } | null
      const newPatch = sqlite.prepare("SELECT runtime_name, status FROM patches WHERE id = ?").get(retried.patchId) as {
        runtime_name: string
        status: string
      } | null

      expect(discardedPatch?.status).toBe("discarded")
      expect(newPatch?.runtime_name).toBe("codex")
      expect(newPatch?.status).toBe("pending")
    } finally {
      sqlite.close()
    }
  }, 15000)
})
