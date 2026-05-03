import { createPlan } from "../services/planning-service.js"

export async function runPlanCommand(cwd: string, request: string) {
  return createPlan(cwd, request)
}
