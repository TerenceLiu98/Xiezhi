import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { ReviewPatchResult } from "../verification/types.js"

export type ReviewArtifactFormat = "json" | "markdown"

export function renderReviewArtifact(result: ReviewPatchResult, format: ReviewArtifactFormat) {
  if (format === "json") {
    return JSON.stringify(result, null, 2)
  }

  return [
    `# XieZhi Review`,
    ``,
    `- Patch: \`${result.patchId}\``,
    `- Task: \`${result.taskId}\``,
    `- Runtime: \`${result.runtimeName}\``,
    `- Goal: ${result.goal}`,
    `- Summary: ${result.summary}`,
    ``,
    `## Changed Files`,
    ...(result.changedFiles.length > 0 ? result.changedFiles.map((file) => `- ${file}`) : ["- none"]),
    ``,
    `## Checks`,
    ...(result.checks.length > 0
      ? result.checks.map((check) => `- ${check.type}: ${check.status} - ${check.summary}`)
      : ["- none"]),
    ``,
    `## Warnings`,
    ...(result.warnings.length > 0 ? result.warnings.map((warning) => `- ${warning.type}: ${warning.message}`) : ["- none"]),
    ``,
    `## Blocking Violations`,
    ...(result.blockingViolations.length > 0
      ? result.blockingViolations.map((violation) => `- ${violation.type}: ${violation.message}`)
      : ["- none"]),
    ``,
    `## Next Actions`,
    ...(result.nextActions.length > 0 ? result.nextActions.map((action) => `- ${action}`) : ["- none"]),
    ``
  ].join("\n")
}

export async function writeReviewArtifact(outputPath: string, contents: string) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, contents, "utf8")
}
