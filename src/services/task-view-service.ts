import { desc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { XieZhiError } from "../core/errors.js"
import { assertDatabaseInitialized, openDatabaseConnection, type XieZhiDatabase } from "../db/client.js"
import * as schema from "../db/schema.js"
import {
  agentRunsTable,
  agentEventsTable,
  assignmentsTable,
  checksTable,
  dagNodesTable,
  patchesTable,
  tasksTable,
  violationsTable
} from "../db/schema.js"
import {
  getIntentAllowedSymbols,
  getIntentExpectedOutputs,
  getIntentForbiddenSymbols,
  type IntentIr
} from "../planning/types.js"
import type { PatchRuntimeEvidence } from "./patch-record-service.js"

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

function nextAction(input: { taskStatus: string; latestPatch: { id: string; status: string; runtimeName: string } | null }) {
  if (!input.latestPatch) {
    return input.taskStatus === "ready" ? "Run this task with `xiezhi agent run <task-id> --runtime opencode`." : "No patch exists yet."
  }
  if (input.latestPatch.status === "pending") {
    return `Verify the patch with \`xiezhi verify ${input.latestPatch.id}\`.`
  }
  if (input.latestPatch.status === "verified") {
    return `Review with \`xiezhi review ${input.latestPatch.id}\`, then promote with \`xiezhi patch promote ${input.latestPatch.id}\`.`
  }
  if (input.latestPatch.status === "promoted") {
    return "Patch has been promoted into the repository. Run the app build checks from the repository root."
  }
  if (input.latestPatch.status === "rejected") {
    return `Retry or discard with \`xiezhi task retry ${input.latestPatch.id} --runtime ${input.latestPatch.runtimeName}\`.`
  }
  return "No immediate action is required."
}

export type TaskShowResult = {
  status: "loaded"
  taskId: string
  taskStatus: string
  title: string
  body: string | null
  goal: string
  summary: string
  rationale: string[]
  allowedFiles: string[]
  forbiddenFiles: string[]
  relatedSymbols: string[]
  allowedSymbols: string[]
  forbiddenSymbols: string[]
  acceptance: string[]
  recommendedCommands: string[]
  expectedOutputs: string[]
  latestPatch: {
    id: string
    status: string
    runtimeName: string
    runtimeMode: string
    changedFiles: string[]
    worktreePath: string
    evidence: PatchRuntimeEvidence | null
    promotedAt: string | null
  } | null
  latestAgentRun: {
    id: string
    status: string
    runtimeName: string
    runtimeMode: string | null
    patchId: string | null
    eventSummary: unknown
  } | null
  latestAssignment: {
    id: string
    status: string
    goal: string
  } | null
  latestPromotionDecision: {
    summary: string
    metadata: unknown
  } | null
  checks: Array<{ type: string; status: string; summary: string }>
  violations: Array<{ severity: string; type: string; message: string }>
  nextAction: string
}

export class TaskViewService {
  constructor(private readonly db: XieZhiDatabase) {}

  showTask(taskId: string): TaskShowResult {
    const task = this.db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).get()
    if (!task) {
      throw new XieZhiError("CLI_USAGE_ERROR", `Task ${taskId} was not found.`, {
        hint: "Run `xiezhi task list` to find a valid task id."
      })
    }

    const node = this.db.select().from(dagNodesTable).where(eq(dagNodesTable.id, task.dagNodeId)).get()
    const intent = safeJsonParse<IntentIr | null>(task.intentIrJson, null)
    const patches = this.db
      .select()
      .from(patchesTable)
      .where(eq(patchesTable.taskId, taskId))
      .orderBy(desc(patchesTable.createdAt))
      .all()
    const latestPatchRow = patches[0] ?? null
    const latestPatch = latestPatchRow
      ? {
          id: latestPatchRow.id,
          status: latestPatchRow.status,
          runtimeName: latestPatchRow.runtimeName,
          runtimeMode: latestPatchRow.runtimeMode,
          changedFiles: safeJsonParse<string[]>(latestPatchRow.changedFilesJson, []),
          worktreePath: latestPatchRow.worktreePath,
          evidence: safeJsonParse<PatchRuntimeEvidence | null>(latestPatchRow.runtimeEvidenceJson, null),
          promotedAt: latestPatchRow.promotedAt
        }
      : null

    const checks = latestPatch
      ? this.db
          .select()
          .from(checksTable)
          .where(eq(checksTable.patchId, latestPatch.id))
          .all()
          .map((check) => ({
            type: check.type,
            status: check.status,
            summary: safeJsonParse<{ summary?: string }>(check.metadataJson, {}).summary ?? check.output ?? check.status
          }))
      : []
    const violations = latestPatch
      ? this.db
          .select()
          .from(violationsTable)
          .where(eq(violationsTable.patchId, latestPatch.id))
          .all()
          .map((violation) => ({
            severity: violation.severity,
            type: violation.type,
            message: violation.message
          }))
      : []

    const agentRunRow = latestPatch?.id
      ? this.db.select().from(agentRunsTable).where(eq(agentRunsTable.patchId, latestPatch.id)).get()
      : this.db.select().from(agentRunsTable).where(eq(agentRunsTable.taskId, taskId)).orderBy(desc(agentRunsTable.createdAt)).get()
    const assignmentRow = agentRunRow?.assignmentId
      ? this.db.select().from(assignmentsTable).where(eq(assignmentsTable.id, agentRunRow.assignmentId)).get()
      : null
    const promotionDecisionRow = agentRunRow
      ? this.db
          .select()
          .from(agentEventsTable)
          .where(eq(agentEventsTable.agentRunId, agentRunRow.id))
          .all()
          .filter((event) => event.type === "promotion_decision")
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
      : null

    return {
      status: "loaded",
      taskId,
      taskStatus: task.status,
      title: node?.title ?? task.id,
      body: node?.body ?? null,
      goal: intent?.goal ?? node?.title ?? task.id,
      summary: intent?.summary ?? node?.body ?? "",
      rationale: intent?.rationale ?? [],
      allowedFiles: intent?.allowedFiles ?? [],
      forbiddenFiles: intent?.forbiddenFiles ?? [],
      relatedSymbols: intent?.relatedSymbols ?? [],
      allowedSymbols: getIntentAllowedSymbols(intent),
      forbiddenSymbols: getIntentForbiddenSymbols(intent),
      acceptance: intent?.acceptance ?? [],
      recommendedCommands: intent?.recommendedCommands ?? [],
      expectedOutputs: getIntentExpectedOutputs(intent),
      latestPatch,
      latestAgentRun: agentRunRow
        ? {
            id: agentRunRow.id,
            status: agentRunRow.status,
            runtimeName: agentRunRow.runtimeName,
            runtimeMode: agentRunRow.runtimeMode,
            patchId: agentRunRow.patchId,
            eventSummary: safeJsonParse<unknown>(agentRunRow.eventSummaryJson, null)
          }
        : null,
      latestAssignment: assignmentRow
        ? {
            id: assignmentRow.id,
            status: assignmentRow.status,
            goal: assignmentRow.goal
        }
        : null,
      latestPromotionDecision: promotionDecisionRow
        ? {
            summary: promotionDecisionRow.summary,
            metadata: safeJsonParse<unknown>(promotionDecisionRow.metadataJson, null)
          }
        : null,
      checks,
      violations,
      nextAction: nextAction({ taskStatus: task.status, latestPatch })
    }
  }
}

export async function showTask(cwd: string, taskId: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new TaskViewService(drizzle(sqlite, { schema }))
    return service.showTask(taskId)
  } finally {
    sqlite.close()
  }
}
