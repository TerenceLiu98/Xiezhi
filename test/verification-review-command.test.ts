import { existsSync } from "node:fs"
import { appendFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { runIndexCommand } from "../src/commands/index.js"
import { runInit } from "../src/commands/init.js"
import { runPlanCommand } from "../src/commands/plan.js"
import { runReviewCommand } from "../src/commands/review.js"
import { runPatchAcceptCommand, runTaskDiscardCommand, runTaskRunCommand } from "../src/commands/task.js"
import { runVerifyCommand } from "../src/commands/verify.js"
import { openDatabaseConnection } from "../src/db/client.js"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "../src/db/schema.js"
import { PatchRecordService } from "../src/services/patch-record-service.js"
import { createTempTsRepo } from "./support/git-fixture.js"

async function appendPassingVerificationLogs(cwd: string, patchId: string) {
  const sqlite = openDatabaseConnection(cwd)

  try {
    const db = drizzle(sqlite, { schema })
    const patchService = new PatchRecordService(db)
    patchService.appendCommandLogs(patchId, [
      {
        command: "pnpm typecheck",
        exitCode: 0,
        output: "Typecheck passed"
      },
      {
        command: "pnpm test",
        exitCode: 0,
        output: "Tests passed"
      }
    ])
  } finally {
    sqlite.close()
  }
}

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

  it("accepts a verified patch through the patch lifecycle command", async () => {
    const cwd = await createTempTsRepo("xiezhi-accept-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = await runPlanCommand(cwd, "update router user flow")
    const task = plan.tasks.find((entry) => entry.title.startsWith("Verify")) ?? plan.tasks[plan.tasks.length - 1]!
    const taskRun = await runTaskRunCommand(cwd, task.id, "opencode")
    const testFile = task.allowedFiles.find((file) => file.includes(".test.") || file.includes(".spec."))

    expect(testFile).toBeTruthy()

    await appendFile(path.join(taskRun.worktreePath, testFile!), "\n// accepted patch\n", "utf8")
    await appendPassingVerificationLogs(cwd, taskRun.patchId)

    const verify = await runVerifyCommand(cwd, taskRun.patchId)
    const accept = await runPatchAcceptCommand(cwd, taskRun.patchId)
    const review = await runReviewCommand(cwd, taskRun.patchId)

    expect(verify.status).toBe("accepted")
    expect(verify.requiredCheckTypes).toEqual(expect.arrayContaining(["test", "typecheck"]))
    expect(accept.patchStatus).toBe("accepted")
    expect(review.requiredCheckTypes).toEqual(expect.arrayContaining(["test", "typecheck"]))

    const sqlite = openDatabaseConnection(cwd)
    try {
      const patchStatus = sqlite.prepare("SELECT status FROM patches WHERE id = ?").get(taskRun.patchId) as {
        status: string
      } | null

      expect(patchStatus?.status).toBe("accepted")
    } finally {
      sqlite.close()
    }
  }, 20000)

  it("rejects a verification task when required checks did not run", async () => {
    const cwd = await createTempTsRepo("xiezhi-required-checks-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = await runPlanCommand(cwd, "update router user flow")
    const task = plan.tasks.find((entry) => entry.title.startsWith("Verify")) ?? plan.tasks[plan.tasks.length - 1]!
    const taskRun = await runTaskRunCommand(cwd, task.id, "opencode")

    const verify = await runVerifyCommand(cwd, taskRun.patchId)

    expect(verify.status).toBe("rejected")
    expect(verify.requiredCheckTypes).toEqual(expect.arrayContaining(["test", "typecheck"]))
    expect(verify.blockingViolations.some((violation) => violation.type === "required_check_missing")).toBe(true)
  }, 20000)

  it("rejects a patch when the recorded base commit drifted", async () => {
    const cwd = await createTempTsRepo("xiezhi-base-commit-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = await runPlanCommand(cwd, "add user invitation flow")
    const taskRun = await runTaskRunCommand(cwd, plan.tasks[0]!.id, "opencode")

    const sqlite = openDatabaseConnection(cwd)
    try {
      sqlite.prepare("UPDATE patches SET base_commit = ? WHERE id = ?").run("deadbeef", taskRun.patchId)
    } finally {
      sqlite.close()
    }

    const verify = await runVerifyCommand(cwd, taskRun.patchId)

    expect(verify.status).toBe("rejected")
    expect(verify.blockingViolations.some((violation) => violation.type === "base_commit_mismatch")).toBe(true)
  }, 20000)

  it("rejects a patch when its task binding no longer exists", async () => {
    const cwd = await createTempTsRepo("xiezhi-missing-task-")
    const initResult = await runInit(cwd)

    const sqlite = openDatabaseConnection(cwd)
    let patchId = ""
    try {
      const service = new PatchRecordService(drizzle(sqlite, { schema }))
      patchId = service.createPatch({
        taskId: "task.missing",
        baseCommit: initResult.repository.headCommit,
        worktreePath: cwd,
        runtimeName: "opencode",
        changedFiles: [],
        diff: ""
      })
    } finally {
      sqlite.close()
    }

    const verify = await runVerifyCommand(cwd, patchId)

    expect(verify.status).toBe("rejected")
    expect(verify.blockingViolations.some((violation) => violation.type === "missing_task_binding")).toBe(true)
  }, 20000)
})
