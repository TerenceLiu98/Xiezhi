import { XieZhiError } from "../core/errors.js"
import {
  dagEdgeTypeSchema,
  dagNodeTypeSchema,
  type DagEdgeType,
  type DagNodeType,
  type PlannedDagEdge,
  type PlannedDagNode
} from "./types.js"

const allowedEdges: Record<DagEdgeType, Array<{ from: DagNodeType; to: DagNodeType }>> = {
  contains: [
    { from: "feature", to: "requirement" },
    { from: "feature", to: "task" },
    { from: "feature", to: "acceptance" },
    { from: "feature", to: "test" }
  ],
  informs: [
    { from: "requirement", to: "task" },
    { from: "requirement", to: "acceptance" }
  ],
  depends_on: [{ from: "task", to: "task" }],
  satisfies: [{ from: "task", to: "acceptance" }],
  validates: [{ from: "task", to: "test" }]
}

function assertAcyclic(nodes: PlannedDagNode[], edges: PlannedDagEdge[]) {
  const adjacency = new Map<string, string[]>()
  const incomingCounts = new Map<string, number>()

  for (const node of nodes) {
    adjacency.set(node.id, [])
    incomingCounts.set(node.id, 0)
  }

  for (const edge of edges) {
    adjacency.get(edge.fromNodeId)?.push(edge.toNodeId)
    incomingCounts.set(edge.toNodeId, (incomingCounts.get(edge.toNodeId) ?? 0) + 1)
  }

  const queue = [...incomingCounts.entries()].filter(([, count]) => count === 0).map(([id]) => id)
  let visitedCount = 0

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) {
      break
    }

    visitedCount += 1

    for (const next of adjacency.get(current) ?? []) {
      const nextCount = (incomingCounts.get(next) ?? 0) - 1
      incomingCounts.set(next, nextCount)
      if (nextCount === 0) {
        queue.push(next)
      }
    }
  }

  if (visitedCount !== nodes.length) {
    throw new XieZhiError("CLI_USAGE_ERROR", "Generated planning DAG contains a cycle.", {
      hint: "Adjust the generated task dependencies so the plan remains acyclic."
    })
  }
}

export function validatePlanningDag(nodes: PlannedDagNode[], edges: PlannedDagEdge[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))

  for (const node of nodes) {
    dagNodeTypeSchema.parse(node.type)
  }

  for (const edge of edges) {
    dagEdgeTypeSchema.parse(edge.edgeType)

    const fromNode = nodeMap.get(edge.fromNodeId)
    const toNode = nodeMap.get(edge.toNodeId)

    if (!fromNode || !toNode) {
      throw new XieZhiError("CLI_USAGE_ERROR", "Generated planning DAG references a missing node.", {
        hint: "Ensure every edge points to a persisted node."
      })
    }

    if (fromNode.featureId !== toNode.featureId || fromNode.featureId !== edge.featureId) {
      throw new XieZhiError("CLI_USAGE_ERROR", "Generated planning DAG crosses feature boundaries.", {
        hint: "Keep nodes and edges scoped to a single feature."
      })
    }

    const isAllowed = allowedEdges[edge.edgeType].some((candidate) => {
      return candidate.from === fromNode.type && candidate.to === toNode.type
    })

    if (!isAllowed) {
      throw new XieZhiError(
        "CLI_USAGE_ERROR",
        `Invalid planning edge: ${fromNode.type} -${edge.edgeType}-> ${toNode.type}.`,
        {
          hint: "Use only supported planning relationships between node types."
        }
      )
    }
  }

  assertAcyclic(nodes, edges)
}
