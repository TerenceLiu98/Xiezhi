import { desc, eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { XieZhiError } from "../core/errors.js"
import { assertDatabaseInitialized, openDatabaseConnection, type XieZhiDatabase } from "../db/client.js"
import * as schema from "../db/schema.js"
import {
  agentEventsTable,
  agentRunsTable,
  agentSessionsTable,
  checksTable,
  patchesTable,
  tasksTable,
  violationsTable
} from "../db/schema.js"
import { getPlanView } from "./planning-service.js"
import { getIntentParallelGroup, getIntentSubagentRole, type IntentIr } from "../planning/types.js"

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeScope(scope: string) {
  return scope.replace(/\\/g, "/").replace(/\/\*\*$/, "/")
}

export function scopesConflict(left: string[], right: string[]) {
  for (const leftScope of left.map(normalizeScope)) {
    for (const rightScope of right.map(normalizeScope)) {
      if (leftScope === rightScope) return true
      if (leftScope.endsWith("/") && rightScope.startsWith(leftScope)) return true
      if (rightScope.endsWith("/") && leftScope.startsWith(rightScope)) return true
    }
  }
  return false
}

function statusRank(status: string) {
  const ranks = new Map([
    ["failed", 0],
    ["rejected", 1],
    ["running", 2],
    ["patched", 3],
    ["verified", 4],
    ["ready", 5],
    ["draft", 6],
    ["promoted", 7],
    ["completed", 8]
  ])
  return ranks.get(status) ?? 99
}

export type ReadyQueueResult = {
  status: "loaded"
  featureId: string
  featureTitle: string
  featureStatus: string
  readyTasks: Array<{
    id: string
    title: string
    status: string
    allowedFiles: string[]
    dependsOnTaskIds: string[]
    canRunWith: string[]
    subagentRole: string
    parallelGroup: string | null
  }>
  blockedTasks: Array<{
    id: string
    title: string
    status: string
    blockedBy: string[]
    blockedReasons: Array<{ taskId: string; status: string; reason: string }>
  }>
  doneTasks: Array<{ id: string; title: string; status: string }>
  skippedTasks: Array<{ id: string; title: string; reason: string }>
  nextAction: string
}

export type AgentSessionShowResult = {
  status: "loaded"
  session: {
    id: string
    goal: string
    status: string
    planningRuntimeName: string
    featureId: string | null
    planSummary: unknown
    createdAt: string
    updatedAt: string
  }
  feature: {
    id: string
    title: string
    status: string
    taskCount: number
    readyCount: number
    blockedCount: number
    doneCount: number
  } | null
  tasks: ReadyQueueResult["readyTasks"]
  agentRuns: Array<{
    id: string
    taskId: string
    status: string
    runtimeName: string
    runtimeMode: string | null
    patchId: string | null
    eventSummary: unknown
  }>
  patches: Array<{
    id: string
    taskId: string
    status: string
    changedFiles: string[]
    warnings: number
    blockingViolations: number
  }>
  promotionDecisions: Array<{ agentRunId: string; summary: string; metadata: unknown }>
  decisionPoints: Array<{ agentRunId: string; summary: string; metadata: unknown }>
  resolvedDecisions: Array<{ agentRunId: string; summary: string; metadata: unknown }>
  problemReports: Array<{ agentRunId: string; summary: string; metadata: unknown }>
  proposedSolutions: Array<{ agentRunId: string; summary: string; metadata: unknown }>
  progressReports: Array<{ agentRunId: string; summary: string; metadata: unknown; createdAt: string }>
  executionPlans: Array<{ agentRunId: string; summary: string; metadata: unknown; createdAt: string }>
  supervisorHandoffs: Array<{ agentRunId: string; summary: string; metadata: unknown; createdAt: string }>
  normalizationEvents: Array<{ agentRunId: string; type: string; summary: string; metadata: unknown; createdAt: string }>
  buildEvents: Array<{ agentRunId: string; type: string; summary: string; metadata: unknown }>
  nextAction: string
}

export class AgentObservabilityService {
  constructor(private readonly db: XieZhiDatabase, private readonly cwd: string) {}

  ready(featureId?: string): ReadyQueueResult {
    const plan = getPlanView(this.cwd, featureId)
    const taskById = new Map(plan.tasks.map((task) => [task.id, task]))
    const taskRows =
      plan.tasks.length > 0 ? this.db.select().from(tasksTable).where(inArray(tasksTable.id, plan.tasks.map((task) => task.id))).all() : []
    const intentByTaskId = new Map(taskRows.map((task) => [task.id, safeJsonParse<IntentIr | null>(task.intentIrJson, null)]))
    const dependencyBlockReason = (dependencyId: string) => {
      const dependency = taskById.get(dependencyId)
      if (!dependency) {
        return { taskId: dependencyId, status: "missing", reason: "dependency task is missing" }
      }
      if (dependency.status === "promoted") {
        return null
      }
      if (dependency.status === "verified") {
        return { taskId: dependencyId, status: dependency.status, reason: "dependency verified but not promoted" }
      }
      if (dependency.status === "patched") {
        return { taskId: dependencyId, status: dependency.status, reason: "dependency patch captured but not verified/promoted" }
      }
      if (dependency.status === "rejected" || dependency.status === "failed") {
        return { taskId: dependencyId, status: dependency.status, reason: `dependency ${dependency.status}` }
      }
      return { taskId: dependencyId, status: dependency.status, reason: `dependency status is ${dependency.status}` }
    }
    const dependencySatisfied = (task: (typeof plan.tasks)[number]) => {
      return task.dependsOnTaskIds.every((dependencyId) => {
        return dependencyBlockReason(dependencyId) === null
      })
    }
    const readyBase = plan.tasks.filter((task) => {
      if (task.status === "ready") return dependencySatisfied(task)
      return task.status === "draft" && dependencySatisfied(task)
    })
    const readyTasks = readyBase.map((task) => ({
      id: task.id,
      title: task.title,
      status: "ready",
      allowedFiles: task.allowedFiles,
      dependsOnTaskIds: task.dependsOnTaskIds,
      subagentRole: getIntentSubagentRole(intentByTaskId.get(task.id) ?? null),
      parallelGroup: getIntentParallelGroup(intentByTaskId.get(task.id) ?? null),
      canRunWith: readyBase
        .filter((candidate) => candidate.id !== task.id && !scopesConflict(task.allowedFiles, candidate.allowedFiles))
        .map((candidate) => candidate.id)
    }))
    const blockedTasks = plan.tasks
      .filter((task) => task.status === "draft" && !dependencySatisfied(task))
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        blockedReasons: task.dependsOnTaskIds.flatMap((dependencyId) => {
          const reason = dependencyBlockReason(dependencyId)
          return reason ? [reason] : []
        }),
        blockedBy: task.dependsOnTaskIds.filter((dependencyId) => dependencyBlockReason(dependencyId) !== null)
      }))
    const doneTasks = plan.tasks
      .filter((task) => ["promoted", "completed"].includes(task.status))
      .map((task) => ({ id: task.id, title: task.title, status: task.status }))
    const skippedTasks = plan.tasks
      .filter((task) => task.status !== "ready" && task.status !== "draft" && !["promoted", "completed"].includes(task.status))
      .sort((left, right) => statusRank(left.status) - statusRank(right.status))
      .map((task) => ({ id: task.id, title: task.title, reason: `status is ${task.status}` }))

    return {
      status: "loaded",
      featureId: plan.feature.id,
      featureTitle: plan.feature.title,
      featureStatus: plan.feature.status,
      readyTasks,
      blockedTasks,
      doneTasks,
      skippedTasks,
      nextAction:
        readyTasks.length > 0
          ? `Run ready work with \`xiezhi agent run-ready ${plan.feature.id} --runtime opencode --parallel 2 --auto\`.`
          : blockedTasks.length > 0
            ? "No tasks are ready yet; inspect blocked dependencies."
            : "Feature has no ready or blocked tasks."
    }
  }

  showSession(sessionId?: string): AgentSessionShowResult {
    const session = sessionId
      ? this.db.select().from(agentSessionsTable).where(eq(agentSessionsTable.id, sessionId)).get()
      : this.db.select().from(agentSessionsTable).orderBy(desc(agentSessionsTable.createdAt)).get()
    if (!session) {
      throw new XieZhiError("CLI_USAGE_ERROR", "No agent session found.", {
        hint: "Run `xiezhi agent plan \"...\" --runtime opencode` first."
      })
    }

    const ready = session.featureId ? this.ready(session.featureId) : null
    const taskIds = session.featureId ? this.db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.featureId, session.featureId)).all().map((task) => task.id) : []
    const agentRuns = this.db.select().from(agentRunsTable).where(eq(agentRunsTable.agentSessionId, session.id)).all()
    const patchRows = taskIds.length > 0 ? this.db.select().from(patchesTable).where(inArray(patchesTable.taskId, taskIds)).all() : []
    const patchIds = patchRows.map((patch) => patch.id)
    const violations = patchIds.length > 0 ? this.db.select().from(violationsTable).where(inArray(violationsTable.patchId, patchIds)).all() : []
    const checks = patchIds.length > 0 ? this.db.select().from(checksTable).where(inArray(checksTable.patchId, patchIds)).all() : []
    const events = agentRuns.length > 0 ? this.db.select().from(agentEventsTable).where(inArray(agentEventsTable.agentRunId, agentRuns.map((run) => run.id))).all() : []

    return {
      status: "loaded",
      session: {
        id: session.id,
        goal: session.goal,
        status: session.status,
        planningRuntimeName: session.planningRuntimeName,
        featureId: session.featureId,
        planSummary: safeJsonParse<unknown>(session.planSummaryJson, null),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      },
      feature: ready
        ? {
            id: ready.featureId,
            title: ready.featureTitle,
            status: ready.featureStatus,
            taskCount: ready.readyTasks.length + ready.blockedTasks.length + ready.doneTasks.length + ready.skippedTasks.length,
            readyCount: ready.readyTasks.length,
            blockedCount: ready.blockedTasks.length,
            doneCount: ready.doneTasks.length
          }
        : null,
      tasks: ready?.readyTasks ?? [],
      agentRuns: agentRuns.map((run) => ({
        id: run.id,
        taskId: run.taskId,
        status: run.status,
        runtimeName: run.runtimeName,
        runtimeMode: run.runtimeMode,
        patchId: run.patchId,
        eventSummary: safeJsonParse<unknown>(run.eventSummaryJson, null)
      })),
      patches: patchRows.map((patch) => ({
        id: patch.id,
        taskId: patch.taskId,
        status: patch.status,
        changedFiles: safeJsonParse<string[]>(patch.changedFilesJson, []),
        warnings: violations.filter((violation) => violation.patchId === patch.id && violation.severity === "warning").length,
        blockingViolations: violations.filter((violation) => violation.patchId === patch.id && violation.severity === "blocking").length
      })),
      promotionDecisions: events
        .filter((event) => event.type === "promotion_decision")
        .map((event) => ({ agentRunId: event.agentRunId, summary: event.summary, metadata: safeJsonParse<unknown>(event.metadataJson, null) })),
      decisionPoints: events
        .filter((event) => event.type === "decision_point_declared")
        .map((event) => ({ agentRunId: event.agentRunId, summary: event.summary, metadata: safeJsonParse<unknown>(event.metadataJson, null) })),
      resolvedDecisions: events
        .filter((event) => event.type === "decision_point_resolved")
        .map((event) => ({ agentRunId: event.agentRunId, summary: event.summary, metadata: safeJsonParse<unknown>(event.metadataJson, null) })),
      problemReports: events
        .filter((event) => event.type === "agent_problem_reported")
        .map((event) => ({ agentRunId: event.agentRunId, summary: event.summary, metadata: safeJsonParse<unknown>(event.metadataJson, null) })),
      proposedSolutions: events
        .filter((event) => event.type === "agent_solution_proposed")
        .map((event) => ({ agentRunId: event.agentRunId, summary: event.summary, metadata: safeJsonParse<unknown>(event.metadataJson, null) })),
      progressReports: events
        .filter((event) => event.type === "agent_progress_reported")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((event) => ({
          agentRunId: event.agentRunId,
          summary: event.summary,
          metadata: safeJsonParse<unknown>(event.metadataJson, null),
          createdAt: event.createdAt
        })),
      executionPlans: events
        .filter((event) => event.type === "agent_execution_plan_declared")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((event) => ({
          agentRunId: event.agentRunId,
          summary: event.summary,
          metadata: safeJsonParse<unknown>(event.metadataJson, null),
          createdAt: event.createdAt
        })),
      supervisorHandoffs: events
        .filter((event) => event.type === "supervisor_handoff")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((event) => ({
          agentRunId: event.agentRunId,
          summary: event.summary,
          metadata: safeJsonParse<unknown>(event.metadataJson, null),
          createdAt: event.createdAt
        })),
      normalizationEvents: events
        .filter((event) => event.type === "normalization_started" || event.type === "normalization_completed" || event.type === "normalization_failed")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((event) => ({
          agentRunId: event.agentRunId,
          type: event.type,
          summary: event.summary,
          metadata: safeJsonParse<unknown>(event.metadataJson, null),
          createdAt: event.createdAt
        })),
      buildEvents: events
        .filter((event) => event.type === "build_wave_started" || event.type === "build_wave_completed")
        .map((event) => ({ agentRunId: event.agentRunId, type: event.type, summary: event.summary, metadata: safeJsonParse<unknown>(event.metadataJson, null) })),
      nextAction: ready?.nextAction ?? "Session has no imported feature yet.",
    }
  }
}

export function getReadyQueue(cwd: string, featureId?: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    return new AgentObservabilityService(drizzle(sqlite, { schema }), cwd).ready(featureId)
  } finally {
    sqlite.close()
  }
}

export function showAgentSession(cwd: string, sessionId?: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    return new AgentObservabilityService(drizzle(sqlite, { schema }), cwd).showSession(sessionId)
  } finally {
    sqlite.close()
  }
}
