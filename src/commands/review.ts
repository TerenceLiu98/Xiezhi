import path from "node:path"

import { reviewPatch } from "../services/verification-service.js"
import {
  renderReviewArtifact,
  type ReviewArtifactFormat,
  writeReviewArtifact
} from "../services/review-artifact-service.js"

export async function runReviewCommand(
  cwd: string,
  patchId: string,
  options?: { format?: "text" | ReviewArtifactFormat; outputPath?: string }
) {
  const result = await reviewPatch(cwd, patchId)

  if (options?.format && options.format !== "text" && options.outputPath) {
    const contents = renderReviewArtifact(result, options.format)
    const resolvedOutputPath = path.resolve(cwd, options.outputPath)
    await writeReviewArtifact(resolvedOutputPath, contents)

    return {
      ...result,
      export: {
        format: options.format,
        outputPath: resolvedOutputPath
      }
    }
  }

  return result
}
