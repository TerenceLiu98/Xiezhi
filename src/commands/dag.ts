import { getPlanView } from "../services/planning-service.js"

function compareTitles(left: { title: string }, right: { title: string }) {
  return left.title.localeCompare(right.title)
}

function buildAsciiSection(title: string, entries: Array<{ label: string; details?: string[] }>, options: {
  prefix: string
  childIndent: string
}) {
  const lines = [`${options.prefix}${title}`]

  entries.forEach((entry, index) => {
    const isLastEntry = index === entries.length - 1
    const entryPrefix = `${options.childIndent}${isLastEntry ? "`- " : "|- "}`
    const detailIndent = `${options.childIndent}${isLastEntry ? "   " : "|  "}`

    lines.push(`${entryPrefix}${entry.label}`)

    const details = entry.details ?? []
    details.forEach((detail, detailIndex) => {
      const isLastDetail = detailIndex === details.length - 1
      lines.push(`${detailIndent}${isLastDetail ? "`- " : "|- "}${detail}`)
    })
  })

  return lines
}

export async function runDagShowCommand(cwd: string, featureId?: string) {
  const view = getPlanView(cwd, featureId)
  const nodeLabelById = new Map(view.nodes.map((node) => [node.id, node.title]))
  const taskTitleById = new Map(view.tasks.map((task) => [task.id, task.title]))
  const requirements = view.nodes.filter((node) => node.type === "requirement").sort(compareTitles)
  const acceptance = view.nodes.filter((node) => node.type === "acceptance").sort(compareTitles)
  const verification = view.nodes.filter((node) => node.type === "test").sort(compareTitles)

  const structure = [
    `${view.feature.title} [${view.feature.status}]`,
    ...buildAsciiSection(
      "Requirements",
      requirements.map((node) => ({
        label: node.body ?? node.title
      })),
      { prefix: "|- ", childIndent: "|  " }
    ),
    ...buildAsciiSection(
      "Tasks",
      view.tasks.map((task) => ({
        label: `[${task.status}] ${task.title}`,
        details: [
          `scope: ${task.scopeSummary}`,
          `files: ${task.allowedFiles.join(", ") || "n/a"}`,
          `functions: ${task.relatedSymbols.join(", ") || "none"}`,
          task.latestPatch
            ? `latest patch: ${task.latestPatch.id} (${task.latestPatch.status} via ${task.latestPatch.runtimeName})`
            : "latest patch: none"
        ]
      })),
      { prefix: "|- ", childIndent: "|  " }
    ),
    ...buildAsciiSection(
      "Acceptance",
      acceptance.map((node) => ({
        label: node.body ?? node.title
      })),
      { prefix: "|- ", childIndent: "|  " }
    ),
    ...buildAsciiSection(
      "Verification",
      verification.map((node) => ({
        label: node.body ?? node.title
      })),
      { prefix: "`- ", childIndent: "   " }
    )
  ]

  const dependencies = view.tasks
    .filter((task) => task.dependsOnTaskIds.length > 0)
    .map((task) => {
      const chain = task.dependsOnTaskIds
        .map((dependencyId) => taskTitleById.get(dependencyId) ?? dependencyId)
        .concat(task.title)
      return chain.join(" -> ")
    })

  const coverage = view.edges
    .filter((edge) => edge.edgeType === "satisfies" || edge.edgeType === "validates")
    .map((edge) => {
      const fromLabel = nodeLabelById.get(edge.fromNodeId) ?? edge.fromNodeId
      const toLabel = nodeLabelById.get(edge.toNodeId) ?? edge.toNodeId
      return `${fromLabel} -${edge.edgeType}-> ${toLabel}`
    })

  return {
    status: "loaded" as const,
    featureId: view.feature.id,
    featureTitle: view.feature.title,
    featureStatus: view.feature.status,
    nodeCount: view.nodes.length,
    edgeCount: view.edges.length,
    taskCount: view.tasks.length,
    structure,
    dependencies,
    coverage
  }
}
