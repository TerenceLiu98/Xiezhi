import { reviewPatch } from "../services/verification-service.js"

export async function runReviewCommand(cwd: string, patchId: string) {
  return reviewPatch(cwd, patchId)
}
