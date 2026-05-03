import { z } from "zod"

export const featureStatusSchema = z.enum(["draft", "approved", "in_progress", "verified", "rejected"])
export type FeatureStatus = z.infer<typeof featureStatusSchema>

export const dagNodeTypeSchema = z.enum(["feature", "requirement", "task", "acceptance", "test"])
export type DagNodeType = z.infer<typeof dagNodeTypeSchema>

export const dagNodeStatusSchema = z.enum(["draft", "approved", "ready", "running", "verified", "rejected"])
export type DagNodeStatus = z.infer<typeof dagNodeStatusSchema>

export const dagEdgeTypeSchema = z.enum(["contains", "informs", "depends_on", "satisfies", "validates"])
export type DagEdgeType = z.infer<typeof dagEdgeTypeSchema>

export const taskStatusSchema = z.enum(["draft", "ready", "running", "verified", "rejected"])
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

export const intentIrSchema = z.object({
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
export type IntentIr = z.infer<typeof intentIrSchema>

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
  acceptance: z.array(z.string())
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
  }>
}
