import { appendFile, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { drizzle } from "drizzle-orm/better-sqlite3"
import { describe, expect, it } from "vitest"

import { runAgentTaskCommand } from "../src/commands/agent.js"
import { runIndexCommand } from "../src/commands/index.js"
import { runInit } from "../src/commands/init.js"
import { runReviewCommand } from "../src/commands/review.js"
import { runPatchAcceptCommand, runTaskRunCommand, runTaskShowCommand } from "../src/commands/task.js"
import { runVerifyCommand } from "../src/commands/verify.js"
import { openDatabaseConnection } from "../src/db/client.js"
import * as schema from "../src/db/schema.js"
import { PatchRecordService } from "../src/services/patch-record-service.js"
import { importAgentPlan } from "../src/services/planning-service.js"
import { createTempNoteTakingRepo, createTempPythonRepo, createTempTsRepo } from "./support/git-fixture.js"
import { importNoteTakingPlan, importRouterPlan, routerAgentPlan } from "./support/agent-plan-fixture.js"

async function appendPassingVerificationLogs(cwd: string, patchId: string) {
  const sqlite = openDatabaseConnection(cwd)

  try {
    const patchService = new PatchRecordService(drizzle(sqlite, { schema }))
    patchService.appendCommandLogs(patchId, [
      { command: "pnpm typecheck", exitCode: 0, output: "Typecheck passed" },
      { command: "pnpm test", exitCode: 0, output: "Tests passed" }
    ])
  } finally {
    sqlite.close()
  }
}

describe("agent run and task show", () => {
  it("creates an assignment, agent run, and inspectable task evidence", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-run-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = importRouterPlan(cwd)
    const task = plan.tasks[0]!

    const agentRun = await runAgentTaskCommand(cwd, task.id, "opencode")
    const taskShow = await runTaskShowCommand(cwd, agentRun.taskId)

    expect(agentRun.status).toBe("assigned")
    expect(agentRun.assignmentId).toBeTruthy()
    expect(agentRun.agentRunId).toBeTruthy()
    expect(agentRun.patchId).toBeTruthy()
    expect(agentRun.taskStatus).toBe("patched")
    expect(taskShow.latestPatch?.id).toBe(agentRun.patchId)
    expect(taskShow.latestPatch?.runtimeMode).toBe("scaffold")
    expect(taskShow.latestPatch?.evidence?.emptyPatch).toBe(true)
    expect(taskShow.latestAgentRun?.id).toBe(agentRun.agentRunId)
    expect(taskShow.latestAssignment?.id).toBe(agentRun.assignmentId)
    expect(taskShow.nextAction).toContain("verify")

    const sqlite = openDatabaseConnection(cwd)
    try {
      const storedAgentRun = sqlite.prepare("SELECT patch_id, status FROM agent_runs WHERE id = ?").get(agentRun.agentRunId) as
        | { patch_id: string; status: string }
        | undefined
      const assignment = sqlite.prepare("SELECT status, contract_json FROM assignments WHERE id = ?").get(agentRun.assignmentId) as
        | { status: string; contract_json: string }
        | undefined

      expect(storedAgentRun?.patch_id).toBe(agentRun.patchId)
      expect(storedAgentRun?.status).toBe("completed")
      expect(assignment?.status).toBe("completed")
      expect(JSON.parse(assignment!.contract_json)).toMatchObject({
        taskId: agentRun.taskId,
        goal: expect.any(String),
        subagentRole: "implementation",
        parallelGroup: null,
        handoff: [],
        allowedFiles: expect.any(Array),
        acceptance: expect.any(Array),
        expectedOutputs: expect.any(Array),
        policy: expect.any(Object)
      })
    } finally {
      sqlite.close()
    }
  }, 25000)

  it("flags semantic scope drift inside an allowed file", async () => {
    const cwd = await createTempTsRepo("xiezhi-semantic-scope-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const base = routerAgentPlan()
    const plan = importRouterPlan(cwd, {
      tasks: [{ ...base.tasks[0]!, allowedSymbols: ["getUser"], forbiddenSymbols: [] }]
    })
    const task = plan.tasks[0]!

    const taskRun = await runTaskRunCommand(cwd, task.id, "opencode")
    const routerPath = path.join(taskRun.worktreePath, "src", "router.tsx")
    const source = await readFile(routerPath, "utf8")
    await writeFile(routerPath, source.replace("Hello", "Hello there"), "utf8")
    await appendPassingVerificationLogs(cwd, taskRun.patchId)

    const verify = await runVerifyCommand(cwd, taskRun.patchId)

    expect(verify.status).toBe("rejected")
    expect(verify.blockingViolations.some((violation) => violation.type === "semantic_scope_violation")).toBe(true)
    expect(verify.semanticDiff.modifiedNodes.some((node) => node.symbol === "App")).toBe(true)
  }, 25000)

  it("runs the note-taking MVP fixture chain through review and acceptance", async () => {
    const cwd = await createTempNoteTakingRepo("xiezhi-note-demo-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = importNoteTakingPlan(cwd)
    const task = plan.tasks[0]!

    const agentRun = await runAgentTaskCommand(cwd, task.id, "opencode")
    const taskShow = await runTaskShowCommand(cwd, agentRun.taskId)
    const patch = taskShow.latestPatch!
    const testFile = taskShow.allowedFiles.find((file) => file.includes(".test.") || file.includes(".spec.")) ?? taskShow.allowedFiles[0]!

    await appendFile(path.join(patch.worktreePath, testFile), "\n// note demo accepted patch\n", "utf8")
    await appendPassingVerificationLogs(cwd, patch.id)

    const verify = await runVerifyCommand(cwd, patch.id)
    const review = await runReviewCommand(cwd, patch.id)
    const accept = await runPatchAcceptCommand(cwd, patch.id)
    const finalTaskShow = await runTaskShowCommand(cwd, agentRun.taskId)

    expect(agentRun.status).toBe("assigned")
    expect(taskShow.latestAgentRun?.id).toBe(agentRun.agentRunId)
    expect(verify.status).toBe("accepted")
    expect(review.blockingViolations).toHaveLength(0)
    expect(accept.patchStatus).toBe("accepted")
    expect(finalTaskShow.latestPatch?.status).toBe("accepted")
    expect(finalTaskShow.violations.some((violation) => violation.type === "semantic_scope_violation")).toBe(false)
  }, 30000)

  it("flags Python semantic scope drift inside an allowed file", async () => {
    const cwd = await createTempPythonRepo("xiezhi-python-semantic-scope-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = importAgentPlan(
      cwd,
      {
        version: "v1",
        goal: "Update add only",
        title: "Python scoped edit",
        requirements: ["Only add may change"],
        tasks: [
          {
            key: "update-add",
            title: "Update add",
            summary: "Change the add function only",
            dependsOn: [],
            allowedFiles: ["src/math_utils.py"],
            forbiddenFiles: [".xiezhi/"],
            allowedSymbols: ["add"],
            forbiddenSymbols: [],
            acceptance: ["add remains callable"],
            checks: [],
            expectedOutputs: ["Python function update"],
            rationale: ["Exercise Python semantic scope"]
          }
        ]
      },
      { runtimeName: "test-agent" }
    )
    const task = plan.tasks[0]!
    const taskRun = await runTaskRunCommand(cwd, task.id, "opencode")
    const filePath = path.join(taskRun.worktreePath, "src", "math_utils.py")
    const source = await readFile(filePath, "utf8")
    await writeFile(filePath, source.replace("return left - right", "return right - left"), "utf8")
    await appendPassingVerificationLogs(cwd, taskRun.patchId)

    const verify = await runVerifyCommand(cwd, taskRun.patchId)

    expect(verify.status).toBe("rejected")
    expect(verify.semanticDiff.semanticCoverage.mode).toBe("ast")
    expect(verify.semanticDiff.modifiedNodes.some((node) => node.symbol === "subtract")).toBe(true)
    expect(verify.blockingViolations.some((violation) => violation.type === "semantic_scope_violation")).toBe(true)
  }, 25000)

  it("reports file-only semantic coverage for unsupported changed files", async () => {
    const cwd = await createTempTsRepo("xiezhi-file-only-coverage-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = importAgentPlan(
      cwd,
      {
        version: "v1",
        goal: "Update data file",
        title: "Unsupported file coverage",
        requirements: ["Update data"],
        tasks: [
          {
            key: "data",
            title: "Update data",
            summary: "Change a non-AST data file",
            dependsOn: [],
            allowedFiles: ["src/data.txt"],
            forbiddenFiles: [".xiezhi/"],
            allowedSymbols: [],
            forbiddenSymbols: [],
            acceptance: ["data file changes"],
            checks: [],
            expectedOutputs: ["data update"],
            rationale: ["Exercise file-only semantic coverage"]
          }
        ]
      },
      { runtimeName: "test-agent" }
    )
    const taskRun = await runTaskRunCommand(cwd, plan.tasks[0]!.id, "opencode")
    await writeFile(path.join(taskRun.worktreePath, "src", "data.txt"), "updated\n", "utf8")
    await appendPassingVerificationLogs(cwd, taskRun.patchId)

    const verify = await runVerifyCommand(cwd, taskRun.patchId)

    expect(verify.semanticDiff.semanticCoverage.mode).toBe("file-only")
    expect(verify.semanticDiff.semanticCoverage.fileOnlyFiles).toContain("src/data.txt")
  }, 25000)
})
