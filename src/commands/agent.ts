import type { RuntimeName } from "../runtime/shared/index.js"
import { runAgentBuild, runAgentFeedback, runAgentPlan, runAgentReadyTasks, runAgentTask, type AgentDecisionResolver } from "../services/agent-service.js"
import { getReadyQueue, showAgentSession } from "../services/agent-observability-service.js"

export async function runAgentPlanCommand(cwd: string, goal: string, runtime: RuntimeName, model?: string | null) {
  return runAgentPlan(cwd, goal, runtime, model)
}

export async function runAgentTaskCommand(cwd: string, taskId: string, runtime: RuntimeName, model?: string | null) {
  return runAgentTask(cwd, taskId, runtime, model)
}

export function runAgentReadyCommand(cwd: string, featureId?: string) {
  return getReadyQueue(cwd, featureId)
}

export function runAgentSessionShowCommand(cwd: string, sessionId?: string) {
  return showAgentSession(cwd, sessionId)
}

export async function runAgentRunReadyCommand(
  cwd: string,
  input: {
    featureId?: string
    runtime: RuntimeName
    parallel: number
    auto: boolean
    decisionRuntime: RuntimeName
    model?: string | null
    decisionModel?: string | null
  }
) {
  return runAgentReadyTasks(cwd, input)
}

export async function runAgentFeedbackCommand(cwd: string, feedback: string, runtime: RuntimeName, featureId?: string, model?: string | null) {
  return runAgentFeedback(cwd, feedback, runtime, featureId, model)
}

export async function runAgentBuildCommand(
  cwd: string,
  input: {
    goal: string
    runtime: RuntimeName
    parallel: number
    decisionRuntime: RuntimeName
    maxWaves: number
    assumeDefaults: boolean
    dryRunPlan: boolean
    strictPlanFirst?: boolean
    model?: string | null
    decisionModel?: string | null
    decisionResolver?: AgentDecisionResolver
  }
) {
  return runAgentBuild(cwd, input)
}
