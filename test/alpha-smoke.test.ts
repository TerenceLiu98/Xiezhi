import { appendFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { drizzle } from "drizzle-orm/better-sqlite3"
import { describe, expect, it } from "vitest"

import { runIndexCommand } from "../src/commands/index.js"
import { runInit } from "../src/commands/init.js"
import { runPlanCommand } from "../src/commands/plan.js"
import { runReviewCommand } from "../src/commands/review.js"
import { runTaskRunCommand } from "../src/commands/task.js"
import { runVerifyCommand } from "../src/commands/verify.js"
import { openDatabaseConnection } from "../src/db/client.js"
import * as schema from "../src/db/schema.js"
import { PatchRecordService } from "../src/services/patch-record-service.js"
import { createTempTsRepo } from "./support/git-fixture.js"

type PlannedTaskSummary = {
  id: string
  allowedFiles: string[]
}

function selectTaskForAcceptedFlow(tasks: PlannedTaskSummary[]) {
  return tasks.find((task) => task.allowedFiles.some((file) => file.includes(".test.") || file.includes(".spec."))) ?? tasks[0]!
}

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

describe("alpha smoke flows", () => {
  it("keeps the default scaffold path as a warning flow", async () => {
    const cwd = await createTempTsRepo("xiezhi-alpha-warning-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = await runPlanCommand(cwd, "update router user flow")
    const task = selectTaskForAcceptedFlow(plan.tasks)

    const taskRun = await runTaskRunCommand(cwd, task.id, "opencode")
    const verify = await runVerifyCommand(cwd, taskRun.patchId)
    const review = await runReviewCommand(cwd, taskRun.patchId)

    expect(verify.status).toBe("warning")
    expect(verify.warnings.length).toBeGreaterThan(0)
    expect(review.nextActions.length).toBeGreaterThan(0)
  }, 20000)

  it("accepts a patched worktree when edits stay in scope and tests pass", async () => {
    const cwd = await createTempTsRepo("xiezhi-alpha-accepted-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = await runPlanCommand(cwd, "update router user flow")
    const task = selectTaskForAcceptedFlow(plan.tasks)
    const taskRun = await runTaskRunCommand(cwd, task.id, "opencode")

    const testFile = task.allowedFiles.find((file) => file.includes(".test.") || file.includes(".spec."))
    expect(testFile).toBeTruthy()

    await appendFile(path.join(taskRun.worktreePath, testFile!), "\n// alpha accepted patch\n", "utf8")
    await appendPassingVerificationLogs(cwd, taskRun.patchId)

    const verify = await runVerifyCommand(cwd, taskRun.patchId)
    const review = await runReviewCommand(cwd, taskRun.patchId)

    expect(verify.status).toBe("accepted")
    expect(verify.changedFiles).toContain(testFile!)
    expect(verify.warnings).toHaveLength(0)
    expect(review.summary).toContain("touches 1 file")
  }, 20000)

  it("rejects a patch when the worktree drifts outside the allowed scope", async () => {
    const cwd = await createTempTsRepo("xiezhi-alpha-rejected-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = await runPlanCommand(cwd, "update router user flow")
    const task = selectTaskForAcceptedFlow(plan.tasks)
    const taskRun = await runTaskRunCommand(cwd, task.id, "opencode")

    await writeFile(path.join(taskRun.worktreePath, "README.md"), "# Unauthorized change\n", "utf8")
    await appendPassingVerificationLogs(cwd, taskRun.patchId)

    const verify = await runVerifyCommand(cwd, taskRun.patchId)

    expect(verify.status).toBe("rejected")
    expect(verify.blockingViolations.some((violation) => violation.type === "unauthorized_file_change")).toBe(true)
    expect(verify.changedFiles).toContain("README.md")
  }, 20000)
})
