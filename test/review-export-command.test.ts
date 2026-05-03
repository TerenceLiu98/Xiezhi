import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { runIndexCommand } from "../src/commands/index.js"
import { runInit } from "../src/commands/init.js"
import { runReviewCommand } from "../src/commands/review.js"
import { runTaskRunCommand } from "../src/commands/task.js"
import { importRouterPlan } from "./support/agent-plan-fixture.js"
import { createTempTsRepo } from "./support/git-fixture.js"

describe("review export command", () => {
  it("writes markdown and json review artifacts", async () => {
    const cwd = await createTempTsRepo("xiezhi-review-export-")
    await runInit(cwd, { preset: "local-fast" })
    await runIndexCommand({ cwd, mode: "full" })
    const plan = importRouterPlan(cwd)
    const taskRun = await runTaskRunCommand(cwd, plan.tasks[0]!.id, "opencode")

    const markdownOutput = ".xiezhi/exports/review.md"
    const jsonOutput = ".xiezhi/exports/review.json"

    const markdownReview = await runReviewCommand(cwd, taskRun.patchId, {
      format: "markdown",
      outputPath: markdownOutput
    })
    const jsonReview = await runReviewCommand(cwd, taskRun.patchId, {
      format: "json",
      outputPath: jsonOutput
    })

    const markdownSource = await readFile(path.join(cwd, markdownOutput), "utf8")
    const jsonSource = await readFile(path.join(cwd, jsonOutput), "utf8")

    expect("export" in markdownReview && markdownReview.export?.format).toBe("markdown")
    expect("export" in jsonReview && jsonReview.export?.format).toBe("json")
    expect(markdownSource).toContain("# XieZhi Review")
    expect(jsonSource).toContain(`"patchId": "${taskRun.patchId}"`)
  }, 15000)
})
