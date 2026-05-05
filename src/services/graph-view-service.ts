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

  state(input?: { sessionId?: string; pendingDecision?: unknown }): GraphViewState {
    const sessionId = input?.sessionId ?? this.latestSessionId()
    if (!sessionId) {
      return { status: "empty", session: null, feature: null, ready: null, events: [], pendingDecision: input?.pendingDecision ?? null }
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

    return {
      status: "loaded",
      session: session.session,
      feature: session.feature,
      ready,
      events,
      pendingDecision: input?.pendingDecision ?? null
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
    const patchRows = taskIds.length > 0 ? this.db.select().from(patchesTable).where(inArray(patchesTable.taskId, taskIds)).all() : []
    const patchIds = patchRows.map((patch) => patch.id)
    const violations = patchIds.length > 0 ? this.db.select().from(violationsTable).where(inArray(violationsTable.patchId, patchIds)).all() : []
    const checks = patchIds.length > 0 ? this.db.select().from(checksTable).where(inArray(checksTable.patchId, patchIds)).all() : []
    const latestPatchByTaskId = new Map<string, (typeof patchRows)[number]>()
    for (const patch of patchRows.sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
      if (!latestPatchByTaskId.has(patch.taskId)) latestPatchByTaskId.set(patch.taskId, patch)
    }

    const nodes = plan.nodes.map((node) => {
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

    const edges = plan.edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.fromNodeId,
        target: edge.toNodeId,
        type: edge.edgeType,
        label: edge.edgeType
      },
      classes: edge.edgeType
    }))

    return { status: "loaded", featureId, nodes, edges }
  }
}

export function getGraphState(cwd: string, input?: { sessionId?: string; pendingDecision?: unknown }) {
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
