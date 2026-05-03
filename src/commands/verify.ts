import { verifyPatch } from "../services/verification-service.js"

export async function runVerifyCommand(cwd: string, patchId: string) {
  return verifyPatch(cwd, patchId)
}
