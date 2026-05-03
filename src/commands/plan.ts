import { createBootstrapPlan, createPlan } from "../services/planning-service.js"

export async function runPlanCommand(cwd: string, request: string) {
  return createPlan(cwd, request)
}

export async function runBootstrapCommand(cwd: string, request: string) {
  return createBootstrapPlan(cwd, request)
}
