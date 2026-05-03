import path from "node:path"

import { and, eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { XieZhiError } from "../core/errors.js"
import { createId } from "../core/ids.js"
import { nowIso } from "../core/time.js"
import { assertDatabaseInitialized, openDatabaseConnection, type XieZhiDatabase } from "../db/client.js"
import * as schema from "../db/schema.js"
import {
  checksTable,
  codeNodesTable,
  patchesTable,
  tasksTable,
  violationsTable
} from "../db/schema.js"
import { extractCodeGraph } from "../indexer/extractor.js"
import { getSourceFilesByRelativePath, loadProject } from "../indexer/project-loader.js"
import { runGit } from "../core/git.js"
import type { IntentIr } from "../planning/types.js"
import type {
  ReviewPatchResult,
  SemanticDiffSummary,
  SemanticNodeSummary,
  VerificationCheckSummary,
  VerificationViolationSummary,
  VerifyPatchResult
} from "../verification/types.js"
import { PatchRecordService } from "./patch-record-service.js"
import { capturePatchState } from "./patch-state.js"
import { RepositoryMetadataService } from "./repository-metadata-service.js"

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

function normalizeNodeSummary(nodes: Array<typeof codeNodesTable.$inferSelect>) {
  return nodes
    .filter((node) => node.kind !== "file")
    .map(
      (node): SemanticNodeSummary => ({
        path: node.path,
        kind: node.kind,
        symbol: node.symbol ?? null
      })
    )
}

function nodeKey(node: SemanticNodeSummary) {
  return `${node.path}:${node.kind}:${node.symbol ?? ""}`
}

function diffNodes(before: SemanticNodeSummary[], after: SemanticNodeSummary[]) {
  const beforeMap = new Map(before.map((node) => [nodeKey(node), node]))
  const afterMap = new Map(after.map((node) => [nodeKey(node), node]))

  return {
    added: [...afterMap.entries()]
      .filter(([key]) => !beforeMap.has(key))
      .map(([, node]) => node),
    removed: [...beforeMap.entries()]
      .filter(([key]) => !afterMap.has(key))
      .map(([, node]) => node)
  }
}

function exportKey(path: string, symbol: string) {
  return `${path}:${symbol}`
}

function classifyCommand(command: string) {
  const normalized = command.toLowerCase()
  if (normalized.includes("test")) {
    return "test"
  }
  if (normalized.includes("typecheck") || normalized.includes("tsc")) {
    return "typecheck"
  }
  if (normalized.includes("lint") || normalized.includes("eslint")) {
    return "lint"
  }
  if (normalized.includes("build")) {
    return "build"
  }
  return null
}

type ClassifiedCommandType = Exclude<ReturnType<typeof classifyCommand>, null>

export class VerificationService {
  constructor(private readonly db: XieZhiDatabase) {}

  private findTask(taskId: string) {
    return this.db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).get() ?? null
  }

  private async collectExports(repoRoot: string, changedFiles: string[]) {
    if (changedFiles.length === 0) {
      return []
    }

    const { sourceFiles } = loadProject(repoRoot)
    const files = getSourceFilesByRelativePath(repoRoot, sourceFiles, changedFiles)

    return files.flatMap((sourceFile) => {
      const relativePath = path.relative(repoRoot, sourceFile.getFilePath()) || sourceFile.getBaseName()
      return [...sourceFile.getExportedDeclarations().keys()].map((symbol) => ({
        path: relativePath,
        symbol
      }))
    })
  }

  private async buildSemanticDiff(input: {
    repoId: string
    repoRoot: string
    worktreePath: string
    changedFiles: string[]
  }): Promise<SemanticDiffSummary> {
    const changedFiles = input.changedFiles.filter((value) => value.endsWith(".ts") || value.endsWith(".tsx"))
    if (changedFiles.length === 0) {
      return {
        changedFiles: input.changedFiles,
        addedNodes: [],
        removedNodes: [],
        addedExports: [],
        removedExports: []
      }
    }

    const baselineNodes = this.db
      .select()
      .from(codeNodesTable)
      .where(and(eq(codeNodesTable.repoId, input.repoId), inArray(codeNodesTable.path, changedFiles)))
      .all()

    const { project, sourceFiles } = loadProject(input.worktreePath)
    const worktreeFiles = getSourceFilesByRelativePath(input.worktreePath, sourceFiles, changedFiles)
    const extraction = extractCodeGraph({
      repoId: input.repoId,
      repoRoot: input.worktreePath,
      project,
      sourceFiles: worktreeFiles
    })

    const baselineSummary = normalizeNodeSummary(baselineNodes)
    const patchedSummary = extraction.nodes
      .filter((node) => node.kind !== "file")
      .map(
        (node): SemanticNodeSummary => ({
          path: node.path,
          kind: node.kind,
          symbol: node.symbol ?? null
        })
      )

    const nodeDiff = diffNodes(baselineSummary, patchedSummary)

    const baselineExports = await this.collectExports(input.repoRoot, changedFiles)
    const patchedExports = await this.collectExports(input.worktreePath, changedFiles)
    const baselineExportSet = new Map(baselineExports.map((entry) => [exportKey(entry.path, entry.symbol), entry]))
    const patchedExportSet = new Map(patchedExports.map((entry) => [exportKey(entry.path, entry.symbol), entry]))

    return {
      changedFiles: input.changedFiles,
      addedNodes: nodeDiff.added,
      removedNodes: nodeDiff.removed,
      addedExports: [...patchedExportSet.entries()]
        .filter(([key]) => !baselineExportSet.has(key))
        .map(([, value]) => value),
      removedExports: [...baselineExportSet.entries()]
        .filter(([key]) => !patchedExportSet.has(key))
        .map(([, value]) => value)
    }
  }

  private buildChecks(intent: IntentIr | null, commandLogs: Array<{ command: string; exitCode: number; output: string }>) {
    const checks: VerificationCheckSummary[] = []
    const seenTypes = new Set<string>()

    for (const log of commandLogs) {
      const type = classifyCommand(log.command)
      if (!type) {
        continue
      }
      seenTypes.add(type)
      checks.push({
        type,
        status: log.exitCode === 0 ? "passed" : "failed",
        summary: `${type} ${log.exitCode === 0 ? "passed" : "failed"}`,
        output: log.output
      })
    }

    const recommendedCheckTypes = (intent?.recommendedCommands ?? [])
      .map((command) => classifyCommand(command))
      .filter((value): value is ClassifiedCommandType => value !== null)

    for (const checkType of recommendedCheckTypes) {
      if (seenTypes.has(checkType)) {
        continue
      }
      checks.push({
        type: checkType,
        status: "missing",
        summary: `${checkType} was recommended but did not run`
      })
    }

    return checks
  }

  private collectRequiredCheckTypes(input: {
    taskTitle: string
    changedFiles: string[]
    intent: IntentIr | null
  }) {
    const recommendedTypes = unique(
      (input.intent?.recommendedCommands ?? [])
        .map((command) => classifyCommand(command))
        .filter((value): value is ClassifiedCommandType => value !== null)
    )

    const required = new Set<ClassifiedCommandType>()
    const taskTitle = input.taskTitle.toLowerCase()
    const touchesTestFile = input.changedFiles.some((file) => file.includes(".test.") || file.includes(".spec."))

    if (taskTitle.startsWith("verify ")) {
      if (recommendedTypes.includes("typecheck")) {
        required.add("typecheck")
      }
      if (recommendedTypes.includes("test")) {
        required.add("test")
      }
    }

    if (touchesTestFile && recommendedTypes.includes("test")) {
      required.add("test")
    }

    return [...required]
  }

  private async getWorktreeHeadCommit(worktreePath: string) {
    try {
      return (await runGit(["rev-parse", "HEAD"], worktreePath)).stdout.trim()
    } catch {
      return null
    }
  }

  private buildViolations(input: {
    patchTaskId: string
    taskExists: boolean
    changedFiles: string[]
    allowedFiles: string[]
    forbiddenFiles: string[]
    semanticDiff: SemanticDiffSummary
    checks: VerificationCheckSummary[]
    requiredCheckTypes: string[]
    acceptance: string[]
    worktreeHeadCommit: string | null
    baseCommit: string
  }) {
    const violations: VerificationViolationSummary[] = []
    const changedFileSet = new Set(input.changedFiles)
    const allowedFileSet = new Set(input.allowedFiles)
    const forbiddenFileSet = new Set(input.forbiddenFiles)

    if (!input.taskExists) {
      violations.push({
        severity: "blocking",
        type: "missing_task_binding",
        message: `Patch is bound to task ${input.patchTaskId}, but that task no longer exists.`
      })
    }

    if (input.worktreeHeadCommit !== null && input.worktreeHeadCommit !== input.baseCommit) {
      violations.push({
        severity: "blocking",
        type: "base_commit_mismatch",
        message: `Worktree HEAD ${input.worktreeHeadCommit} no longer matches recorded base commit ${input.baseCommit}.`
      })
    }

    const unauthorizedFiles = input.changedFiles.filter((file) => !allowedFileSet.has(file))
    if (unauthorizedFiles.length > 0) {
      violations.push({
        severity: "blocking",
        type: "unauthorized_file_change",
        message: `Patch changed files outside the allowed scope: ${unauthorizedFiles.join(", ")}`
      })
    }

    const forbiddenTouched = input.changedFiles.filter((file) => forbiddenFileSet.has(file))
    if (forbiddenTouched.length > 0) {
      violations.push({
        severity: "blocking",
        type: "forbidden_scope_change",
        message: `Patch touched forbidden files: ${forbiddenTouched.join(", ")}`
      })
    }

    const failedChecks = input.checks.filter((check) => check.status === "failed")
    if (failedChecks.length > 0) {
      violations.push({
        severity: "blocking",
        type: "check_failed",
        message: `Verification commands failed: ${failedChecks.map((check) => check.type).join(", ")}`
      })
    }

    const missingRequiredChecks = input.checks.filter((check) => {
      return check.status === "missing" && input.requiredCheckTypes.includes(check.type)
    })
    if (missingRequiredChecks.length > 0) {
      violations.push({
        severity: "blocking",
        type: "required_check_missing",
        message: `Required verification commands did not run: ${missingRequiredChecks.map((check) => check.type).join(", ")}`
      })
    }

    const hasTestCheck = input.checks.some((check) => check.type === "test" && check.status === "passed")
    if (!hasTestCheck) {
      violations.push({
        severity: "warning",
        type: "missing_tests",
        message: "No passing test command was recorded for this patch."
      })
    }

    const removedTestNodes = input.semanticDiff.removedNodes.filter((node) => {
      return node.kind === "test" || node.path.includes(".test.") || node.path.includes(".spec.")
    })
    if (removedTestNodes.length > 0) {
      violations.push({
        severity: "blocking",
        type: "existing_test_deleted",
        message: `Patch removed existing test coverage in: ${unique(removedTestNodes.map((node) => node.path)).join(", ")}`
      })
    }

    if (input.semanticDiff.addedExports.length > 0 || input.semanticDiff.removedExports.length > 0) {
      violations.push({
        severity: "warning",
        type: "exported_symbol_warning",
        message: "Exported symbols changed in this patch."
      })
      violations.push({
        severity: "warning",
        type: "public_api_change_warning",
        message: "Public API surface may have changed and should be reviewed carefully."
      })
    }

    const touchedTestFiles = input.changedFiles.filter((file) => file.includes(".test.") || file.includes(".spec."))
    if (input.acceptance.length > 0 && touchedTestFiles.length === 0 && changedFileSet.size > 0) {
      violations.push({
        severity: "warning",
        type: "acceptance_coverage_warning",
        message: "Acceptance changed without touching any test file."
      })
    }

    return violations
  }

  private persistVerification(input: {
    patchId: string
    taskId?: string | null
    status: "accepted" | "warning" | "rejected"
    semanticDiff: SemanticDiffSummary
    checks: VerificationCheckSummary[]
    violations: VerificationViolationSummary[]
  }) {
    const timestamp = nowIso()
    const existingPatch = this.db.select().from(patchesTable).where(eq(patchesTable.id, input.patchId)).get()

    this.db.delete(checksTable).where(eq(checksTable.patchId, input.patchId)).run()
    this.db.delete(violationsTable).where(eq(violationsTable.patchId, input.patchId)).run()

    this.db
      .update(patchesTable)
      .set({
        semanticDiffJson: JSON.stringify(input.semanticDiff),
        status:
          input.status === "rejected"
            ? "rejected"
            : existingPatch?.status === "accepted"
              ? "accepted"
              : "verified",
        updatedAt: timestamp
      })
      .where(eq(patchesTable.id, input.patchId))
      .run()

    if (input.taskId) {
      this.db
        .update(tasksTable)
        .set({
          status: input.status === "rejected" ? "rejected" : "verified",
          updatedAt: timestamp
        })
        .where(eq(tasksTable.id, input.taskId))
        .run()
    }

    if (input.checks.length > 0) {
      this.db
        .insert(checksTable)
        .values(
          input.checks.map((check) => ({
            id: createId(),
            patchId: input.patchId,
            type: check.type,
            status: check.status,
            output: check.output ?? check.summary,
            metadataJson: JSON.stringify({ summary: check.summary }),
            createdAt: timestamp
          }))
        )
        .run()
    }

    if (input.violations.length > 0) {
      this.db
        .insert(violationsTable)
        .values(
          input.violations.map((violation) => ({
            id: createId(),
            patchId: input.patchId,
            severity: violation.severity,
            type: violation.type,
            message: violation.message,
            metadataJson: null,
            createdAt: timestamp
          }))
        )
        .run()
    }
  }

  async verifyPatch(cwd: string, patchId: string): Promise<VerifyPatchResult> {
    const patchService = new PatchRecordService(this.db)
    const patch = patchService.getPatch(patchId)
    if (!patch) {
      throw new XieZhiError("CLI_USAGE_ERROR", `Patch ${patchId} was not found.`)
    }

    const repositoryService = new RepositoryMetadataService(this.db)
    const repository = await repositoryService.refreshForCwd(cwd)
    const task = this.findTask(patch.taskId)
    const intent = safeJsonParse<IntentIr | null>(task?.intentIrJson ?? null, null)
    const currentPatchState = await capturePatchState(patch.worktreePath)
    const changedFiles = currentPatchState.changedFiles.length > 0 ? currentPatchState.changedFiles : patch.changedFiles

    if (changedFiles.join("\n") !== patch.changedFiles.join("\n") || currentPatchState.diff !== (patch.diff ?? "")) {
      patchService.updatePatchSnapshot(patchId, {
        changedFiles,
        diff: currentPatchState.diff
      })
    }

    const semanticDiff = await this.buildSemanticDiff({
      repoId: repository.id,
      repoRoot: repository.rootPath,
      worktreePath: patch.worktreePath,
      changedFiles
    })
    const checks = this.buildChecks(intent, patch.commandLogs)
    const requiredCheckTypes = this.collectRequiredCheckTypes({
      taskTitle: intent?.goal ?? task?.id ?? patch.taskId,
      changedFiles,
      intent
    })
    const worktreeHeadCommit = await this.getWorktreeHeadCommit(patch.worktreePath)
    const violations = this.buildViolations({
      patchTaskId: patch.taskId,
      taskExists: task !== null,
      changedFiles,
      allowedFiles: intent?.allowedFiles ?? [],
      forbiddenFiles: intent?.forbiddenFiles ?? [],
      semanticDiff,
      checks,
      requiredCheckTypes,
      acceptance: intent?.acceptance ?? [],
      worktreeHeadCommit,
      baseCommit: patch.baseCommit
    })

    const blockingViolations = violations.filter((violation) => violation.severity === "blocking")
    const warnings = violations.filter((violation) => violation.severity === "warning")
    const status: VerifyPatchResult["status"] =
      blockingViolations.length > 0 ? "rejected" : warnings.length > 0 ? "warning" : "accepted"

    this.persistVerification({
      patchId,
      taskId: task?.id ?? null,
      status,
      semanticDiff,
      checks,
      violations
    })

    return {
      status,
      patchId,
      taskId: task?.id ?? patch.taskId,
      runtimeName: patch.runtimeName,
      patchStatus: status === "rejected" ? "rejected" : patch.status === "accepted" ? "accepted" : "verified",
      taskStatus: status === "rejected" ? "rejected" : task?.status ?? "verified",
      goal: intent?.goal ?? patch.taskId,
      changedFiles,
      semanticDiff,
      checks,
      requiredCheckTypes,
      blockingViolations,
      warnings,
      nextStep:
        status === "rejected"
          ? `Blocking issues found. Run \`xiezhi task discard ${patchId}\` or \`xiezhi task retry ${patchId} --runtime ${patch.runtimeName}\`.`
          : status === "warning"
            ? `Warnings remain. Edit ${patch.worktreePath} and rerun \`xiezhi verify ${patchId}\`, or run \`xiezhi review ${patchId}\` for a summary now.`
            : `Patch passed verification. Run \`xiezhi review ${patchId}\` for a final semantic summary, then \`xiezhi patch accept ${patchId}\` when you are ready to accept it.`
    }
  }

  async reviewPatch(cwd: string, patchId: string): Promise<ReviewPatchResult> {
    const verification = await this.verifyPatch(cwd, patchId)
    const patch = new PatchRecordService(this.db).getPatch(patchId)
    if (!patch) {
      throw new XieZhiError("CLI_USAGE_ERROR", `Patch ${patchId} was not found.`)
    }

    const summary =
      verification.semanticDiff.addedNodes.length === 0 &&
      verification.semanticDiff.removedNodes.length === 0 &&
      verification.changedFiles.length === 0
        ? "No code changes were captured in this patch."
        : `Patch touches ${verification.changedFiles.length} file(s), adds ${verification.semanticDiff.addedNodes.length} semantic node(s), and removes ${verification.semanticDiff.removedNodes.length} semantic node(s).`

    return {
      status: "reviewed",
      patchId,
      taskId: verification.taskId,
      runtimeName: patch.runtimeName,
      goal: verification.goal,
      summary,
      changedFiles: verification.changedFiles,
      semanticDiff: verification.semanticDiff,
      checks: verification.checks,
      requiredCheckTypes: verification.requiredCheckTypes,
      warnings: verification.warnings,
      blockingViolations: verification.blockingViolations,
      nextActions: [
        verification.nextStep,
        verification.status === "accepted"
          ? `If the review looks good, accept it with \`xiezhi patch accept ${patchId}\`.`
          : "Resolve blocking issues or warnings before final acceptance.",
        verification.changedFiles.length === 0
          ? `No edits were captured. Add changes in ${patch.worktreePath} or rerun \`xiezhi task retry ${patchId} --runtime ${patch.runtimeName}\`.`
          : "Inspect the semantic diff and changed files before merging."
      ]
    }
  }
}

export async function verifyPatch(cwd: string, patchId: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new VerificationService(drizzle(sqlite, { schema }))
    return await service.verifyPatch(cwd, patchId)
  } finally {
    sqlite.close()
  }
}

export async function reviewPatch(cwd: string, patchId: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new VerificationService(drizzle(sqlite, { schema }))
    return await service.reviewPatch(cwd, patchId)
  } finally {
    sqlite.close()
  }
}
