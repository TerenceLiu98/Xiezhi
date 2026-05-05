import { z } from "zod"

export const featureStatusSchema = z.enum(["draft", "approved", "in_progress", "verified", "rejected", "completed"])
export type FeatureStatus = z.infer<typeof featureStatusSchema>

export const dagNodeTypeSchema = z.enum(["feature", "requirement", "task", "acceptance", "test"])
export type DagNodeType = z.infer<typeof dagNodeTypeSchema>

export const dagNodeStatusSchema = z.enum(["draft", "approved", "ready", "running", "patched", "verified", "promoted", "in_progress", "completed", "rejected", "failed"])
export type DagNodeStatus = z.infer<typeof dagNodeStatusSchema>

export const dagEdgeTypeSchema = z.enum(["contains", "informs", "depends_on", "satisfies", "validates"])
export type DagEdgeType = z.infer<typeof dagEdgeTypeSchema>

export const taskStatusSchema = z.enum(["draft", "ready", "running", "patched", "verified", "promoted", "rejected", "failed"])
export type TaskStatus = z.infer<typeof taskStatusSchema>

export const scopeCandidateSchema = z.object({
  path: z.string(),
  score: z.number(),
  kind: z.enum(["code", "test"]),
  matchedBy: z.array(z.string()),
  symbols: z.array(z.string())
})
export type ScopeCandidate = z.infer<typeof scopeCandidateSchema>

export const inferredScopeSchema = z.object({
  codeFiles: z.array(z.string()),
  testFiles: z.array(z.string()),
  relatedSymbols: z.array(z.string()),
  candidates: z.array(scopeCandidateSchema),
  rationale: z.array(z.string())
})
export type InferredScope = z.infer<typeof inferredScopeSchema>

export const intentIrV1Schema = z.object({
  version: z.literal("v1"),
  goal: z.string(),
  summary: z.string(),
  allowedFiles: z.array(z.string()),
  forbiddenFiles: z.array(z.string()),
  relatedSymbols: z.array(z.string()),
  acceptance: z.array(z.string()),
  recommendedCommands: z.array(z.string()),
  rationale: z.array(z.string())
})
export const intentIrV2Schema = intentIrV1Schema.extend({
  version: z.literal("v2"),
  allowedSymbols: z.array(z.string()).default([]),
  forbiddenSymbols: z.array(z.string()).default([]),
  expectedOutputs: z.array(z.string()).default([]),
  subagentRole: z.string().min(1).default("implementation"),
  parallelGroup: z.string().min(1).nullable().default(null),
  handoff: z.array(z.string()).default([])
})
export const intentIrSchema = z.union([intentIrV1Schema, intentIrV2Schema])
export type IntentIr = z.infer<typeof intentIrSchema>

export const agentPlanTaskSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  allowedFiles: z.array(z.string()).min(1),
  forbiddenFiles: z.array(z.string()).default([".xiezhi/"]),
  allowedSymbols: z.array(z.string()).default([]),
  forbiddenSymbols: z.array(z.string()).default([]),
  acceptance: z.array(z.string()).min(1),
  checks: z.array(z.string()).default([]),
  expectedOutputs: z.array(z.string()).default([]),
  subagentRole: z.string().min(1).default("implementation"),
  parallelGroup: z.string().min(1).nullable().default(null),
  handoff: z.array(z.string()).default([]),
  rationale: z.array(z.string()).default([])
})
export type AgentPlanTask = z.infer<typeof agentPlanTaskSchema>

export const agentPlanV1Schema = z.object({
  version: z.literal("v1"),
  goal: z.string().min(1),
  title: z.string().min(1),
  requirements: z.array(z.string()).min(1),
  tasks: z.array(agentPlanTaskSchema).min(1)
})
export type AgentPlanV1 = z.infer<typeof agentPlanV1Schema>

export function getIntentAllowedSymbols(intent: IntentIr | null) {
  if (!intent) {
    return []
  }
  if (intent.version === "v2") {
    return intent.allowedSymbols.length > 0 ? intent.allowedSymbols : intent.relatedSymbols
  }
  return intent.relatedSymbols
}

export function getIntentForbiddenSymbols(intent: IntentIr | null) {
  if (!intent || intent.version !== "v2") {
    return []
  }
  return intent.forbiddenSymbols
}

export function getIntentExpectedOutputs(intent: IntentIr | null) {
  if (!intent || intent.version !== "v2") {
    return []
  }
  return intent.expectedOutputs
}

export function getIntentSubagentRole(intent: IntentIr | null) {
  if (!intent || intent.version !== "v2") {
    return "implementation"
  }
  return intent.subagentRole
}

export function getIntentParallelGroup(intent: IntentIr | null) {
  if (!intent || intent.version !== "v2") {
    return null
  }
  return intent.parallelGroup
}

export function getIntentHandoff(intent: IntentIr | null) {
  if (!intent || intent.version !== "v2") {
    return []
  }
  return intent.handoff
}

export const plannedDagNodeSchema = z.object({
  id: z.string(),
  featureId: z.string(),
  type: dagNodeTypeSchema,
  title: z.string(),
  body: z.string().nullable(),
  status: dagNodeStatusSchema,
  metadataJson: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type PlannedDagNode = z.infer<typeof plannedDagNodeSchema>

export const plannedDagEdgeSchema = z.object({
  id: z.string(),
  featureId: z.string(),
  fromNodeId: z.string(),
  toNodeId: z.string(),
  edgeType: dagEdgeTypeSchema
})
export type PlannedDagEdge = z.infer<typeof plannedDagEdgeSchema>

export const taskMetadataSchema = z.object({
  order: z.number().int().positive(),
  dependsOnTaskIds: z.array(z.string()),
  scopeSummary: z.string(),
  acceptance: z.array(z.string()),
  subagentRole: z.string().min(1).default("implementation"),
  parallelGroup: z.string().min(1).nullable().default(null),
  handoff: z.array(z.string()).default([])
})
export type TaskMetadata = z.infer<typeof taskMetadataSchema>

export type PlannedTask = {
  taskId: string
  dagNodeId: string
  title: string
  body: string
  status: TaskStatus
  dependsOnTaskIds: string[]
  allowedFiles: string[]
  forbiddenFiles: string[]
  acceptance: string[]
  recommendedCommands: string[]
  relatedSymbols: string[]
  scopeSummary: string
  rationale: string[]
}

export type PlanView = {
  feature: {
    id: string
    title: string
    description: string | null
    status: string
    createdAt: string
    updatedAt: string
  }
  nodes: PlannedDagNode[]
  edges: PlannedDagEdge[]
  tasks: Array<{
    id: string
    dagNodeId: string
    title: string
    body: string | null
    status: TaskStatus
    dependsOnTaskIds: string[]
    allowedFiles: string[]
    relatedSymbols: string[]
    acceptance: string[]
    recommendedCommands: string[]
    scopeSummary: string
    patchCount: number
    latestPatch: {
      id: string
      status: string
      runtimeName: string
      runtimeMode: string
      changedFiles: string[]
      updatedAt: string
    } | null
  }>
}
