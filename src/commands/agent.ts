import type { RuntimeName } from "../runtime/shared/index.js"
import { runAgentPlan, runAgentTask } from "../services/agent-service.js"

export async function runAgentPlanCommand(cwd: string, goal: string, runtime: RuntimeName) {
  return runAgentPlan(cwd, goal, runtime)
}

export async function runAgentTaskCommand(cwd: string, taskId: string, runtime: RuntimeName) {
  return runAgentTask(cwd, taskId, runtime)
}
