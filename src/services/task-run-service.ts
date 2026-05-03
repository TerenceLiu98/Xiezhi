import { existsSync } from "node:fs"
import { copyFile, mkdir, rm } from "node:fs/promises"
import path from "node:path"

import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { compileExecutionPolicy } from "../execution/policy-compiler.js"
import { WorktreeManager } from "../git/worktree-manager.js"
import type { IntentIr } from "../planning/types.js"
import { assertDatabaseInitialized, openDatabaseConnection, type XieZhiDatabase } from "../db/client.js"
import * as schema from "../db/schema.js"
import { dagNodesTable, patchesTable, tasksTable } from "../db/schema.js"
import type { ExecutionPolicy, RuntimeName } from "../runtime/shared/contracts.js"
import { ClaudeRuntime } from "../runtime/claude/adapter.js"
import { CodexRuntime } from "../runtime/codex/adapter.js"
import { OpenCodeRuntime } from "../runtime/opencode/adapter.js"
import { XieZhiError } from "../core/errors.js"
import { runGit } from "../core/git.js"
import { PatchRecordService, type PatchRuntimeEvidence } from "./patch-record-service.js"
import { capturePatchState } from "./patch-state.js"
import { hasUsableHeadCommit, RepositoryMetadataService } from "./repository-metadata-service.js"

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

export type PatchPromoteResult = {
  status: "promoted"
  patchId: string
  taskId: string
  patchStatus: "promoted"
  taskStatus: string
  repoRoot: string
  changedFiles: string[]
  commitHash: string | null
  unlockedTaskIds: string[]
  nextStep: string
}

function parseTaskMetadata(value: string | null) {
  return safeJsonParse<{
    dependsOnTaskIds?: string[]
  }>(value, { dependsOnTaskIds: [] })
}

function isXieZhiPath(filePath: string) {
  return filePath === ".xiezhi" || filePath.startsWith(".xiezhi/")
}

function parseStatusPath(line: string) {
  const rawPath = line.slice(3).trim()
  const renameSeparator = " -> "
  return rawPath.includes(renameSeparator) ? rawPath.split(renameSeparator).at(-1)?.trim() ?? rawPath : rawPath
}

function assertSafeRelativePath(filePath: string) {
  if (!filePath || path.isAbsolute(filePath) || filePath.split(/[\\/]+/).includes("..") || isXieZhiPath(filePath)) {
    throw new XieZhiError("CLI_USAGE_ERROR", `Patch contains an unsafe path: ${filePath}`, {
      hint: "Discard this patch and rerun the task with a narrower allowed scope."
    })
  }
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

  async runTask(cwd: string, taskId: string, runtime: RuntimeName, options?: { agentRunId?: string }): Promise<TaskRunResult> {
    const timeline: TaskRunResult["timeline"] = []
    const repositoryService = new RepositoryMetadataService(this.db)
    const repository = await repositoryService.refreshForCwd(cwd)
    if (!hasUsableHeadCommit(repository.headCommit)) {
      throw new XieZhiError("CLI_USAGE_ERROR", "This repository does not have a baseline commit yet.", {
        hint: "Create an initial commit with `git add . && git commit -m \"chore: initial baseline\"` before running tasks."
      })
    }
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

    let runtimeResult: Awaited<ReturnType<typeof runtimeAdapter.runTask>>
    try {
      runtimeResult = await runtimeAdapter.runTask({
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
    } catch (error) {
      this.db.update(tasksTable).set({ status: "failed" }).where(eq(tasksTable.id, taskId)).run()
      throw error
    }
    timeline.push({
      label: "Runtime execution finished",
      status: runtimeResult.success ? "done" : "running",
      detail: `${runtimeResult.events.length} events, ${runtimeResult.commandLogs.length} command logs`
    })

    const patchState = await capturePatchState(worktree.path)
    const changedFiles = patchState.changedFiles.length > 0 ? patchState.changedFiles : runtimeResult.changedFiles
    const latestCommand = runtimeResult.commandLogs[runtimeResult.commandLogs.length - 1] ?? null
    const runtimeEvidence: PatchRuntimeEvidence = {
      mode: runtimeResult.mode ?? "scaffold",
      success: runtimeResult.success,
      emptyPatch: changedFiles.length === 0,
      eventCount: runtimeResult.events.length,
      commandCount: runtimeResult.commandLogs.length,
      latestCommand: latestCommand?.command ?? null,
      latestCommandExitCode: latestCommand?.exitCode ?? null,
      message:
        changedFiles.length === 0
          ? runtimeResult.mode === "real"
            ? "Runtime launched successfully but produced no captured edits."
            : "Scaffold runtime completed without captured edits."
          : `Runtime produced ${changedFiles.length} changed file${changedFiles.length === 1 ? "" : "s"}.`
    }
    const patchId = patchService.createPatch({
      taskId,
      baseCommit: worktree.baseCommit,
      worktreePath: worktree.path,
      runtimeName: runtime,
      runtimeMode: runtimeResult.mode ?? "scaffold",
      runtimeEvidence,
      agentRunId: options?.agentRunId ?? null,
      changedFiles,
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
      .set({ status: runtimeResult.success ? "patched" : "failed" })
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
      taskStatus: runtimeResult.success ? "patched" : "failed",
      worktreePath: worktree.path,
      changedFiles,
      commandLogs: runtimeResult.commandLogs.length,
      eventCount: runtimeResult.events.length,
      success: runtimeResult.success,
      nextStep: runtimeResult.success
        ? changedFiles.length > 0
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
      nextStep: `Re-run \`xiezhi agent run ${patch.taskId} --runtime ${patch.runtimeName}\` when you want to retry.`
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

  private async assertRootReadyForPromotion(repoRoot: string, patchBaseCommit: string) {
    const headCommit = (await runGit(["rev-parse", "HEAD"], repoRoot)).stdout.trim()
    if (headCommit !== patchBaseCommit) {
      throw new XieZhiError("CLI_USAGE_ERROR", "Patch base commit no longer matches the repository HEAD.", {
        hint: "Promote or discard older patches before advancing newer work, or rerun the task from the current baseline."
      })
    }

    const status = (await runGit(["status", "--porcelain", "--untracked-files=all"], repoRoot)).stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map(parseStatusPath)
      .filter((filePath) => !isXieZhiPath(filePath))

    if (status.length > 0) {
      throw new XieZhiError("CLI_USAGE_ERROR", "Repository has uncommitted changes outside XieZhi metadata.", {
        hint: `Commit, stash, or discard these files before promoting: ${status.join(", ")}`
      })
    }
  }

  private async copyPatchFilesToRoot(input: { repoRoot: string; worktreePath: string; changedFiles: string[] }) {
    for (const filePath of input.changedFiles) {
      assertSafeRelativePath(filePath)
      const sourcePath = path.resolve(input.worktreePath, filePath)
      const targetPath = path.resolve(input.repoRoot, filePath)
      if (!targetPath.startsWith(`${input.repoRoot}${path.sep}`) && targetPath !== input.repoRoot) {
        throw new XieZhiError("CLI_USAGE_ERROR", `Patch path escapes the repository root: ${filePath}`)
      }

      if (existsSync(sourcePath)) {
        await mkdir(path.dirname(targetPath), { recursive: true })
        await copyFile(sourcePath, targetPath)
      } else if (existsSync(targetPath)) {
        await rm(targetPath, { force: true, recursive: true })
      }
    }
  }

  private unlockReadyTasks(featureId: string) {
    const taskRows = this.db.select().from(tasksTable).where(eq(tasksTable.featureId, featureId)).all()
    const nodeRows = this.db.select().from(dagNodesTable).where(eq(dagNodesTable.featureId, featureId)).all()
    const nodeById = new Map(nodeRows.map((node) => [node.id, node]))
    const taskById = new Map(taskRows.map((task) => [task.id, task]))
    const unlockedTaskIds: string[] = []

    for (const task of taskRows) {
      if (task.status !== "draft") {
        continue
      }

      const node = nodeById.get(task.dagNodeId)
      const metadata = parseTaskMetadata(node?.metadataJson ?? null)
      const dependencies = metadata.dependsOnTaskIds ?? []
      const dependenciesSatisfied = dependencies.every((dependencyId) => {
        const dependency = taskById.get(dependencyId)
        return dependency && ["verified", "promoted"].includes(dependency.status)
      })

      if (!dependenciesSatisfied) {
        continue
      }

      this.db.update(tasksTable).set({ status: "ready" }).where(eq(tasksTable.id, task.id)).run()
      this.db.update(dagNodesTable).set({ status: "ready" }).where(eq(dagNodesTable.id, task.dagNodeId)).run()
      task.status = "ready"
      unlockedTaskIds.push(task.id)
    }

    return unlockedTaskIds
  }

  async promotePatch(cwd: string, patchId: string): Promise<PatchPromoteResult> {
    const patchService = new PatchRecordService(this.db)
    const patch = patchService.getPatch(patchId)

    if (!patch) {
      throw new XieZhiError("CLI_USAGE_ERROR", `Patch ${patchId} was not found.`, {
        hint: "Run `xiezhi task list` or `xiezhi review <patch-id>` to find a valid patch id."
      })
    }

    if (patch.status === "pending" || patch.status === "rejected" || patch.status === "discarded") {
      throw new XieZhiError("CLI_USAGE_ERROR", `Patch ${patchId} cannot be promoted from status ${patch.status}.`, {
        hint: "Run `xiezhi verify <patch-id>` and resolve blocking issues before promotion."
      })
    }

    if (patch.status === "promoted") {
      throw new XieZhiError("CLI_USAGE_ERROR", `Patch ${patchId} was already promoted.`, {
        hint: "Inspect the repository or run `xiezhi task show <task-id>` for promotion evidence."
      })
    }

    const repositoryService = new RepositoryMetadataService(this.db)
    const repository = await repositoryService.refreshForCwd(cwd)
    await this.assertRootReadyForPromotion(repository.rootPath, patch.baseCommit)
    await this.copyPatchFilesToRoot({
      repoRoot: repository.rootPath,
      worktreePath: patch.worktreePath,
      changedFiles: patch.changedFiles
    })

    await runGit(["add", "--all", "--", ...patch.changedFiles], repository.rootPath)
    const statusAfterApply = (await runGit(["status", "--porcelain", "--untracked-files=all"], repository.rootPath)).stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map(parseStatusPath)
      .filter((filePath) => !isXieZhiPath(filePath))

    let commitHash: string | null = null
    if (statusAfterApply.length > 0) {
      await runGit(["commit", "-m", `xiezhi: promote patch ${patchId}`], repository.rootPath)
      commitHash = (await runGit(["rev-parse", "HEAD"], repository.rootPath)).stdout.trim()
    }

    const task = this.db.select().from(tasksTable).where(eq(tasksTable.id, patch.taskId)).get()
    this.db.update(tasksTable).set({ status: "promoted" }).where(eq(tasksTable.id, patch.taskId)).run()
    if (task) {
      this.db.update(dagNodesTable).set({ status: "promoted" }).where(eq(dagNodesTable.id, task.dagNodeId)).run()
    }

    const unlockedTaskIds = task ? this.unlockReadyTasks(task.featureId) : []
    const promotedAt = new Date().toISOString()
    patchService.updatePatchPromotion(patchId, {
      promotedAt,
      repoRoot: repository.rootPath,
      committed: commitHash !== null,
      commitHash,
      changedFiles: patch.changedFiles
    })

    return {
      status: "promoted",
      patchId,
      taskId: patch.taskId,
      patchStatus: "promoted",
      taskStatus: "promoted",
      repoRoot: repository.rootPath,
      changedFiles: patch.changedFiles,
      commitHash,
      unlockedTaskIds,
      nextStep:
        unlockedTaskIds.length > 0
          ? `Next task is ready: ${unlockedTaskIds[0]}. Run \`xiezhi agent run ${unlockedTaskIds[0]} --runtime ${patch.runtimeName}\`.`
          : "Patch promoted into the repository. Run the app build checks from the repository root."
    }
  }
}

export async function runTask(cwd: string, taskId: string, runtime: RuntimeName, options?: { agentRunId?: string }) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new TaskRunService(drizzle(sqlite, { schema }))
    return await service.runTask(cwd, taskId, runtime, options)
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

export async function promotePatch(cwd: string, patchId: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new TaskRunService(drizzle(sqlite, { schema }))
    return await service.promotePatch(cwd, patchId)
  } finally {
    sqlite.close()
  }
}
