import type { RuntimeName } from "../runtime/shared/index.js"
import { getPlanView } from "../services/planning-service.js"
import { acceptPatch, discardPatch, promotePatch, retryPatch, runTask } from "../services/task-run-service.js"
import { showTask } from "../services/task-view-service.js"

export async function runTaskListCommand(cwd: string, featureId?: string) {
  const view = getPlanView(cwd, featureId)

  return {
    status: "loaded" as const,
    featureId: view.feature.id,
    featureTitle: view.feature.title,
    tasks: view.tasks
  }
}

export async function runTaskRunCommand(cwd: string, taskId: string, runtime: RuntimeName) {
  // Low-level compatibility path. Product docs should prefer `xiezhi agent run`.
  return runTask(cwd, taskId, runtime)
}

export async function runTaskShowCommand(cwd: string, taskId: string) {
  return showTask(cwd, taskId)
}

export async function runTaskDiscardCommand(cwd: string, patchId: string) {
  return discardPatch(cwd, patchId)
}

export async function runTaskRetryCommand(cwd: string, patchId: string, runtime?: RuntimeName) {
  return retryPatch(cwd, patchId, runtime)
}

export async function runPatchAcceptCommand(cwd: string, patchId: string) {
  return acceptPatch(cwd, patchId)
}

export async function runPatchPromoteCommand(cwd: string, patchId: string) {
  return promotePatch(cwd, patchId)
}
