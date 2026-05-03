import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { compileExecutionPolicy } from "../execution/policy-compiler.js"
import { WorktreeManager } from "../git/worktree-manager.js"
import type { IntentIr } from "../planning/types.js"
import { assertDatabaseInitialized, openDatabaseConnection, type XieZhiDatabase } from "../db/client.js"
import * as schema from "../db/schema.js"
import { patchesTable, tasksTable } from "../db/schema.js"
import type { ExecutionPolicy, RuntimeName } from "../runtime/shared/contracts.js"
import { ClaudeRuntime } from "../runtime/claude/adapter.js"
import { CodexRuntime } from "../runtime/codex/adapter.js"
import { OpenCodeRuntime } from "../runtime/opencode/adapter.js"
import { XieZhiError } from "../core/errors.js"
import { PatchRecordService } from "./patch-record-service.js"
import { capturePatchState } from "./patch-state.js"
import { RepositoryMetadataService } from "./repository-metadata-service.js"

type StoredTask = typeof tasksTable.$inferSelect

function safeJsonParse<T>(value: string | null, fallback: T) {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function getRuntimeAdapter(runtime: RuntimeName) {
  if (runtime === "opencode") {
    return new OpenCodeRuntime()
  }
  if (runtime === "claude") {
    return new ClaudeRuntime()
  }
  if (runtime === "codex") {
    return new CodexRuntime()
  }

  throw new XieZhiError("NOT_IMPLEMENTED", `Runtime ${runtime} is not implemented yet.`)
}

export type TaskRunResult = {
  status: "captured"
  taskId: string
  runtime: RuntimeName
  mode: "real" | "scaffold"
  patchId: string
  patchStatus: string
  taskStatus: string
  worktreePath: string
  changedFiles: string[]
  commandLogs: number
  eventCount: number
  success: boolean
  nextStep: string
  timeline: Array<{
    label: string
    status: "done" | "running" | "pending"
    detail: string
  }>
  commands: Array<{
    command: string
    exitCode: number
  }>
}

export type TaskRetryResult = Omit<TaskRunResult, "status"> & {
  status: "retried"
  previousPatchId: string
}

export type TaskDiscardResult = {
  status: "discarded"
  patchId: string
  taskId: string
  patchStatus: string
  taskStatus: string
  removedWorktree: string
  nextStep: string
}

export type PatchAcceptResult = {
  status: "accepted"
  patchId: string
  taskId: string
  patchStatus: "accepted"
  taskStatus: string
  nextStep: string
}

export class TaskRunService {
  constructor(private readonly db: XieZhiDatabase) {}

  private getTask(taskId: string): StoredTask {
    const task = this.db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).get()

    if (!task) {
      throw new XieZhiError("CLI_USAGE_ERROR", `Task ${taskId} was not found.`, {
        hint: "Run `xiezhi task list` to inspect available tasks."
      })
    }

    return task
  }

  async runTask(cwd: string, taskId: string, runtime: RuntimeName): Promise<TaskRunResult> {
    const timeline: TaskRunResult["timeline"] = []
    const repositoryService = new RepositoryMetadataService(this.db)
    const repository = await repositoryService.refreshForCwd(cwd)
    timeline.push({
      label: "Repository loaded",
      status: "done",
      detail: `${repository.rootPath} @ ${repository.headCommit.slice(0, 8)}`
    })
    const task = this.getTask(taskId)
    const intent = safeJsonParse<IntentIr | null>(task.intentIrJson, null)
    const policy = safeJsonParse<ExecutionPolicy | null>(task.policyJson, null)
    const compiledPolicy = compileExecutionPolicy({ runtime, policy, intent })
    timeline.push({
      label: "Execution policy compiled",
      status: "done",
      detail: `${compiledPolicy.policy.allowedFiles.length} allowed files, ${compiledPolicy.policy.forbiddenFiles.length} forbidden paths`
    })
    const worktreeManager = new WorktreeManager()
    const patchService = new PatchRecordService(this.db)
    const runtimeAdapter = getRuntimeAdapter(runtime)

    this.db.update(tasksTable).set({ status: "running" }).where(eq(tasksTable.id, taskId)).run()
    timeline.push({
      label: "Task status updated",
      status: "done",
      detail: `${taskId} marked running`
    })

    const worktree = await worktreeManager.createTaskWorktree({
      repoRoot: repository.rootPath,
      taskId,
      baseCommit: repository.headCommit,
      replaceExisting: true
    })
    timeline.push({
      label: "Worktree created",
      status: "done",
      detail: worktree.path
    })

    const runtimeResult = await runtimeAdapter.runTask({
      taskId,
      goal: intent?.goal ?? taskId,
      cwd: worktree.path,
      runtime,
      allowedFiles: compiledPolicy.policy.allowedFiles,
      forbiddenFiles: compiledPolicy.policy.forbiddenFiles,
      acceptance: intent?.acceptance ?? [],
      recommendedCommands: intent?.recommendedCommands ?? [],
      policy: compiledPolicy.policy,
      compiledPolicy
    })
    timeline.push({
      label: "Runtime execution finished",
      status: runtimeResult.success ? "done" : "running",
      detail: `${runtimeResult.events.length} events, ${runtimeResult.commandLogs.length} command logs`
    })

    const patchState = await capturePatchState(worktree.path)
    const patchId = patchService.createPatch({
      taskId,
      baseCommit: worktree.baseCommit,
      worktreePath: worktree.path,
      runtimeName: runtime,
      changedFiles: patchState.changedFiles.length > 0 ? patchState.changedFiles : runtimeResult.changedFiles,
      diff: patchState.diff || runtimeResult.diff,
      status: runtimeResult.success ? "pending" : "rejected"
    })
    patchService.appendCommandLogs(patchId, runtimeResult.commandLogs)
    timeline.push({
      label: "Patch captured",
      status: "done",
      detail: `${patchId} with ${patchState.changedFiles.length > 0 ? patchState.changedFiles.length : runtimeResult.changedFiles.length} changed files`
    })

    this.db
      .update(tasksTable)
      .set({ status: runtimeResult.success ? "running" : "rejected" })
      .where(eq(tasksTable.id, taskId))
      .run()
    timeline.push({
      label: "Awaiting verification",
      status: runtimeResult.success ? "pending" : "running",
      detail: runtimeResult.success ? "Patch is pending review and verification." : "Execution failed before verification."
    })

    const storedPatch = this.db.select().from(patchesTable).where(eq(patchesTable.id, patchId)).get()

    if (!storedPatch) {
      throw new XieZhiError("DATABASE_ERROR", "Patch record was not persisted.")
    }

    return {
      status: "captured",
      taskId,
      runtime,
      mode: runtimeResult.mode ?? "scaffold",
      patchId,
      patchStatus: storedPatch.status,
      taskStatus: runtimeResult.success ? "running" : "rejected",
      worktreePath: worktree.path,
      changedFiles: patchState.changedFiles.length > 0 ? patchState.changedFiles : runtimeResult.changedFiles,
      commandLogs: runtimeResult.commandLogs.length,
      eventCount: runtimeResult.events.length,
      success: runtimeResult.success,
      nextStep: runtimeResult.success
        ? patchState.changedFiles.length > 0
          ? `Run \`xiezhi verify ${patchId}\` to verify the current worktree patch.`
          : runtimeResult.mode === "real"
            ? `The runtime completed without captured edits. Edit ${worktree.path}, then run \`xiezhi verify ${patchId}\` or \`xiezhi task retry ${patchId} --runtime ${runtime}\`.`
            : `This run used the scaffold adapter. Edit ${worktree.path}, then run \`xiezhi verify ${patchId}\` or \`xiezhi task retry ${patchId} --runtime ${runtime}\`.`
        : `Review the command summary, then retry with \`xiezhi task retry ${patchId} --runtime ${runtime}\` or discard with \`xiezhi task discard ${patchId}\`.`,
      timeline,
      commands: runtimeResult.commandLogs.map((log) => ({
        command: log.command,
        exitCode: log.exitCode
      }))
    }
  }

  async discardPatch(cwd: string, patchId: string): Promise<TaskDiscardResult> {
    const patchService = new PatchRecordService(this.db)
    const patch = patchService.getPatch(patchId)

    if (!patch) {
      throw new XieZhiError("CLI_USAGE_ERROR", `Patch ${patchId} was not found.`)
    }

    const repositoryService = new RepositoryMetadataService(this.db)
    const repository = await repositoryService.refreshForCwd(cwd)
    const worktreeManager = new WorktreeManager()

    await worktreeManager.removeWorktree(patch.worktreePath, repository.rootPath)
    patchService.updatePatchStatus(patchId, "discarded")
    this.db
      .update(tasksTable)
      .set({
        status: "ready"
      })
      .where(eq(tasksTable.id, patch.taskId))
      .run()

    return {
      status: "discarded",
      patchId,
      taskId: patch.taskId,
      patchStatus: "discarded",
      taskStatus: "ready",
      removedWorktree: patch.worktreePath,
      nextStep: `Re-run \`xiezhi task run ${patch.taskId} --runtime ${patch.runtimeName}\` when you want to retry.`
    }
  }

  async retryPatch(cwd: string, patchId: string, runtimeOverride?: RuntimeName): Promise<TaskRetryResult> {
    const patchService = new PatchRecordService(this.db)
    const patch = patchService.getPatch(patchId)

    if (!patch) {
      throw new XieZhiError("CLI_USAGE_ERROR", `Patch ${patchId} was not found.`, {
        hint: "Run `xiezhi review <patch-id>` or inspect the patches table to find a valid patch id."
      })
    }

    const repositoryService = new RepositoryMetadataService(this.db)
    const repository = await repositoryService.refreshForCwd(cwd)
    const worktreeManager = new WorktreeManager()

    await worktreeManager.removeWorktree(patch.worktreePath, repository.rootPath)
    patchService.updatePatchStatus(patchId, "discarded")
    this.db
      .update(tasksTable)
      .set({
        status: "ready"
      })
      .where(eq(tasksTable.id, patch.taskId))
      .run()

    const rerun = await this.runTask(cwd, patch.taskId, (runtimeOverride ?? patch.runtimeName) as RuntimeName)

    return {
      ...rerun,
      status: "retried",
      previousPatchId: patchId
    }
  }

  async acceptPatch(_cwd: string, patchId: string): Promise<PatchAcceptResult> {
    const patchService = new PatchRecordService(this.db)
    const patch = patchService.getPatch(patchId)

    if (!patch) {
      throw new XieZhiError("CLI_USAGE_ERROR", `Patch ${patchId} was not found.`, {
        hint: "Run `xiezhi review <patch-id>` or inspect available patch ids before accepting one."
      })
    }

    if (patch.status === "rejected" || patch.status === "discarded") {
      throw new XieZhiError("CLI_USAGE_ERROR", `Patch ${patchId} cannot be accepted from status ${patch.status}.`, {
        hint: "Only verified patches can be accepted. Retry or rerun verification first."
      })
    }

    if (patch.status === "pending") {
      throw new XieZhiError("CLI_USAGE_ERROR", `Patch ${patchId} has not been verified yet.`, {
        hint: `Run \`xiezhi verify ${patchId}\` first, then accept it if the result is satisfactory.`
      })
    }

    patchService.updatePatchStatus(patchId, "accepted")

    const task = this.db.select().from(tasksTable).where(eq(tasksTable.id, patch.taskId)).get()

    return {
      status: "accepted",
      patchId,
      taskId: patch.taskId,
      patchStatus: "accepted",
      taskStatus: task?.status ?? "verified",
      nextStep: "Patch accepted. Review the worktree or carry it into your normal merge flow when ready."
    }
  }
}

export async function runTask(cwd: string, taskId: string, runtime: RuntimeName) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new TaskRunService(drizzle(sqlite, { schema }))
    return await service.runTask(cwd, taskId, runtime)
  } finally {
    sqlite.close()
  }
}

export async function discardPatch(cwd: string, patchId: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new TaskRunService(drizzle(sqlite, { schema }))
    return await service.discardPatch(cwd, patchId)
  } finally {
    sqlite.close()
  }
}

export async function retryPatch(cwd: string, patchId: string, runtimeOverride?: RuntimeName) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new TaskRunService(drizzle(sqlite, { schema }))
    return await service.retryPatch(cwd, patchId, runtimeOverride)
  } finally {
    sqlite.close()
  }
}

export async function acceptPatch(cwd: string, patchId: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new TaskRunService(drizzle(sqlite, { schema }))
    return await service.acceptPatch(cwd, patchId)
  } finally {
    sqlite.close()
  }
}
