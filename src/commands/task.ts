import type { RuntimeName } from "../runtime/shared/index.js"
import { getPlanView } from "../services/planning-service.js"
import { discardPatch, runTask } from "../services/task-run-service.js"

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
  return runTask(cwd, taskId, runtime)
}

export async function runTaskDiscardCommand(cwd: string, patchId: string) {
  return discardPatch(cwd, patchId)
}
