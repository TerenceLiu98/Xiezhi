import { readFile } from "node:fs/promises"
import path from "node:path"

import { desc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { XieZhiError } from "../core/errors.js"
import { createId, stableId } from "../core/ids.js"
import { nowIso } from "../core/time.js"
import { assertDatabaseInitialized, openDatabaseConnection, type XieZhiDatabase } from "../db/client.js"
import * as schema from "../db/schema.js"
import { codeEdgesTable, codeNodesTable, dagEdgesTable, dagNodesTable, featuresTable, tasksTable } from "../db/schema.js"
import type { ExecutionPolicy } from "../runtime/shared/contracts.js"
import {
  type FeatureStatus,
  type InferredScope,
  type IntentIr,
  type PlanView,
  type PlannedDagEdge,
  type PlannedDagNode,
  type PlannedTask,
  type ScopeCandidate,
  plannedDagEdgeSchema,
  plannedDagNodeSchema,
  taskMetadataSchema
} from "../planning/types.js"
import { validatePlanningDag } from "../planning/validation.js"
import { RepositoryMetadataService } from "./repository-metadata-service.js"

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "build",
  "for",
  "from",
  "into",
  "make",
  "new",
  "that",
  "the",
  "then",
  "this",
  "with"
])

type CodeNodeRow = typeof codeNodesTable.$inferSelect
type FeatureRow = typeof featuresTable.$inferSelect

export type CreatePlanResult = {
  status: "planned"
  request: string
  featureId: string
  title: string
  featureStatus: FeatureStatus
  taskCount: number
  nodeCount: number
  edgeCount: number
  tasks: Array<{
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

function normalizeRelatedSymbols(symbols: string[]) {
  return unique(
    symbols.filter((symbol) => {
      if (!symbol) {
        return false
      }

      if (symbol.includes("/") || symbol.includes("\\")) {
        return false
      }

      if (symbol.endsWith(".ts") || symbol.endsWith(".tsx") || symbol.endsWith(".js") || symbol.endsWith(".jsx")) {
        return false
      }

      return true
    })
  )
}

function sentenceCase(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (!trimmed) {
    return "Untitled feature"
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function normalizeRequest(request: string) {
  const normalized = request.trim().replace(/\s+/g, " ")

  if (!normalized) {
    throw new XieZhiError("CLI_USAGE_ERROR", "Plan request cannot be empty.", {
      hint: "Pass a short natural language request such as `xz plan \"add team invitation\"`."
    })
  }

  const title = sentenceCase(normalized.replace(/[.?!]+$/, ""))
  const clauses = normalized
    .split(/\b(?:and|then)\b|,|;/i)
    .map((part) => sentenceCase(part.replace(/[.?!]+$/g, "")))
    .filter(Boolean)

  const requirements = unique((clauses.length > 0 ? clauses : [title]).slice(0, 3))
  const keywords = unique(
    normalized
      .toLowerCase()
      .split(/[^a-z0-9_]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  )

  return { title, requirements, keywords }
}

async function loadPackageScripts(repoRoot: string) {
  try {
    const packageJson = await readFile(path.join(repoRoot, "package.json"), "utf8")
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, string> }
    return parsed.scripts ?? {}
  } catch {
    return {}
  }
}

function renderPackageCommand(packageManager: string, scriptName: string) {
  if (packageManager === "npm") {
    return scriptName === "test" ? "npm test" : `npm run ${scriptName}`
  }
  if (packageManager === "yarn") {
    return `yarn ${scriptName}`
  }
  return `${packageManager} ${scriptName}`
}

function buildRecommendedCommands(packageManager: string, scriptNames: string[]) {
  return scriptNames.map((scriptName) => renderPackageCommand(packageManager, scriptName))
}

function scoreCodeNode(node: CodeNodeRow, keywords: string[]) {
  const pathValue = node.path.toLowerCase()
  const symbolValue = node.symbol?.toLowerCase() ?? ""
  let score = 0
  const matchedBy: string[] = []

  for (const keyword of keywords) {
    if (symbolValue.includes(keyword)) {
      score += 5
      matchedBy.push(`symbol:${keyword}`)
      continue
    }
    if (pathValue.includes(keyword)) {
      score += node.kind === "test" ? 2 : 3
      matchedBy.push(`path:${keyword}`)
    }
  }

  if (node.kind === "route" && keywords.some((keyword) => pathValue.includes(keyword))) {
    score += 2
  }

  return { score, matchedBy: unique(matchedBy) }
}

function buildScopeFallback(nodes: CodeNodeRow[]): InferredScope {
  const codeFiles = unique(
    nodes
      .filter((node) => node.kind === "file" && !node.path.includes(".test."))
      .map((node) => node.path)
      .slice(0, 3)
  )
  const testFiles = unique(
    nodes
      .filter((node) => node.kind === "test" || node.path.includes(".test."))
      .map((node) => node.path)
      .slice(0, 2)
  )

  return {
    codeFiles: codeFiles.length > 0 ? codeFiles : unique(nodes.filter((node) => node.kind === "file").map((node) => node.path).slice(0, 3)),
    testFiles,
    relatedSymbols: unique(nodes.map((node) => node.symbol).filter((value): value is string => Boolean(value)).slice(0, 5)),
    candidates: [],
    rationale: ["No strong keyword matches were found, so XieZhi fell back to the first indexed source and test files."]
  }
}

function enrichWithNeighborPaths(
  nodes: CodeNodeRow[],
  edges: Array<typeof codeEdgesTable.$inferSelect>,
  candidatePaths: string[]
) {
  if (candidatePaths.length === 0) {
    return candidatePaths
  }

  const nodeIdsByPath = new Map<string, string[]>()
  const pathByNodeId = new Map<string, string>()

  for (const node of nodes) {
    const values = nodeIdsByPath.get(node.path) ?? []
    values.push(node.id)
    nodeIdsByPath.set(node.path, values)
    pathByNodeId.set(node.id, node.path)
  }

  const seedNodeIds = new Set(candidatePaths.flatMap((candidatePath) => nodeIdsByPath.get(candidatePath) ?? []))
  const neighborPaths = new Set<string>()

  for (const edge of edges) {
    if (!seedNodeIds.has(edge.fromCodeNodeId) && !seedNodeIds.has(edge.toCodeNodeId)) {
      continue
    }

    const neighborPath = pathByNodeId.get(seedNodeIds.has(edge.fromCodeNodeId) ? edge.toCodeNodeId : edge.fromCodeNodeId)
    if (neighborPath && !candidatePaths.includes(neighborPath)) {
      neighborPaths.add(neighborPath)
    }
  }

  return unique([...candidatePaths, ...[...neighborPaths].slice(0, 2)])
}

function buildAcceptance(title: string, requirements: string[]) {
  const normalizedTitle = title.toLowerCase()
  const acceptance = requirements.map((requirement) => `${requirement} is reflected in the resulting behavior.`)
  acceptance.push(`Changes for ${normalizedTitle} stay inside the planned file scope unless the user explicitly expands it.`)
  acceptance.push(`Relevant verification coverage is updated for ${normalizedTitle}.`)
  return unique(acceptance)
}

function summarizeScope(codeFiles: string[], testFiles: string[]) {
  const segments = [`${codeFiles.length} code file${codeFiles.length === 1 ? "" : "s"}`]
  if (testFiles.length > 0) {
    segments.push(`${testFiles.length} test file${testFiles.length === 1 ? "" : "s"}`)
  }
  return segments.join(", ")
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

export class PlanningService {
  constructor(private readonly db: XieZhiDatabase) {}

  private async inferScope(repoId: string, keywords: string[]): Promise<InferredScope> {
    const nodes = this.db.select().from(codeNodesTable).where(eq(codeNodesTable.repoId, repoId)).all()

    if (nodes.length === 0) {
      throw new XieZhiError("CLI_USAGE_ERROR", "No code index found for this repository.", {
        hint: "Run `xz index --full` before planning so XieZhi can infer scope."
      })
    }

    if (keywords.length === 0) {
      return buildScopeFallback(nodes)
    }

    const pathCandidates = new Map<string, ScopeCandidate>()

    for (const node of nodes) {
      const { score, matchedBy } = scoreCodeNode(node, keywords)
      if (score <= 0) {
        continue
      }

      const kind = node.kind === "test" || node.path.includes(".test.") ? "test" : "code"
      const existing = pathCandidates.get(node.path)

      if (!existing) {
        pathCandidates.set(node.path, {
          path: node.path,
          score,
          kind,
          matchedBy,
          symbols: node.symbol ? [node.symbol] : []
        })
        continue
      }

      existing.score += score
      existing.matchedBy = unique([...existing.matchedBy, ...matchedBy])
      existing.symbols = unique(node.symbol ? [...existing.symbols, node.symbol] : existing.symbols)
    }

    const candidates = [...pathCandidates.values()].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.path.localeCompare(right.path)
    })

    if (candidates.length === 0) {
      return buildScopeFallback(nodes)
    }

    const edges = this.db.select().from(codeEdgesTable).where(eq(codeEdgesTable.repoId, repoId)).all()
    const codeFiles = enrichWithNeighborPaths(
      nodes,
      edges,
      candidates
        .filter((candidate) => candidate.kind === "code")
        .map((candidate) => candidate.path)
        .slice(0, 3)
    )
      .filter((candidatePath) => !candidatePath.includes(".test."))
      .slice(0, 4)

    const testFiles = candidates
      .filter((candidate) => candidate.kind === "test")
      .map((candidate) => candidate.path)
      .slice(0, 2)

  const relatedSymbols = normalizeRelatedSymbols(candidates.flatMap((candidate) => candidate.symbols)).slice(0, 8)

    return {
      codeFiles: codeFiles.length > 0 ? codeFiles : buildScopeFallback(nodes).codeFiles,
      testFiles,
      relatedSymbols,
      candidates: candidates.slice(0, 6),
      rationale: [
        `Matched plan keywords against ${candidates.length} indexed path candidate${candidates.length === 1 ? "" : "s"}.`,
        `Selected ${codeFiles.length} likely implementation file${codeFiles.length === 1 ? "" : "s"} and ${testFiles.length} likely test file${testFiles.length === 1 ? "" : "s"}.`
      ]
    }
  }

  private buildTasks(input: {
    featureId: string
    title: string
    requirements: string[]
    scope: InferredScope
    packageManager: string
    packageScripts: Record<string, string>
  }): PlannedTask[] {
    const defaultCodeFiles = input.scope.codeFiles.slice(0, 3)
    const verificationFiles = unique([
      ...input.scope.testFiles.slice(0, 2),
      ...input.scope.codeFiles.slice(0, Math.min(2, input.scope.codeFiles.length))
    ])
    const preferredScripts = ["typecheck", "test", "lint", "build"].filter((scriptName) => {
      return Boolean(input.packageScripts[scriptName])
    })
    const implementationCommands = buildRecommendedCommands(input.packageManager, preferredScripts.slice(0, 3))
    const verificationCommands = buildRecommendedCommands(
      input.packageManager,
      preferredScripts.filter((scriptName) => scriptName === "test" || scriptName === "typecheck" || scriptName === "lint").slice(0, 3)
    )
    const reviewTaskId = createId()
    const implementTaskId = createId()
    const verifyTaskId = createId()

    return [
      {
        taskId: reviewTaskId,
        dagNodeId: stableId("dag", `${input.featureId}:task:review`),
        title: `Confirm touchpoints for ${input.title}`,
        body: "Inspect the indexed code graph and confirm that the inferred file scope is the smallest safe edit set.",
        status: "ready",
        dependsOnTaskIds: [],
        allowedFiles: unique([...defaultCodeFiles, ...input.scope.testFiles.slice(0, 1)]),
        forbiddenFiles: [".xiezhi/"],
        acceptance: [
          `The primary implementation entrypoints for ${input.title.toLowerCase()} are confirmed.`,
          "The task keeps a narrow write scope before any runtime is invoked."
        ],
        recommendedCommands: implementationCommands,
        relatedSymbols: input.scope.relatedSymbols,
        scopeSummary: summarizeScope(defaultCodeFiles, input.scope.testFiles.slice(0, 1)),
        rationale: input.scope.rationale
      },
      {
        taskId: implementTaskId,
        dagNodeId: stableId("dag", `${input.featureId}:task:implement`),
        title: `Implement ${input.title}`,
        body: "Make the core code changes needed to satisfy the planned requirements and preserve semantic consistency.",
        status: "draft",
        dependsOnTaskIds: [reviewTaskId],
        allowedFiles: defaultCodeFiles,
        forbiddenFiles: [".xiezhi/"],
        acceptance: buildAcceptance(input.title, input.requirements).slice(0, 3),
        recommendedCommands: implementationCommands,
        relatedSymbols: input.scope.relatedSymbols,
        scopeSummary: summarizeScope(defaultCodeFiles, []),
        rationale: input.scope.rationale
      },
      {
        taskId: verifyTaskId,
        dagNodeId: stableId("dag", `${input.featureId}:task:verify`),
        title: `Verify ${input.title}`,
        body: "Add or update tests and run the recommended verification commands for the touched behavior.",
        status: "draft",
        dependsOnTaskIds: [implementTaskId],
        allowedFiles: verificationFiles.length > 0 ? verificationFiles : defaultCodeFiles,
        forbiddenFiles: [".xiezhi/"],
        acceptance: [
          `Coverage for ${input.title.toLowerCase()} is updated where relevant.`,
          "Recommended verification commands pass for the touched flow."
        ],
        recommendedCommands: verificationCommands.length > 0 ? verificationCommands : implementationCommands,
        relatedSymbols: input.scope.relatedSymbols,
        scopeSummary: summarizeScope(defaultCodeFiles.slice(0, 2), input.scope.testFiles.slice(0, 2)),
        rationale: input.scope.rationale
      }
    ]
  }

  private buildDag(input: {
    featureId: string
    title: string
    requirements: string[]
    featureStatus: FeatureStatus
    tasks: PlannedTask[]
    scope: InferredScope
    createdAt: string
  }) {
    const nodes: PlannedDagNode[] = []
    const edges: PlannedDagEdge[] = []
    const featureNodeId = stableId("dag", `${input.featureId}:feature`)

    nodes.push({
      id: featureNodeId,
      featureId: input.featureId,
      type: "feature",
      title: input.title,
      body: `Planned feature for: ${input.title}`,
      status: input.featureStatus === "draft" ? "draft" : "approved",
      metadataJson: JSON.stringify({
        requirements: input.requirements,
        scopeSummary: summarizeScope(input.scope.codeFiles, input.scope.testFiles)
      }),
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    })

    const requirementNodeIds = input.requirements.map((requirement, index) => {
      const nodeId = stableId("dag", `${input.featureId}:requirement:${index}`)
      nodes.push({
        id: nodeId,
        featureId: input.featureId,
        type: "requirement",
        title: `Requirement ${index + 1}`,
        body: requirement,
        status: "approved",
        metadataJson: JSON.stringify({ order: index + 1 }),
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      })
      edges.push({
        id: stableId("edge", `${input.featureId}:${featureNodeId}:${nodeId}:contains`),
        featureId: input.featureId,
        fromNodeId: featureNodeId,
        toNodeId: nodeId,
        edgeType: "contains"
      })
      return nodeId
    })

    const acceptance = buildAcceptance(input.title, input.requirements)
    const acceptanceNodeIds = acceptance.slice(0, 3).map((criterion, index) => {
      const nodeId = stableId("dag", `${input.featureId}:acceptance:${index}`)
      nodes.push({
        id: nodeId,
        featureId: input.featureId,
        type: "acceptance",
        title: `Acceptance ${index + 1}`,
        body: criterion,
        status: "approved",
        metadataJson: JSON.stringify({ order: index + 1 }),
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      })
      edges.push({
        id: stableId("edge", `${input.featureId}:${featureNodeId}:${nodeId}:contains`),
        featureId: input.featureId,
        fromNodeId: featureNodeId,
        toNodeId: nodeId,
        edgeType: "contains"
      })
      return nodeId
    })

    const testNodeId = stableId("dag", `${input.featureId}:test`)
    nodes.push({
      id: testNodeId,
      featureId: input.featureId,
      type: "test",
      title: "Verification Surface",
      body:
        input.scope.testFiles.length > 0
          ? `Prefer updating: ${input.scope.testFiles.join(", ")}`
          : "No dedicated tests were inferred, so verification may start near the touched implementation files.",
      status: "approved",
      metadataJson: JSON.stringify({ testFiles: input.scope.testFiles }),
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    })
    edges.push({
      id: stableId("edge", `${input.featureId}:${featureNodeId}:${testNodeId}:contains`),
      featureId: input.featureId,
      fromNodeId: featureNodeId,
      toNodeId: testNodeId,
      edgeType: "contains"
    })

    let taskOrder = 1
    for (const task of input.tasks) {
      nodes.push({
        id: task.dagNodeId,
        featureId: input.featureId,
        type: "task",
        title: task.title,
        body: task.body,
        status: task.status,
        metadataJson: JSON.stringify({
          order: taskOrder,
          dependsOnTaskIds: task.dependsOnTaskIds,
          scopeSummary: task.scopeSummary,
          acceptance: task.acceptance
        }),
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      })
      taskOrder += 1

      edges.push({
        id: stableId("edge", `${input.featureId}:${featureNodeId}:${task.dagNodeId}:contains`),
        featureId: input.featureId,
        fromNodeId: featureNodeId,
        toNodeId: task.dagNodeId,
        edgeType: "contains"
      })

      for (const requirementNodeId of requirementNodeIds) {
        edges.push({
          id: stableId("edge", `${input.featureId}:${requirementNodeId}:${task.dagNodeId}:informs`),
          featureId: input.featureId,
          fromNodeId: requirementNodeId,
          toNodeId: task.dagNodeId,
          edgeType: "informs"
        })
      }

      for (const acceptanceNodeId of acceptanceNodeIds) {
        edges.push({
          id: stableId("edge", `${input.featureId}:${task.dagNodeId}:${acceptanceNodeId}:satisfies`),
          featureId: input.featureId,
          fromNodeId: task.dagNodeId,
          toNodeId: acceptanceNodeId,
          edgeType: "satisfies"
        })
      }
    }

    for (const task of input.tasks) {
      for (const dependencyTaskId of task.dependsOnTaskIds) {
        const dependencyNode = input.tasks.find((candidate) => candidate.taskId === dependencyTaskId)
        if (!dependencyNode) {
          continue
        }

        edges.push({
          id: stableId("edge", `${input.featureId}:${dependencyNode.dagNodeId}:${task.dagNodeId}:depends_on`),
          featureId: input.featureId,
          fromNodeId: dependencyNode.dagNodeId,
          toNodeId: task.dagNodeId,
          edgeType: "depends_on"
        })
      }
    }

    const verificationTask = input.tasks[input.tasks.length - 1]
    if (verificationTask) {
      edges.push({
        id: stableId("edge", `${input.featureId}:${verificationTask.dagNodeId}:${testNodeId}:validates`),
        featureId: input.featureId,
        fromNodeId: verificationTask.dagNodeId,
        toNodeId: testNodeId,
        edgeType: "validates"
      })
    }

    validatePlanningDag(nodes, edges)
    return { nodes, edges }
  }

  async createPlan(cwd: string, request: string): Promise<CreatePlanResult> {
    const repositoryService = new RepositoryMetadataService(this.db)
    const repository = await repositoryService.refreshForCwd(cwd)
    const normalized = normalizeRequest(request)
    const scope = await this.inferScope(repository.id, normalized.keywords)
    const packageScripts = await loadPackageScripts(repository.rootPath)
    const featureId = createId()
    const createdAt = nowIso()
    const featureStatus: FeatureStatus = "draft"
    const featureDescription = `Generated from request: ${sentenceCase(request)}`
    const tasks = this.buildTasks({
      featureId,
      title: normalized.title,
      requirements: normalized.requirements,
      scope,
      packageManager: repository.packageManager,
      packageScripts
    })
    const { nodes, edges } = this.buildDag({
      featureId,
      title: normalized.title,
      requirements: normalized.requirements,
      featureStatus,
      tasks,
      scope,
      createdAt
    })

    this.db.transaction((tx) => {
      tx.insert(featuresTable)
        .values({
          id: featureId,
          title: normalized.title,
          description: featureDescription,
          status: featureStatus,
          createdAt,
          updatedAt: createdAt
        })
        .run()

      tx.insert(dagNodesTable).values(nodes).run()
      tx.insert(dagEdgesTable).values(edges).run()
      tx.insert(tasksTable)
        .values(
          tasks.map((task) => {
            const intentIr: IntentIr = {
              version: "v1",
              goal: task.title,
              summary: task.body,
              allowedFiles: task.allowedFiles,
              forbiddenFiles: task.forbiddenFiles,
              relatedSymbols: normalizeRelatedSymbols(task.relatedSymbols),
              acceptance: task.acceptance,
              recommendedCommands: task.recommendedCommands,
              rationale: task.rationale
            }
            const policy: ExecutionPolicy = {
              taskId: task.taskId,
              allowedFiles: task.allowedFiles,
              forbiddenFiles: task.forbiddenFiles,
              allowedWriteRoots: ["."],
              allowedTools: ["read", "edit", "bash"],
              envAllowlist: [],
              deniedCommands: ["git reset --hard", "git checkout --"]
            }

            return {
              id: task.taskId,
              featureId,
              dagNodeId: task.dagNodeId,
              status: task.status,
              intentIrJson: JSON.stringify(intentIr),
              policyJson: JSON.stringify(policy),
              createdAt,
              updatedAt: createdAt
            }
          })
        )
        .run()
    })

    return {
      status: "planned",
      request,
      featureId,
      title: normalized.title,
      featureStatus,
      taskCount: tasks.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      tasks: tasks.map((task) => ({
        id: task.taskId,
        title: task.title,
        status: task.status,
        dependsOnTaskIds: task.dependsOnTaskIds,
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
      throw new XieZhiError("CLI_USAGE_ERROR", "No planned feature found.", {
        hint: "Run `xz plan \"...\"` first, then inspect it with `xz dag show` or `xz task list`."
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
    const nodeMap = new Map(nodes.map((node) => [node.id, node]))

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
          order: metadata.order
        }
      })
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title))
      .map(({ order: _order, ...task }) => task)

    return {
      feature,
      nodes,
      edges,
      tasks
    }
  }

  listTasks(featureId?: string) {
    return this.getPlanView(featureId)
  }
}

export async function createPlan(cwd: string, request: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new PlanningService(drizzle(sqlite, { schema }))
    return await service.createPlan(cwd, request)
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
