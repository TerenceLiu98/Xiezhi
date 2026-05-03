import { desc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { XieZhiError } from "../core/errors.js"
import { createId, stableId } from "../core/ids.js"
import { nowIso } from "../core/time.js"
import { assertDatabaseInitialized, openDatabaseConnection, type XieZhiDatabase } from "../db/client.js"
import * as schema from "../db/schema.js"
import { dagEdgesTable, dagNodesTable, featuresTable, patchesTable, tasksTable } from "../db/schema.js"
import type { ExecutionPolicy } from "../runtime/shared/contracts.js"
import {
  agentPlanV1Schema,
  intentIrSchema,
  plannedDagEdgeSchema,
  plannedDagNodeSchema,
  taskMetadataSchema,
  type AgentPlanV1,
  type AgentPlanTask,
  type FeatureStatus,
  type IntentIr,
  type PlanView,
  type PlannedDagEdge,
  type PlannedDagNode,
  type PlannedTask
} from "../planning/types.js"
import { validatePlanningDag } from "../planning/validation.js"

type FeatureRow = typeof featuresTable.$inferSelect

export type ImportAgentPlanProvenance = {
  runtimeName: string
  rawOutput?: string | null
  agentSessionId?: string | null
}

export type ImportAgentPlanResult = {
  status: "planned"
  goal: string
  featureId: string
  title: string
  featureStatus: FeatureStatus
  taskCount: number
  nodeCount: number
  edgeCount: number
  taskKeyMap: Record<string, string>
  tasks: Array<{
    key: string
    id: string
    title: string
    status: string
    dependsOnTaskIds: string[]
    allowedFiles: string[]
    acceptance: string[]
  }>
}

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

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

function normalizeRelatedSymbols(symbols: string[]) {
  return unique(
    symbols.filter((symbol) => {
      if (!symbol || symbol.includes("/") || symbol.includes("\\")) {
        return false
      }
      return !/\.(ts|tsx|js|jsx)$/.test(symbol)
    })
  )
}

function assertSafePlanPath(filePath: string, field: string) {
  if (!filePath || filePath.startsWith("/") || filePath.split(/[\\/]+/).includes("..")) {
    throw new XieZhiError("CLI_USAGE_ERROR", `AgentPlan contains an unsafe ${field}: ${filePath}`, {
      hint: "Ask the agent to regenerate the plan using repository-relative paths."
    })
  }
}

function scopeSummary(task: AgentPlanTask) {
  const codeCount = task.allowedFiles.filter((file) => !file.includes(".test.") && !file.includes(".spec.")).length
  const testCount = task.allowedFiles.length - codeCount
  return `${codeCount} code file${codeCount === 1 ? "" : "s"}${testCount > 0 ? `, ${testCount} test file${testCount === 1 ? "" : "s"}` : ""}`
}

function validateAgentPlan(plan: AgentPlanV1) {
  const keys = new Set<string>()
  for (const task of plan.tasks) {
    if (keys.has(task.key)) {
      throw new XieZhiError("CLI_USAGE_ERROR", `AgentPlan task key is duplicated: ${task.key}`, {
        hint: "Ask the agent to regenerate the plan with unique task keys."
      })
    }
    keys.add(task.key)
    for (const filePath of [...task.allowedFiles, ...task.forbiddenFiles]) {
      assertSafePlanPath(filePath, "path")
    }
  }

  const adjacency = new Map(plan.tasks.map((task) => [task.key, task.dependsOn]))
  for (const task of plan.tasks) {
    for (const dependency of task.dependsOn) {
      if (!keys.has(dependency)) {
        throw new XieZhiError("CLI_USAGE_ERROR", `AgentPlan task ${task.key} depends on unknown task ${dependency}.`, {
          hint: "Ask the agent to regenerate the plan with valid dependency keys."
        })
      }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (key: string) => {
    if (visited.has(key)) {
      return
    }
    if (visiting.has(key)) {
      throw new XieZhiError("CLI_USAGE_ERROR", "AgentPlan contains a task dependency cycle.", {
        hint: "Ask the agent to split the plan into an acyclic task DAG."
      })
    }
    visiting.add(key)
    for (const dependency of adjacency.get(key) ?? []) {
      visit(dependency)
    }
    visiting.delete(key)
    visited.add(key)
  }
  for (const task of plan.tasks) {
    visit(task.key)
  }
}

function buildIntent(plan: AgentPlanV1, task: AgentPlanTask): IntentIr {
  return intentIrSchema.parse({
    version: "v2",
    goal: task.title,
    summary: task.summary,
    allowedFiles: task.allowedFiles,
    forbiddenFiles: unique(task.forbiddenFiles.length > 0 ? task.forbiddenFiles : [".xiezhi/"]),
    relatedSymbols: unique([...task.allowedSymbols, ...task.forbiddenSymbols]),
    allowedSymbols: task.allowedSymbols,
    forbiddenSymbols: task.forbiddenSymbols,
    acceptance: task.acceptance,
    recommendedCommands: task.checks,
    expectedOutputs: task.expectedOutputs,
    rationale: task.rationale.length > 0 ? task.rationale : [`Imported from agent plan for: ${plan.goal}`]
  })
}

function buildPolicy(taskId: string, intent: IntentIr): ExecutionPolicy {
  return {
    taskId,
    allowedFiles: intent.allowedFiles,
    forbiddenFiles: intent.forbiddenFiles,
    allowedWriteRoots: ["."],
    allowedTools: ["read", "edit", "bash"],
    envAllowlist: [],
    deniedCommands: ["git reset --hard", "git checkout --"]
  }
}

export class PlanningService {
  constructor(private readonly db: XieZhiDatabase) {}

  importAgentPlan(input: { plan: unknown; provenance: ImportAgentPlanProvenance }): ImportAgentPlanResult {
    const parsed = agentPlanV1Schema.safeParse(input.plan)
    if (!parsed.success) {
      throw new XieZhiError("CLI_USAGE_ERROR", "AgentPlan JSON does not match AgentPlan v1.", {
        hint: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ")
      })
    }
    const plan = parsed.data
    validateAgentPlan(plan)

    const featureId = createId()
    const createdAt = nowIso()
    const featureStatus: FeatureStatus = "draft"
    const featureNodeId = stableId("dag", `${featureId}:feature`)
    const taskKeyMap = Object.fromEntries(plan.tasks.map((task) => [task.key, createId()]))
    const dagNodeByTaskKey = Object.fromEntries(plan.tasks.map((task) => [task.key, stableId("dag", `${featureId}:task:${task.key}`)]))
    const nodes: PlannedDagNode[] = []
    const edges: PlannedDagEdge[] = []

    nodes.push({
      id: featureNodeId,
      featureId,
      type: "feature",
      title: plan.title,
      body: plan.goal,
      status: featureStatus,
      metadataJson: JSON.stringify({
        source: "agent_plan",
        runtimeName: input.provenance.runtimeName,
        agentSessionId: input.provenance.agentSessionId ?? null
      }),
      createdAt,
      updatedAt: createdAt
    })

    plan.requirements.forEach((requirement, index) => {
      const nodeId = stableId("dag", `${featureId}:requirement:${index}`)
      nodes.push({
        id: nodeId,
        featureId,
        type: "requirement",
        title: `Requirement ${index + 1}`,
        body: requirement,
        status: "approved",
        metadataJson: JSON.stringify({ order: index + 1 }),
        createdAt,
        updatedAt: createdAt
      })
      edges.push({
        id: stableId("edge", `${featureId}:${featureNodeId}:${nodeId}:contains`),
        featureId,
        fromNodeId: featureNodeId,
        toNodeId: nodeId,
        edgeType: "contains"
      })
    })

    plan.tasks.forEach((task, index) => {
      const taskId = taskKeyMap[task.key]!
      const nodeId = dagNodeByTaskKey[task.key]!
      const dependencyTaskIds = task.dependsOn.map((key) => taskKeyMap[key]!)
      nodes.push({
        id: nodeId,
        featureId,
        type: "task",
        title: task.title,
        body: task.summary,
        status: dependencyTaskIds.length === 0 ? "ready" : "draft",
        metadataJson: JSON.stringify({
          order: index + 1,
          agentTaskKey: task.key,
          dependsOnTaskIds: dependencyTaskIds,
          scopeSummary: scopeSummary(task),
          acceptance: task.acceptance
        }),
        createdAt,
        updatedAt: createdAt
      })
      edges.push({
        id: stableId("edge", `${featureId}:${featureNodeId}:${nodeId}:contains`),
        featureId,
        fromNodeId: featureNodeId,
        toNodeId: nodeId,
        edgeType: "contains"
      })
      for (const dependencyKey of task.dependsOn) {
        const dependencyNodeId = dagNodeByTaskKey[dependencyKey]!
        edges.push({
          id: stableId("edge", `${featureId}:${dependencyNodeId}:${nodeId}:depends_on`),
          featureId,
          fromNodeId: dependencyNodeId,
          toNodeId: nodeId,
          edgeType: "depends_on"
        })
      }
      task.acceptance.forEach((criterion, acceptanceIndex) => {
        const acceptanceNodeId = stableId("dag", `${featureId}:task:${task.key}:acceptance:${acceptanceIndex}`)
        nodes.push({
          id: acceptanceNodeId,
          featureId,
          type: "acceptance",
          title: `${task.title} acceptance ${acceptanceIndex + 1}`,
          body: criterion,
          status: "approved",
          metadataJson: JSON.stringify({ taskKey: task.key, order: acceptanceIndex + 1 }),
          createdAt,
          updatedAt: createdAt
        })
        edges.push({
          id: stableId("edge", `${featureId}:${nodeId}:${acceptanceNodeId}:satisfies`),
          featureId,
          fromNodeId: nodeId,
          toNodeId: acceptanceNodeId,
          edgeType: "satisfies"
        })
      })
    })

    validatePlanningDag(nodes, edges)

    this.db
      .insert(featuresTable)
      .values({
        id: featureId,
        title: plan.title,
        description: `Imported from agent plan: ${plan.goal}`,
        status: featureStatus,
        createdAt,
        updatedAt: createdAt
      })
      .run()
    this.db.insert(dagNodesTable).values(nodes).run()
    this.db.insert(dagEdgesTable).values(edges).run()
    this.db
      .insert(tasksTable)
      .values(
        plan.tasks.map((task) => {
          const taskId = taskKeyMap[task.key]!
          const intent = buildIntent(plan, task)
          return {
            id: taskId,
            featureId,
            dagNodeId: dagNodeByTaskKey[task.key]!,
            status: task.dependsOn.length === 0 ? "ready" : "draft",
            intentIrJson: JSON.stringify(intent),
            policyJson: JSON.stringify(buildPolicy(taskId, intent)),
            createdAt,
            updatedAt: createdAt
          }
        })
      )
      .run()

    return {
      status: "planned",
      goal: plan.goal,
      featureId,
      title: plan.title,
      featureStatus,
      taskCount: plan.tasks.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      taskKeyMap,
      tasks: plan.tasks.map((task) => ({
        key: task.key,
        id: taskKeyMap[task.key]!,
        title: task.title,
        status: task.dependsOn.length === 0 ? "ready" : "draft",
        dependsOnTaskIds: task.dependsOn.map((key) => taskKeyMap[key]!),
        allowedFiles: task.allowedFiles,
        acceptance: task.acceptance
      }))
    }
  }

  private resolveFeature(featureId?: string): FeatureRow {
    const feature = featureId
      ? this.db.select().from(featuresTable).where(eq(featuresTable.id, featureId)).get()
      : this.db.select().from(featuresTable).orderBy(desc(featuresTable.createdAt)).limit(1).get()

    if (!feature) {
      throw new XieZhiError("CLI_USAGE_ERROR", "No agent plan found.", {
        hint: "Run `xiezhi agent plan \"...\" --runtime opencode` first."
      })
    }

    return feature
  }

  getPlanView(featureId?: string): PlanView {
    const feature = this.resolveFeature(featureId)
    const nodes = this.db
      .select()
      .from(dagNodesTable)
      .where(eq(dagNodesTable.featureId, feature.id))
      .all()
      .map((node) => plannedDagNodeSchema.parse(node))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    const edges = this.db
      .select()
      .from(dagEdgesTable)
      .where(eq(dagEdgesTable.featureId, feature.id))
      .all()
      .map((edge) => plannedDagEdgeSchema.parse(edge))
    const taskRows = this.db.select().from(tasksTable).where(eq(tasksTable.featureId, feature.id)).all()
    const taskIds = taskRows.map((taskRow) => taskRow.id)
    const patchRows = taskIds.length === 0 ? [] : this.db.select().from(patchesTable).all().filter((patch) => taskIds.includes(patch.taskId))
    const nodeMap = new Map(nodes.map((node) => [node.id, node]))
    const patchesByTaskId = new Map<string, typeof patchRows>()

    for (const patch of patchRows) {
      const values = patchesByTaskId.get(patch.taskId) ?? []
      values.push(patch)
      patchesByTaskId.set(patch.taskId, values)
    }

    const tasks = taskRows
      .map((taskRow) => {
        const node = nodeMap.get(taskRow.dagNodeId)
        const metadata = taskMetadataSchema.parse(
          safeJsonParse(node?.metadataJson ?? null, {
            order: 999,
            dependsOnTaskIds: [],
            scopeSummary: "unknown scope",
            acceptance: []
          })
        )
        const intent = safeJsonParse<IntentIr | null>(taskRow.intentIrJson, null)
        const linkedPatches = (patchesByTaskId.get(taskRow.id) ?? []).sort((left, right) => {
          return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
        })
        const latestPatch = linkedPatches[0] ?? null

        return {
          id: taskRow.id,
          dagNodeId: taskRow.dagNodeId,
          title: node?.title ?? taskRow.id,
          body: node?.body ?? null,
          status: taskRow.status as PlannedTask["status"],
          dependsOnTaskIds: metadata.dependsOnTaskIds,
          allowedFiles: intent?.allowedFiles ?? [],
          relatedSymbols: normalizeRelatedSymbols(intent?.relatedSymbols ?? []),
          acceptance: intent?.acceptance ?? metadata.acceptance,
          recommendedCommands: intent?.recommendedCommands ?? [],
          scopeSummary: metadata.scopeSummary,
          patchCount: linkedPatches.length,
          latestPatch: latestPatch
            ? {
                id: latestPatch.id,
                status: latestPatch.status,
                runtimeName: latestPatch.runtimeName,
                runtimeMode: latestPatch.runtimeMode,
                changedFiles: safeJsonParse<string[]>(latestPatch.changedFilesJson, []),
                updatedAt: latestPatch.updatedAt
              }
            : null,
          order: metadata.order
        }
      })
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title))
      .map(({ order: _order, ...task }) => task)

    return { feature, nodes, edges, tasks }
  }
}

export function importAgentPlan(cwd: string, plan: unknown, provenance: ImportAgentPlanProvenance) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new PlanningService(drizzle(sqlite, { schema }))
    return service.importAgentPlan({ plan, provenance })
  } finally {
    sqlite.close()
  }
}

export function getPlanView(cwd: string, featureId?: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new PlanningService(drizzle(sqlite, { schema }))
    return service.getPlanView(featureId)
  } finally {
    sqlite.close()
  }
}
