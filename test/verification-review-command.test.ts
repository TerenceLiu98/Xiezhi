import { existsSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { runIndexCommand } from "../src/commands/index.js"
import { runInit } from "../src/commands/init.js"
import { runPlanCommand } from "../src/commands/plan.js"
import { runReviewCommand } from "../src/commands/review.js"
import { runTaskDiscardCommand, runTaskRunCommand } from "../src/commands/task.js"
import { runVerifyCommand } from "../src/commands/verify.js"
import { openDatabaseConnection } from "../src/db/client.js"
import { createTempTsRepo } from "./support/git-fixture.js"

describe("verification and review commands", () => {
  it("verifies and reviews a scaffold patch", async () => {
    const cwd = await createTempTsRepo("xiezhi-verify-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = await runPlanCommand(cwd, "add user invitation flow")
    const taskId = plan.tasks[0]!.id

    const taskRun = await runTaskRunCommand(cwd, taskId, "opencode")
    const verify = await runVerifyCommand(cwd, taskRun.patchId)
    const review = await runReviewCommand(cwd, taskRun.patchId)

    expect(verify.status).toBe("warning")
    expect(verify.patchStatus).toBe("verified")
    expect(verify.warnings.length).toBeGreaterThan(0)
    expect(verify.checks.some((check) => check.status === "missing")).toBe(true)
    expect(review.status).toBe("reviewed")
    expect(review.nextActions.length).toBeGreaterThan(0)

    const sqlite = openDatabaseConnection(cwd)
    try {
      const patchStatus = sqlite.prepare("SELECT status FROM patches WHERE id = ?").get(taskRun.patchId) as {
        status: string
      } | null
      const violationCount = sqlite.prepare("SELECT COUNT(*) as count FROM violations").get() as { count: number }
      const checkCount = sqlite.prepare("SELECT COUNT(*) as count FROM checks").get() as { count: number }

      expect(patchStatus?.status).toBe("verified")
      expect(violationCount.count).toBeGreaterThan(0)
      expect(checkCount.count).toBeGreaterThan(0)
    } finally {
      sqlite.close()
    }
  }, 20000)

  it("discards a patch and removes its worktree", async () => {
    const cwd = await createTempTsRepo("xiezhi-discard-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = await runPlanCommand(cwd, "add user invitation flow")
    const taskId = plan.tasks[0]!.id
    const taskRun = await runTaskRunCommand(cwd, taskId, "opencode")

    expect(existsSync(taskRun.worktreePath)).toBe(true)

    const discard = await runTaskDiscardCommand(cwd, taskRun.patchId)

    expect(discard.status).toBe("discarded")
    expect(discard.patchStatus).toBe("discarded")
    expect(discard.taskStatus).toBe("ready")
    expect(existsSync(taskRun.worktreePath)).toBe(false)
  }, 20000)
})
