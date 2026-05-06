import { desc, eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"

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
import { getReadyQueue, showAgentSession, type AgentSessionShowResult, type ReadyQueueResult } from "./agent-observability-service.js"
import { getPlanView } from "./planning-service.js"
import { showTask, type TaskShowResult } from "./task-view-service.js"
import { getIntentParallelGroup, type IntentIr } from "../planning/types.js"

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

type CytoscapeElement = {
  data: Record<string, unknown>
  classes?: string
}

export type GraphViewState = {
  status: "empty" | "loaded"
  session: AgentSessionShowResult["session"] | null
  feature: AgentSessionShowResult["feature"]
  ready: ReadyQueueResult | null
  events: Array<{ type: string; summary: string; createdAt: string; metadata: unknown }>
  pendingDecision: unknown
  currentPhase: string
  currentSummary: string
  currentTaskId: string | null
  currentExecutionGroup: string | null
  subagents: Array<{ id: string; role: string; taskId: string | null; status: string; summary: string }>
  progressReports: AgentSessionShowResult["progressReports"]
  executionPlans: AgentSessionShowResult["executionPlans"]
  runtimeModel: string | null
  decisionModel: string | null
  supervisorPhase: string
  supervisorSummary: string
  supervisorObservations: string[]
  supervisorHandoff: unknown
  normalizationStatus: string
  runtimeError: string | null
}

export type GraphView = {
  status: "empty" | "loaded"
  featureId: string | null
  nodes: CytoscapeElement[]
  edges: CytoscapeElement[]
}

export class GraphViewService {
  constructor(private readonly db: XieZhiDatabase, private readonly cwd: string) {}

  private latestSessionId() {
    return this.db.select({ id: agentSessionsTable.id }).from(agentSessionsTable).orderBy(desc(agentSessionsTable.createdAt)).get()?.id ?? null
  }

  state(input?: { sessionId?: string; pendingDecision?: unknown; runtimeModel?: string | null; decisionModel?: string | null }): GraphViewState {
    const sessionId = input?.sessionId ?? this.latestSessionId()
    if (!sessionId) {
      return {
        status: "empty",
        session: null,
        feature: null,
        ready: null,
        events: [],
        pendingDecision: input?.pendingDecision ?? null,
        currentPhase: "idle",
        currentSummary: "No agent build session has started.",
        currentTaskId: null,
        currentExecutionGroup: null,
        subagents: [],
        progressReports: [],
        executionPlans: [],
        runtimeModel: input?.runtimeModel ?? null,
        decisionModel: input?.decisionModel ?? input?.runtimeModel ?? null,
        supervisorPhase: "idle",
        supervisorSummary: "No supervisor session has started.",
        supervisorObservations: [],
        supervisorHandoff: null,
        normalizationStatus: "idle",
        runtimeError: null
      }
    }

    const session = showAgentSession(this.cwd, sessionId)
    const ready = session.session.featureId ? getReadyQueue(this.cwd, session.session.featureId) : null
    const agentRuns = this.db.select().from(agentRunsTable).where(eq(agentRunsTable.agentSessionId, sessionId)).all()
    const events =
      agentRuns.length > 0
        ? this.db
            .select()
            .from(agentEventsTable)
            .where(inArray(agentEventsTable.agentRunId, agentRuns.map((run) => run.id)))
            .all()
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .map((event) => ({
              type: event.type,
              summary: event.summary,
              createdAt: event.createdAt,
              metadata: safeJsonParse<unknown>(event.metadataJson, null)
            }))
        : []
    const latestProgress = session.progressReports.at(-1)
    const latestHandoff = session.supervisorHandoffs.at(-1) ?? null
    const latestNormalization = session.normalizationEvents.at(-1) ?? null
    const latestProblem = session.problemReports.at(-1) ?? null
    const latestProgressMetadata =
      latestProgress?.metadata && typeof latestProgress.metadata === "object" ? (latestProgress.metadata as Record<string, unknown>) : null
    const subagents = Array.isArray(latestProgressMetadata?.subagents)
      ? latestProgressMetadata.subagents
          .filter((subagent): subagent is Record<string, unknown> => Boolean(subagent) && typeof subagent === "object")
          .map((subagent) => ({
            id: String(subagent.id ?? ""),
            role: String(subagent.role ?? "implementation"),
            taskId: typeof subagent.taskId === "string" ? subagent.taskId : null,
            status: String(subagent.status ?? "planned"),
            summary: String(subagent.summary ?? "")
          }))
      : []

    return {
      status: "loaded",
      session: session.session,
      feature: session.feature,
      ready,
      events,
      pendingDecision: input?.pendingDecision ?? null,
      currentPhase: String(latestProgressMetadata?.phase ?? session.session.status),
      currentSummary: String(latestProgress?.summary ?? ready?.nextAction ?? "Waiting for agent evidence."),
      currentTaskId: typeof latestProgressMetadata?.currentTaskId === "string" ? latestProgressMetadata.currentTaskId : null,
      currentExecutionGroup: typeof latestProgressMetadata?.executionGroup === "string" ? latestProgressMetadata.executionGroup : null,
      subagents,
      progressReports: session.progressReports,
      executionPlans: session.executionPlans,
      runtimeModel: input?.runtimeModel ?? null,
      decisionModel: input?.decisionModel ?? input?.runtimeModel ?? null,
      supervisorPhase: latestHandoff ? "normalize_plan" : String(latestProgressMetadata?.phase ?? session.session.status),
      supervisorSummary: latestHandoff?.summary ?? String(latestProgress?.summary ?? ready?.nextAction ?? "Waiting for supervisor evidence."),
      supervisorObservations: session.progressReports.map((report) => report.summary).slice(-8),
      supervisorHandoff: latestHandoff?.metadata ?? null,
      normalizationStatus:
        latestNormalization?.type === "normalization_completed"
          ? "completed"
          : latestNormalization?.type === "normalization_failed"
            ? "failed"
            : latestNormalization?.type === "normalization_started"
              ? "running"
              : "idle",
      runtimeError:
        latestProblem?.summary && /runtime|model|provider|auth|schema/i.test(latestProblem.summary) ? latestProblem.summary : null
    }
  }

  graph(input?: { sessionId?: string; featureId?: string }): GraphView {
    const sessionId = input?.sessionId ?? this.latestSessionId()
    const session = sessionId ? this.db.select().from(agentSessionsTable).where(eq(agentSessionsTable.id, sessionId)).get() : null
    const featureId = input?.featureId ?? session?.featureId ?? null
    if (!featureId) {
      return { status: "empty", featureId: null, nodes: [], edges: [] }
    }

    const plan = getPlanView(this.cwd, featureId)
    const taskByDagNodeId = new Map(plan.tasks.map((task) => [task.dagNodeId, task]))
    const taskIds = plan.tasks.map((task) => task.id)
    const taskRows = taskIds.length > 0 ? this.db.select().from(tasksTable).where(inArray(tasksTable.id, taskIds)).all() : []
    const intentByTaskId = new Map(taskRows.map((task) => [task.id, safeJsonParse<IntentIr | null>(task.intentIrJson, null)]))
    const patchRows = taskIds.length > 0 ? this.db.select().from(patchesTable).where(inArray(patchesTable.taskId, taskIds)).all() : []
    const patchIds = patchRows.map((patch) => patch.id)
    const violations = patchIds.length > 0 ? this.db.select().from(violationsTable).where(inArray(violationsTable.patchId, patchIds)).all() : []
    const checks = patchIds.length > 0 ? this.db.select().from(checksTable).where(inArray(checksTable.patchId, patchIds)).all() : []
    const latestPatchByTaskId = new Map<string, (typeof patchRows)[number]>()
    for (const patch of patchRows.sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
      if (!latestPatchByTaskId.has(patch.taskId)) latestPatchByTaskId.set(patch.taskId, patch)
    }

    const parallelGroups = new Map<string, { id: string; label: string; taskDagNodeIds: string[] }>()
    for (const task of plan.tasks) {
      const group = getIntentParallelGroup(intentByTaskId.get(task.id) ?? null)
      if (!group || group === "none") continue
      const id = `execution:${group}`
      const existing = parallelGroups.get(id) ?? { id, label: group, taskDagNodeIds: [] }
      existing.taskDagNodeIds.push(task.dagNodeId)
      parallelGroups.set(id, existing)
    }

    const nodes: CytoscapeElement[] = plan.nodes.map((node) => {
      const task = taskByDagNodeId.get(node.id)
      const latestPatch = task ? latestPatchByTaskId.get(task.id) ?? null : null
      const patchViolations = latestPatch ? violations.filter((violation) => violation.patchId === latestPatch.id) : []
      const patchChecks = latestPatch ? checks.filter((check) => check.patchId === latestPatch.id) : []
      const warningCount = patchViolations.filter((violation) => violation.severity === "warning").length
      const blockingCount = patchViolations.filter((violation) => violation.severity === "blocking").length
      const effectiveStatus = task?.status ?? node.status
      return {
        data: {
          id: node.id,
          label: node.title,
          type: node.type,
          status: effectiveStatus,
          body: node.body,
          taskId: task?.id ?? null,
          allowedFiles: task?.allowedFiles ?? [],
          acceptance: task?.acceptance ?? [],
          latestPatch: latestPatch
            ? {
                id: latestPatch.id,
                status: latestPatch.status,
                changedFiles: safeJsonParse<string[]>(latestPatch.changedFilesJson, []),
                warnings: warningCount,
                blockingViolations: blockingCount,
                checks: patchChecks.length
              }
            : null,
          warnings: warningCount,
          blockingViolations: blockingCount
        },
        classes: [node.type, effectiveStatus, warningCount > 0 ? "has-warning" : "", blockingCount > 0 ? "has-blocking" : ""]
          .filter(Boolean)
          .join(" ")
      }
    })
    for (const group of parallelGroups.values()) {
      nodes.push({
        data: {
          id: group.id,
          label: group.label,
          type: "execution_group",
          status: "ready",
          body: `${group.taskDagNodeIds.length} task(s) declared by agent parallelGroup metadata.`,
          taskId: null,
          allowedFiles: [],
          acceptance: [],
          latestPatch: null,
          warnings: 0,
          blockingViolations: 0
        },
        classes: "execution_group ready"
      })
    }

    const edges: CytoscapeElement[] = plan.edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.fromNodeId,
        target: edge.toNodeId,
        type: edge.edgeType,
        label: edge.edgeType
      },
      classes: edge.edgeType
    }))
    for (const group of parallelGroups.values()) {
      const featureNode = plan.nodes.find((node) => node.type === "feature")
      if (featureNode) {
        edges.push({
          data: {
            id: `${featureNode.id}->${group.id}`,
            source: featureNode.id,
            target: group.id,
            type: "contains",
            label: "contains"
          },
          classes: "contains"
        })
      }
      for (const taskDagNodeId of group.taskDagNodeIds) {
        edges.push({
          data: {
            id: `${group.id}->${taskDagNodeId}`,
            source: group.id,
            target: taskDagNodeId,
            type: "assigns",
            label: "assigns"
          },
          classes: "assigns"
        })
      }
    }

    return { status: "loaded", featureId, nodes, edges }
  }
}

export function getGraphState(cwd: string, input?: { sessionId?: string; pendingDecision?: unknown; runtimeModel?: string | null; decisionModel?: string | null }) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    return new GraphViewService(drizzle(sqlite, { schema }), cwd).state(input)
  } finally {
    sqlite.close()
  }
}

export function getGraphView(cwd: string, input?: { sessionId?: string; featureId?: string }) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    return new GraphViewService(drizzle(sqlite, { schema }), cwd).graph(input)
  } finally {
    sqlite.close()
  }
}

export async function getGraphTask(cwd: string, taskId: string): Promise<TaskShowResult> {
  return showTask(cwd, taskId)
}
