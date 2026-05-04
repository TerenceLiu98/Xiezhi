import { desc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { execa } from "execa"
import { z } from "zod"

import { XieZhiError } from "../core/errors.js"
import { createId } from "../core/ids.js"
import { nowIso } from "../core/time.js"
import { assertDatabaseInitialized, openDatabaseConnection, type XieZhiDatabase } from "../db/client.js"
import * as schema from "../db/schema.js"
import { agentEventsTable, agentRunsTable, agentSessionsTable, assignmentsTable, tasksTable } from "../db/schema.js"
import { compileExecutionPolicy } from "../execution/policy-compiler.js"
import {
  agentPlanV1Schema,
  getIntentAllowedSymbols,
  getIntentExpectedOutputs,
  getIntentForbiddenSymbols,
  type AgentPlanV1,
  type IntentIr
} from "../planning/types.js"
import type { ExecutionPolicy, RuntimeName } from "../runtime/shared/contracts.js"
import { detectRuntimeAvailability } from "../runtime/shared/capabilities.js"
import { importAgentPlan, type ImportAgentPlanResult } from "./planning-service.js"
import { TaskRunService, type TaskRunResult } from "./task-run-service.js"
import { getReadyQueue, scopesConflict } from "./agent-observability-service.js"
import { reviewPatch, verifyPatch } from "./verification-service.js"
import { promotePatch } from "./task-run-service.js"

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function parseJsonCandidate(source: string): unknown {
  const trimmed = source.trim()
  if (!trimmed) {
    throw new XieZhiError("CLI_USAGE_ERROR", "Agent returned no plan output.", {
      hint: "Ask the agent to output a single AgentPlan v1 JSON object."
    })
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    // Continue below; many agent CLIs emit JSON event lines with text content.
  }

  const textParts: string[] = []
  const collectText = (value: unknown) => {
    if (typeof value === "string") {
      textParts.push(value)
      return
    }
    if (!value || typeof value !== "object") {
      return
    }
    const record = value as Record<string, unknown>
    for (const key of ["text", "content", "message", "output"]) {
      if (typeof record[key] === "string") {
        textParts.push(record[key])
      }
    }
    if (record.part) {
      collectText(record.part)
    }
    if (record.message) {
      collectText(record.message)
    }
  }

  for (const line of trimmed.split("\n")) {
    try {
      collectText(JSON.parse(line) as unknown)
    } catch {
      textParts.push(line)
    }
  }

  const joined = textParts.join("\n").trim()
  const start = joined.indexOf("{")
  const end = joined.lastIndexOf("}")
  if (start >= 0 && end > start) {
    return JSON.parse(joined.slice(start, end + 1))
  }

  throw new XieZhiError("CLI_USAGE_ERROR", "Agent did not return parseable AgentPlan JSON.", {
    hint: "Regenerate the plan and output only strict JSON."
  })
}

function buildAgentPlanPrompt(goal: string) {
  return [
    "You are the planning agent for XieZhi.",
    "Return exactly one strict JSON object and no markdown.",
    "For short goals, make reasonable engineering assumptions and write them into requirements and task rationale.",
    "If a user decision is truly required, use xiezhi agent build instead; this command imports AgentPlan JSON only.",
    "The JSON must match AgentPlan v1:",
    "{",
    '  "version": "v1",',
    '  "goal": "string",',
    '  "title": "string",',
    '  "requirements": ["string"],',
    '  "tasks": [',
    "    {",
    '      "key": "stable-short-key",',
    '      "title": "string",',
    '      "summary": "string",',
    '      "dependsOn": ["other-task-key"],',
    '      "allowedFiles": ["repo-relative path"],',
    '      "forbiddenFiles": [".xiezhi/"],',
    '      "allowedSymbols": [],',
    '      "forbiddenSymbols": [],',
    '      "acceptance": ["string"],',
    '      "checks": ["package-manager command"],',
    '      "expectedOutputs": ["string"],',
    '      "rationale": ["string"]',
    "    }",
    "  ]",
    "}",
    "XieZhi will enforce allowedFiles and AST/symbol scope, so keep scopes explicit and bounded.",
    `Goal: ${goal}`
  ].join("\n")
}

function buildAgentBuildIntakePrompt(input: {
  goal: string
  resolvedDecisions?: Array<{ decisionPoint: AgentDecisionPointV1; selectedOptionId: string }>
  evidenceSummary?: unknown
  schemaRepair?: { previousRawOutput: string; error: string; attempt: number }
}) {
  return [
    "You are the main coding agent being harnessed by XieZhi.",
    "XieZhi is not the product planner. You own assumptions, decision points, problem reports, and solution proposals.",
    "XieZhi only validates JSON, persists DAG/AST/evidence, runs bounded assignments, and enforces patch rules.",
    "Return exactly one strict JSON object and no markdown.",
    "Do not include prose before or after the JSON.",
    "Return AgentPlan v1 when you can proceed. AgentPlan v1 must use this exact shape:",
    "{",
    '  "version": "v1",',
    '  "goal": "string",',
    '  "title": "string",',
    '  "requirements": ["assumption or requirement string"],',
    '  "tasks": [',
    "    {",
    '      "key": "stable-short-key",',
    '      "title": "string",',
    '      "summary": "string",',
    '      "dependsOn": ["other-task-key"],',
    '      "allowedFiles": ["repo-relative path"],',
    '      "forbiddenFiles": [".xiezhi/"],',
    '      "allowedSymbols": [],',
    '      "forbiddenSymbols": [],',
    '      "acceptance": ["string"],',
    '      "checks": ["package-manager command"],',
    '      "expectedOutputs": ["string"],',
    '      "rationale": ["string"]',
    "    }",
    "  ]",
    "}",
    "Do not return {type:'plan'}, task id/scope/steps fields, markdown, or explanatory text.",
    "Return AgentDecisionPoint v1 only when a user decision is required before safe planning:",
    '{"version":"v1","type":"decision_point","goal":"string","problem":"string","impact":"string","recommendedOptionId":"string","options":[{"id":"string","label":"string","tradeoff":"string","planDelta":"string"}],"defaultIfUnanswered":"string"}',
    "Return ProblemReport v1 when you found a blocker or important issue and are proposing a solution:",
    '{"version":"v1","type":"problem_report","problem":"string","evidence":["string"],"proposedSolution":"string","requiresUserDecision":false}',
    "For short goals, choose practical defaults, record assumptions in AgentPlan requirements, and explain them in task rationale.",
    "Make task scope explicit and bounded because XieZhi will enforce file and symbol scope.",
    `Goal: ${input.goal}`,
    input.resolvedDecisions && input.resolvedDecisions.length > 0
      ? `Resolved decisions: ${JSON.stringify(
          input.resolvedDecisions.map((decision) => ({
            problem: decision.decisionPoint.problem,
            selectedOptionId: decision.selectedOptionId,
            option: decision.decisionPoint.options.find((option) => option.id === decision.selectedOptionId) ?? null
          })),
          null,
          2
        )}`
      : "Resolved decisions: []",
    input.evidenceSummary ? `XieZhi evidence summary: ${JSON.stringify(input.evidenceSummary, null, 2)}` : "XieZhi evidence summary: none",
    input.schemaRepair
      ? [
          `Schema repair attempt: ${input.schemaRepair.attempt}`,
          `Previous output error: ${input.schemaRepair.error}`,
          "Previous raw output failed validation. Convert it into exactly one valid AgentPlan v1, AgentDecisionPoint v1, or ProblemReport v1 JSON object.",
          "Do not inspect the repo again unless absolutely necessary. Prefer repairing the previous plan content into the required schema.",
          `Previous raw output excerpt: ${input.schemaRepair.previousRawOutput.slice(-6000)}`
        ].join("\n")
      : ""
  ].join("\n")
}

function buildRuntimeCommand(runtime: RuntimeName, cwd: string, prompt: string) {
  if (runtime === "opencode") {
    return { command: "opencode", args: ["run", "--format", "json"], cwd, input: prompt }
  }
  if (runtime === "codex") {
    return { command: "codex", args: ["exec", "--json", "--cd", cwd, "--sandbox", "workspace-write", prompt], cwd }
  }
  throw new XieZhiError("CLI_USAGE_ERROR", `Agent planning runtime ${runtime} is not supported yet.`, {
    hint: "Use `--runtime opencode` for the first agent-plan path."
  })
}

export type AgentPlanCommandResult = ImportAgentPlanResult & {
  agentSessionId: string
  runtimeName: RuntimeName
  rawOutput: string
}

export type AssignmentContract = {
  version: "v1"
  taskId: string
  goal: string
  summary: string
  allowedFiles: string[]
  forbiddenFiles: string[]
  allowedSymbols: string[]
  forbiddenSymbols: string[]
  acceptance: string[]
  recommendedCommands: string[]
  expectedOutputs: string[]
  policy: ExecutionPolicy
}

export type AgentRunCommandResult = {
  status: "assigned"
  agentSessionId: string | null
  taskId: string
  taskTitle: string
  assignmentId: string
  agentRunId: string
  runtime: RuntimeName
  runtimeMode: "real" | "scaffold"
  patchId: string
  patchStatus: string
  taskStatus: string
  changedFiles: string[]
  nextStep: string
}

export type AgentRunReadyResult = {
  status: "completed"
  featureId: string
  selectedTaskIds: string[]
  skipped: Array<{ taskId: string; reason: string }>
  runs: Array<{
    taskId: string
    patchId: string
    verifyStatus?: string
    reviewStatus?: string
    promotion: "promoted" | "held" | "blocked" | "not_auto"
    decisionRationale: string[]
  }>
  nextReadyTaskIds: string[]
}

export type AgentFeedbackResult = AgentPlanCommandResult & {
  sourceFeatureId: string | null
  feedback: string
}

const agentDecisionPointV1Schema = z
  .object({
    version: z.literal("v1"),
    type: z.literal("decision_point"),
    goal: z.string().min(1),
    problem: z.string().min(1),
    impact: z.string().min(1),
    recommendedOptionId: z.string().min(1),
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          tradeoff: z.string().min(1),
          planDelta: z.string().min(1)
        })
      )
      .min(1),
    defaultIfUnanswered: z.string().min(1)
  })
  .superRefine((value, context) => {
    const optionIds = new Set(value.options.map((option) => option.id))
    if (!optionIds.has(value.recommendedOptionId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recommendedOptionId"],
        message: "recommendedOptionId must reference an option id"
      })
    }
    if (!optionIds.has(value.defaultIfUnanswered)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultIfUnanswered"],
        message: "defaultIfUnanswered must reference an option id"
      })
    }
  })

const problemReportV1Schema = z.object({
  version: z.literal("v1"),
  type: z.literal("problem_report"),
  problem: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  proposedSolution: z.string().min(1),
  requiresUserDecision: z.boolean()
})

export type AgentDecisionPointV1 = z.infer<typeof agentDecisionPointV1Schema>
export type ProblemReportV1 = z.infer<typeof problemReportV1Schema>

export type AgentBuildResult = {
  status: "planned" | "waiting_for_decision" | "problem_reported" | "completed" | "stopped" | "max_waves"
  goal: string
  runtimeName: RuntimeName
  decisionRuntimeName: RuntimeName
  agentSessionId: string
  featureId: string | null
  dryRun: boolean
  waves: AgentRunReadyResult[]
  decisionPoints: AgentDecisionPointV1[]
  resolvedDecisions: Array<{ decisionPoint: AgentDecisionPointV1; selectedOptionId: string }>
  problemReports: ProblemReportV1[]
  nextAction: string
}

type AgentBuildIntakeResult =
  | { type: "plan"; plan: AgentPlanV1 }
  | { type: "decision_point"; decisionPoint: AgentDecisionPointV1 }
  | { type: "problem_report"; problemReport: ProblemReportV1 }

function parseAgentBuildIntake(rawOutput: string): AgentBuildIntakeResult {
  const parsed = parseJsonCandidate(rawOutput)
  const decisionPoint = agentDecisionPointV1Schema.safeParse(parsed)
  if (decisionPoint.success) {
    return { type: "decision_point", decisionPoint: decisionPoint.data }
  }
  const problemReport = problemReportV1Schema.safeParse(parsed)
  if (problemReport.success) {
    return { type: "problem_report", problemReport: problemReport.data }
  }
  const plan = agentPlanV1Schema.safeParse(parsed)
  if (plan.success) {
    return { type: "plan", plan: plan.data }
  }
  throw new XieZhiError("CLI_USAGE_ERROR", "Agent build output did not match AgentPlan, AgentDecisionPoint, or ProblemReport v1.", {
    hint: "Ask the agent to return exactly one strict JSON object using a supported build-loop schema."
  })
}

const promotionDecisionSchema = z.object({
  version: z.literal("v1"),
  decisions: z.array(
    z.object({
      patchId: z.string().min(1),
      decision: z.enum(["promote", "hold"]),
      rationale: z.array(z.string().min(1)).min(1)
    })
  )
})

function buildPromotionDecisionPrompt(input: {
  reviews: Array<{
    patchId: string
    taskId: string
    goal: string
    changedFiles: string[]
    warnings: Array<{ type: string; message: string }>
    checks: Array<{ type: string; status: string; summary: string }>
    semanticCoverage: unknown
  }>
  schemaRepair?: { previousRawOutput: string; error: string; attempt: number }
}) {
  return [
    "You are deciding whether XieZhi may promote warning patches.",
    "Return exactly one strict JSON object and no markdown.",
    "The JSON must match PromotionDecision v1:",
    '{"version":"v1","decisions":[{"patchId":"string","decision":"promote|hold","rationale":["string"]}]}',
    "Only choose promote when the warnings are acceptable for the task acceptance and the patch should enter the main repo.",
    "Choose hold when a human or agent should inspect or rerun the task.",
    JSON.stringify({ reviews: input.reviews }, null, 2),
    input.schemaRepair
      ? [
          `Schema repair attempt: ${input.schemaRepair.attempt}`,
          `Previous output error: ${input.schemaRepair.error}`,
          "Previous raw output failed validation. Convert it into exactly one valid PromotionDecision v1 JSON object.",
          `Previous raw output excerpt: ${input.schemaRepair.previousRawOutput.slice(-4000)}`
        ].join("\n")
      : ""
  ].join("\n")
}

function chooseParallelReadyTasks(readyTasks: ReturnType<typeof getReadyQueue>["readyTasks"], parallel: number) {
  const selected: typeof readyTasks = []
  const skipped: Array<{ taskId: string; reason: string }> = []
  for (const task of readyTasks) {
    if (selected.length >= parallel) {
      skipped.push({ taskId: task.id, reason: `parallel limit ${parallel} reached` })
      continue
    }
    const conflict = selected.find((candidate) => scopesConflict(candidate.allowedFiles, task.allowedFiles))
    if (conflict) {
      skipped.push({ taskId: task.id, reason: `scope conflicts with ${conflict.id}` })
      continue
    }
    selected.push(task)
  }
  return { selected, skipped }
}

export class AgentService {
  constructor(private readonly db: XieZhiDatabase) {}

  private createAgentSession(input: { goal: string; runtime: RuntimeName; status?: string }) {
    const timestamp = nowIso()
    const agentSessionId = createId()
    this.db
      .insert(agentSessionsTable)
      .values({
        id: agentSessionId,
        goal: input.goal,
        featureId: null,
        planningRuntimeName: input.runtime,
        rawAgentOutput: null,
        planSummaryJson: null,
        status: input.status ?? "running",
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run()
    return agentSessionId
  }

  private async callAgentRuntime(cwd: string, runtime: RuntimeName, prompt: string) {
    const availability = await detectRuntimeAvailability(runtime)
    if (!availability.available) {
      throw new XieZhiError("CLI_USAGE_ERROR", `${runtime} is not available for agent build.`, {
        hint: availability.reason ?? `Install ${runtime} and ensure it is on PATH.`
      })
    }
    const commandInput = buildRuntimeCommand(runtime, cwd, prompt)
    const result = await execa(commandInput.command, commandInput.args, {
      cwd: commandInput.cwd,
      input: "input" in commandInput ? commandInput.input : undefined,
      reject: false
    })
    return {
      exitCode: result.exitCode,
      rawOutput: [result.stdout, result.stderr].filter(Boolean).join("\n")
    }
  }

  private recordSessionEvent(input: {
    agentSessionId: string
    runtime: RuntimeName
    type: string
    summary: string
    metadata?: unknown
  }) {
    const timestamp = nowIso()
    const buildRunId = createId()
    this.db
      .insert(agentRunsTable)
      .values({
        id: buildRunId,
        agentSessionId: input.agentSessionId,
        assignmentId: null,
        taskId: "__build__",
        runtimeName: input.runtime,
        runtimeMode: "real",
        patchId: null,
        status: "completed",
        eventSummaryJson: JSON.stringify({ type: input.type, summary: input.summary }),
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run()
    this.db
      .insert(agentEventsTable)
      .values({
        id: createId(),
        agentRunId: buildRunId,
        type: input.type,
        summary: input.summary,
        metadataJson: input.metadata === undefined ? null : JSON.stringify(input.metadata),
        createdAt: timestamp
      })
      .run()
  }

  private importBuildPlan(input: {
    cwd: string
    agentSessionId: string
    runtime: RuntimeName
    rawOutput: string
    plan: AgentPlanV1
  }) {
    const imported = importAgentPlan(input.cwd, input.plan, {
      runtimeName: input.runtime,
      rawOutput: input.rawOutput,
      agentSessionId: input.agentSessionId
    })
    this.db
      .update(agentSessionsTable)
      .set({
        featureId: imported.featureId,
        rawAgentOutput: input.rawOutput,
        planSummaryJson: JSON.stringify({
          title: imported.title,
          taskCount: imported.taskCount,
          taskKeyMap: imported.taskKeyMap,
          assumptions: input.plan.requirements
        }),
        status: "planned",
        updatedAt: nowIso()
      })
      .where(eq(agentSessionsTable.id, input.agentSessionId))
      .run()
    return imported
  }

  private findReusableBuildSession(goal: string) {
    return this.db
      .select()
      .from(agentSessionsTable)
      .where(eq(agentSessionsTable.goal, goal))
      .orderBy(desc(agentSessionsTable.createdAt))
      .all()
      .find((session) => {
        return Boolean(session.featureId) && !["completed", "failed", "waiting_for_decision"].includes(session.status)
      })
  }

  private buildAssignment(input: {
    taskId: string
    runtime: RuntimeName
    intent: IntentIr
    policy: ExecutionPolicy
  }): AssignmentContract {
    const compiledPolicy = compileExecutionPolicy({
      runtime: input.runtime,
      intent: input.intent,
      policy: input.policy
    })

    return {
      version: "v1",
      taskId: input.taskId,
      goal: input.intent.goal,
      summary: input.intent.summary,
      allowedFiles: compiledPolicy.policy.allowedFiles,
      forbiddenFiles: compiledPolicy.policy.forbiddenFiles,
      allowedSymbols: getIntentAllowedSymbols(input.intent),
      forbiddenSymbols: getIntentForbiddenSymbols(input.intent),
      acceptance: input.intent.acceptance,
      recommendedCommands: input.intent.recommendedCommands,
      expectedOutputs: getIntentExpectedOutputs(input.intent),
      policy: compiledPolicy.policy
    }
  }

  async plan(cwd: string, goal: string, runtime: RuntimeName): Promise<AgentPlanCommandResult> {
    const availability = await detectRuntimeAvailability(runtime)
    if (!availability.available) {
      throw new XieZhiError("CLI_USAGE_ERROR", `${runtime} is not available for agent planning.`, {
        hint: availability.reason ?? `Install ${runtime} and ensure it is on PATH.`
      })
    }

    const timestamp = nowIso()
    const agentSessionId = createId()
    this.db
      .insert(agentSessionsTable)
      .values({
        id: agentSessionId,
        goal,
        featureId: null,
        planningRuntimeName: runtime,
        rawAgentOutput: null,
        planSummaryJson: null,
        status: "running",
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run()

    const prompt = buildAgentPlanPrompt(goal)
    const commandInput = buildRuntimeCommand(runtime, cwd, prompt)
    const result = await execa(commandInput.command, commandInput.args, {
      cwd: commandInput.cwd,
      input: "input" in commandInput ? commandInput.input : undefined,
      reject: false
    })
    const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n")

    if (result.exitCode !== 0) {
      const failedAt = nowIso()
      this.db
        .update(agentSessionsTable)
        .set({ status: "failed", rawAgentOutput: rawOutput, updatedAt: failedAt })
        .where(eq(agentSessionsTable.id, agentSessionId))
        .run()
      throw new XieZhiError("CLI_USAGE_ERROR", `Agent planning runtime exited with code ${result.exitCode}.`, {
        hint: rawOutput || "Inspect the runtime configuration and retry agent planning."
      })
    }

    let parsedPlan: AgentPlanV1
    try {
      parsedPlan = agentPlanV1Schema.parse(parseJsonCandidate(rawOutput))
    } catch (error) {
      const failedAt = nowIso()
      this.db
        .update(agentSessionsTable)
        .set({ status: "failed", rawAgentOutput: rawOutput, updatedAt: failedAt })
        .where(eq(agentSessionsTable.id, agentSessionId))
        .run()
      if (error instanceof XieZhiError) {
        throw error
      }
      throw new XieZhiError("CLI_USAGE_ERROR", "AgentPlan JSON failed schema validation.", {
        hint: "Ask the agent to regenerate a strict AgentPlan v1 JSON object.",
        cause: error
      })
    }

    const imported = importAgentPlan(cwd, parsedPlan, {
      runtimeName: runtime,
      rawOutput,
      agentSessionId
    })
    const completedAt = nowIso()
    this.db
      .update(agentSessionsTable)
      .set({
        featureId: imported.featureId,
        rawAgentOutput: rawOutput,
        planSummaryJson: JSON.stringify({
          title: imported.title,
          taskCount: imported.taskCount,
          taskKeyMap: imported.taskKeyMap
        }),
        status: "planned",
        updatedAt: completedAt
      })
      .where(eq(agentSessionsTable.id, agentSessionId))
      .run()

    return {
      ...imported,
      agentSessionId,
      runtimeName: runtime,
      rawOutput
    }
  }

  async run(cwd: string, taskId: string, runtime: RuntimeName): Promise<AgentRunCommandResult> {
    const timestamp = nowIso()
    const taskRow = this.db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).get()
    const intent = safeJsonParse<IntentIr | null>(taskRow?.intentIrJson ?? null, null)
    const policy = safeJsonParse<ExecutionPolicy | null>(taskRow?.policyJson ?? null, null)
    if (!taskRow || !intent || !policy) {
      throw new XieZhiError("CLI_USAGE_ERROR", `Task ${taskId} is missing agent plan metadata.`, {
        hint: "Run `xiezhi agent plan \"...\" --runtime opencode` first."
      })
    }

    const latestSession = this.db
      .select()
      .from(agentSessionsTable)
      .where(eq(agentSessionsTable.featureId, taskRow.featureId))
      .orderBy(desc(agentSessionsTable.createdAt))
      .get()
    const agentSessionId = latestSession?.id ?? null
    const assignment = this.buildAssignment({ taskId, runtime, intent, policy })
    const assignmentId = createId()
    this.db
      .insert(assignmentsTable)
      .values({
        id: assignmentId,
        agentSessionId,
        taskId,
        goal: assignment.goal,
        contractJson: JSON.stringify(assignment),
        status: "running",
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run()

    const agentRunId = createId()
    this.db
      .insert(agentRunsTable)
      .values({
        id: agentRunId,
        agentSessionId,
        assignmentId,
        taskId,
        runtimeName: runtime,
        runtimeMode: null,
        patchId: null,
        status: "running",
        eventSummaryJson: null,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run()

    let taskRun: TaskRunResult
    try {
      taskRun = await new TaskRunService(this.db).runTask(cwd, taskId, runtime, { agentRunId })
    } catch (error) {
      const failedAt = nowIso()
      const eventSummaryJson = JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
      this.db.update(agentRunsTable).set({ status: "failed", eventSummaryJson, updatedAt: failedAt }).where(eq(agentRunsTable.id, agentRunId)).run()
      this.db.update(assignmentsTable).set({ status: "failed", updatedAt: failedAt }).where(eq(assignmentsTable.id, assignmentId)).run()
      throw error
    }

    const completedAt = nowIso()
    const eventSummary = {
      runtimeMode: taskRun.mode,
      success: taskRun.success,
      changedFiles: taskRun.changedFiles.length,
      commandLogs: taskRun.commandLogs,
      events: taskRun.eventCount,
      emptyPatch: taskRun.changedFiles.length === 0
    }
    this.db
      .update(agentRunsTable)
      .set({
        runtimeMode: taskRun.mode,
        patchId: taskRun.patchId,
        status: taskRun.success ? "completed" : "failed",
        eventSummaryJson: JSON.stringify(eventSummary),
        updatedAt: completedAt
      })
      .where(eq(agentRunsTable.id, agentRunId))
      .run()
    this.db
      .update(assignmentsTable)
      .set({ status: taskRun.success ? "completed" : "failed", updatedAt: completedAt })
      .where(eq(assignmentsTable.id, assignmentId))
      .run()
    this.db
      .insert(agentEventsTable)
      .values([
        {
          id: createId(),
          agentRunId,
          type: "assignment",
          summary: `Assigned ${taskId} through ${runtime}.`,
          metadataJson: JSON.stringify({ assignmentId, agentSessionId }),
          createdAt: timestamp
        },
        {
          id: createId(),
          agentRunId,
          type: "runtime",
          summary: taskRun.changedFiles.length === 0 ? "Runtime completed with no captured edits." : "Runtime returned a patch.",
          metadataJson: JSON.stringify(eventSummary),
          createdAt: completedAt
        }
      ])
      .run()

    return {
      status: "assigned",
      agentSessionId,
      taskId,
      taskTitle: intent.goal,
      assignmentId,
      agentRunId,
      runtime,
      runtimeMode: taskRun.mode,
      patchId: taskRun.patchId,
      patchStatus: taskRun.patchStatus,
      taskStatus: taskRun.taskStatus,
      changedFiles: taskRun.changedFiles,
      nextStep: taskRun.nextStep
    }
  }

  async runReady(
    cwd: string,
    input: { featureId?: string; runtime: RuntimeName; parallel: number; auto: boolean; decisionRuntime: RuntimeName }
  ): Promise<AgentRunReadyResult> {
    const ready = getReadyQueue(cwd, input.featureId)
    const { selected, skipped } = chooseParallelReadyTasks(ready.readyTasks, Math.max(1, input.parallel))
    if (selected.length === 0) {
      return {
        status: "completed",
        featureId: ready.featureId,
        selectedTaskIds: [],
        skipped,
        runs: [],
        nextReadyTaskIds: ready.readyTasks.map((task) => task.id)
      }
    }

    const taskRuns = await Promise.all(selected.map((task) => runAgentTask(cwd, task.id, input.runtime)))
    const runSummaries: AgentRunReadyResult["runs"] = taskRuns.map((run) => ({
      taskId: run.taskId,
      patchId: run.patchId,
      promotion: input.auto ? "blocked" : "not_auto",
      decisionRationale: input.auto ? [] : ["Auto promotion disabled."]
    }))

    if (input.auto) {
      const warningReviews: Array<{
        patchId: string
        taskId: string
        goal: string
        changedFiles: string[]
        warnings: Array<{ type: string; message: string }>
        checks: Array<{ type: string; status: string; summary: string }>
        semanticCoverage: unknown
      }> = []

      for (const summary of runSummaries) {
        const verify = await verifyPatch(cwd, summary.patchId)
        const review = await reviewPatch(cwd, summary.patchId)
        summary.verifyStatus = verify.status
        summary.reviewStatus = review.status
        if (verify.blockingViolations.length > 0) {
          summary.promotion = "blocked"
          summary.decisionRationale = verify.blockingViolations.map((violation) => violation.message)
          continue
        }
        if (verify.warnings.length === 0) {
          await promotePatch(cwd, summary.patchId)
          summary.promotion = "promoted"
          summary.decisionRationale = ["Patch verified without warnings."]
          continue
        }
        warningReviews.push({
          patchId: summary.patchId,
          taskId: summary.taskId,
          goal: review.goal,
          changedFiles: review.changedFiles,
          warnings: review.warnings.map((warning) => ({ type: warning.type, message: warning.message })),
          checks: review.checks.map((check) => ({ type: check.type, status: check.status, summary: check.summary })),
          semanticCoverage: review.semanticDiff.semanticCoverage
        })
      }

      if (warningReviews.length > 0) {
        let parsedDecision: z.infer<typeof promotionDecisionSchema> | null = null
        let rawOutput = ""
        let repair: { previousRawOutput: string; error: string; attempt: number } | undefined
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const commandInput = buildRuntimeCommand(
            input.decisionRuntime,
            cwd,
            buildPromotionDecisionPrompt({ reviews: warningReviews, schemaRepair: repair })
          )
          const decisionResult = await execa(commandInput.command, commandInput.args, {
            cwd: commandInput.cwd,
            input: "input" in commandInput ? commandInput.input : undefined,
            reject: false
          })
          rawOutput = [decisionResult.stdout, decisionResult.stderr].filter(Boolean).join("\n")
          if (decisionResult.exitCode !== 0) {
            repair = {
              previousRawOutput: rawOutput,
              error: `Promotion decision runtime exited with code ${decisionResult.exitCode}.`,
              attempt: (repair?.attempt ?? 0) + 1
            }
            continue
          }
          try {
            parsedDecision = promotionDecisionSchema.parse(parseJsonCandidate(rawOutput))
            break
          } catch (error) {
            repair = {
              previousRawOutput: rawOutput,
              error: error instanceof Error ? error.message : String(error),
              attempt: (repair?.attempt ?? 0) + 1
            }
          }
        }
        if (!parsedDecision) {
          for (const review of warningReviews) {
            const summary = runSummaries.find((candidate) => candidate.patchId === review.patchId)!
            summary.promotion = "held"
            summary.decisionRationale = ["PromotionDecision output could not be repaired automatically."]
            const agentRun = this.db.select().from(agentRunsTable).where(eq(agentRunsTable.patchId, review.patchId)).get()
            if (agentRun) {
              this.db
                .insert(agentEventsTable)
                .values({
                  id: createId(),
                  agentRunId: agentRun.id,
                  type: "promotion_decision",
                  summary: `Decision for ${review.patchId}: hold.`,
                  metadataJson: JSON.stringify({ decision: "hold", rationale: summary.decisionRationale, rawOutput }),
                  createdAt: nowIso()
                })
                .run()
            }
          }
          const nextReady = getReadyQueue(cwd, ready.featureId)
          return {
            status: "completed",
            featureId: ready.featureId,
            selectedTaskIds: selected.map((task) => task.id),
            skipped,
            runs: runSummaries,
            nextReadyTaskIds: nextReady.readyTasks.map((task) => task.id)
          }
        }
        const warningPatchIds = new Set(warningReviews.map((review) => review.patchId))
        for (const decision of parsedDecision.decisions) {
          if (!warningPatchIds.has(decision.patchId)) {
            throw new XieZhiError("CLI_USAGE_ERROR", `PromotionDecision referenced unknown patch ${decision.patchId}.`, {
              hint: "Ask the agent to decide only on patches from the current run-ready wave."
            })
          }
        }
        for (const review of warningReviews) {
          const decision = parsedDecision.decisions.find((candidate) => candidate.patchId === review.patchId)
          const summary = runSummaries.find((candidate) => candidate.patchId === review.patchId)!
          const chosen = decision?.decision ?? "hold"
          summary.decisionRationale = decision?.rationale ?? ["Decision omitted; holding patch."]
          if (chosen === "promote") {
            await promotePatch(cwd, review.patchId)
            summary.promotion = "promoted"
          } else {
            summary.promotion = "held"
          }

          const agentRun = this.db.select().from(agentRunsTable).where(eq(agentRunsTable.patchId, review.patchId)).get()
          if (agentRun) {
            this.db
              .insert(agentEventsTable)
              .values({
                id: createId(),
                agentRunId: agentRun.id,
                type: "promotion_decision",
                summary: `Decision for ${review.patchId}: ${chosen}.`,
                metadataJson: JSON.stringify({ decision: chosen, rationale: summary.decisionRationale, rawOutput }),
                createdAt: nowIso()
              })
              .run()
          }
        }
      }
    }

    const nextReady = getReadyQueue(cwd, ready.featureId)
    return {
      status: "completed",
      featureId: ready.featureId,
      selectedTaskIds: selected.map((task) => task.id),
      skipped,
      runs: runSummaries,
      nextReadyTaskIds: nextReady.readyTasks.map((task) => task.id)
    }
  }

  async feedback(cwd: string, feedback: string, runtime: RuntimeName, featureId?: string): Promise<AgentFeedbackResult> {
    let sourceFeatureId = featureId ?? null
    let context = "No previous feature context found."
    try {
      const ready = getReadyQueue(cwd, featureId)
      sourceFeatureId = ready.featureId
      context = JSON.stringify({
        featureId: ready.featureId,
        title: ready.featureTitle,
        status: ready.featureStatus,
        readyTasks: ready.readyTasks,
        blockedTasks: ready.blockedTasks,
        doneTasks: ready.doneTasks
      })
    } catch {
      // Feedback can still start a new plan when no prior feature exists.
    }

    const result = await this.plan(
      cwd,
      [
        "Create a follow-up AgentPlan from user feedback.",
        `User feedback: ${feedback}`,
        `Source feature id: ${sourceFeatureId ?? "none"}`,
        `Current context: ${context}`
      ].join("\n"),
      runtime
    )
    const summary = {
      ...(typeof result.taskKeyMap === "object" ? { taskKeyMap: result.taskKeyMap } : {}),
      title: result.title,
      taskCount: result.taskCount,
      sourceFeatureId,
      feedback
    }
    this.db
      .update(agentSessionsTable)
      .set({ planSummaryJson: JSON.stringify(summary), updatedAt: nowIso() })
      .where(eq(agentSessionsTable.id, result.agentSessionId))
      .run()
    return { ...result, sourceFeatureId, feedback }
  }

  async build(
    cwd: string,
    input: {
      goal: string
      runtime: RuntimeName
      parallel: number
      decisionRuntime: RuntimeName
      maxWaves: number
      assumeDefaults: boolean
      dryRunPlan: boolean
    }
  ): Promise<AgentBuildResult> {
    const reusableSession = input.dryRunPlan ? null : this.findReusableBuildSession(input.goal)
    const agentSessionId = reusableSession?.id ?? this.createAgentSession({ goal: input.goal, runtime: input.runtime })
    const decisionPoints: AgentDecisionPointV1[] = []
    const resolvedDecisions: AgentBuildResult["resolvedDecisions"] = []
    const problemReports: ProblemReportV1[] = []
    const waves: AgentRunReadyResult[] = []
    let featureId: string | null = reusableSession?.featureId ?? null
    let schemaRepair: { previousRawOutput: string; error: string; attempt: number } | undefined

    for (let attempt = 0; !featureId && attempt < 6; attempt += 1) {
      const prompt = buildAgentBuildIntakePrompt({
        goal: input.goal,
        resolvedDecisions,
        evidenceSummary: attempt === 0 ? null : { previousDecisionPoints: decisionPoints.map((point) => point.problem) },
        schemaRepair
      })
      const runtimeResult = await this.callAgentRuntime(cwd, input.runtime, prompt)
      this.db
        .update(agentSessionsTable)
        .set({ rawAgentOutput: runtimeResult.rawOutput, updatedAt: nowIso() })
        .where(eq(agentSessionsTable.id, agentSessionId))
        .run()

      if (runtimeResult.exitCode !== 0) {
        this.db.update(agentSessionsTable).set({ status: "failed", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
        throw new XieZhiError("CLI_USAGE_ERROR", `Agent build runtime exited with code ${runtimeResult.exitCode}.`, {
          hint: runtimeResult.rawOutput || "Inspect the runtime configuration and retry agent build."
        })
      }

      let intake: AgentBuildIntakeResult
      try {
        intake = parseAgentBuildIntake(runtimeResult.rawOutput)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.recordSessionEvent({
          agentSessionId,
          runtime: input.runtime,
          type: "agent_problem_reported",
          summary: "Agent build output failed schema validation.",
          metadata: {
            problem: "Agent returned malformed build-loop output.",
            evidence: [message, runtimeResult.rawOutput.slice(-2000)],
            proposedSolution: "Ask the main agent to repair its previous output into strict AgentPlan v1, AgentDecisionPoint v1, or ProblemReport v1 JSON.",
            requiresUserDecision: false,
            attempt: schemaRepair ? schemaRepair.attempt : 0
          }
        })
        if ((schemaRepair?.attempt ?? 0) < 2) {
          schemaRepair = {
            previousRawOutput: runtimeResult.rawOutput,
            error: message,
            attempt: (schemaRepair?.attempt ?? 0) + 1
          }
          this.recordSessionEvent({
            agentSessionId,
            runtime: input.runtime,
            type: "agent_solution_proposed",
            summary: "Retrying agent intake with schema repair context.",
            metadata: schemaRepair
          })
          continue
        }
        const problemReport: ProblemReportV1 = {
          version: "v1",
          type: "problem_report",
          problem: "Agent repeatedly returned malformed build-loop output.",
          evidence: [message, runtimeResult.rawOutput.slice(-2000)],
          proposedSolution: "Rerun agent build after inspecting session evidence, or improve the runtime prompt/schema adherence.",
          requiresUserDecision: false
        }
        problemReports.push(problemReport)
        this.db.update(agentSessionsTable).set({ status: "failed", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
        return {
          status: "problem_reported",
          goal: input.goal,
          runtimeName: input.runtime,
          decisionRuntimeName: input.decisionRuntime,
          agentSessionId,
          featureId,
          dryRun: input.dryRunPlan,
          waves,
          decisionPoints,
          resolvedDecisions,
          problemReports,
          nextAction: "Agent output could not be repaired automatically. Inspect `xiezhi agent session show` for raw evidence."
        }
      }

      schemaRepair = undefined

      if (intake.type === "decision_point") {
        decisionPoints.push(intake.decisionPoint)
        this.recordSessionEvent({
          agentSessionId,
          runtime: input.runtime,
          type: "decision_point_declared",
          summary: intake.decisionPoint.problem,
          metadata: intake.decisionPoint
        })
        if (!input.assumeDefaults) {
          this.db
            .update(agentSessionsTable)
            .set({ status: "waiting_for_decision", updatedAt: nowIso() })
            .where(eq(agentSessionsTable.id, agentSessionId))
            .run()
          return {
            status: "waiting_for_decision",
            goal: input.goal,
            runtimeName: input.runtime,
            decisionRuntimeName: input.decisionRuntime,
            agentSessionId,
            featureId,
            dryRun: input.dryRunPlan,
            waves,
            decisionPoints,
            resolvedDecisions,
            problemReports,
            nextAction: "Resolve the agent-declared decision point, or rerun with `--assume-defaults` to select the default option."
          }
        }
        const selectedOptionId = intake.decisionPoint.defaultIfUnanswered || intake.decisionPoint.recommendedOptionId
        resolvedDecisions.push({ decisionPoint: intake.decisionPoint, selectedOptionId })
        this.recordSessionEvent({
          agentSessionId,
          runtime: input.runtime,
          type: "decision_point_resolved",
          summary: `Selected ${selectedOptionId} for: ${intake.decisionPoint.problem}`,
          metadata: { decisionPoint: intake.decisionPoint, selectedOptionId, mode: "assume_defaults" }
        })
        continue
      }

      if (intake.type === "problem_report") {
        problemReports.push(intake.problemReport)
        this.recordSessionEvent({
          agentSessionId,
          runtime: input.runtime,
          type: "agent_problem_reported",
          summary: intake.problemReport.problem,
          metadata: intake.problemReport
        })
        this.recordSessionEvent({
          agentSessionId,
          runtime: input.runtime,
          type: "agent_solution_proposed",
          summary: intake.problemReport.proposedSolution,
          metadata: intake.problemReport
        })
        const status = intake.problemReport.requiresUserDecision ? "waiting_for_decision" : "failed"
        this.db.update(agentSessionsTable).set({ status, updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
        if (intake.problemReport.requiresUserDecision) {
          throw new XieZhiError("CLI_USAGE_ERROR", "Agent reported a problem requiring user decision but did not output AgentDecisionPoint v1.", {
            hint: "Ask the agent to return a structured AgentDecisionPoint v1."
          })
        }
        return {
          status: "problem_reported",
          goal: input.goal,
          runtimeName: input.runtime,
          decisionRuntimeName: input.decisionRuntime,
          agentSessionId,
          featureId,
          dryRun: input.dryRunPlan,
          waves,
          decisionPoints,
          resolvedDecisions,
          problemReports,
          nextAction: "Inspect the agent problem report and rerun build or agent feedback with the proposed solution."
        }
      }

      const imported = this.importBuildPlan({
        cwd,
        agentSessionId,
        runtime: input.runtime,
        rawOutput: runtimeResult.rawOutput,
        plan: intake.plan
      })
      featureId = imported.featureId
      break
    }

    if (!featureId) {
      this.db.update(agentSessionsTable).set({ status: "waiting_for_decision", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
      return {
        status: "waiting_for_decision",
        goal: input.goal,
        runtimeName: input.runtime,
        decisionRuntimeName: input.decisionRuntime,
        agentSessionId,
        featureId,
        dryRun: input.dryRunPlan,
        waves,
        decisionPoints,
        resolvedDecisions,
        problemReports,
        nextAction: "Agent kept returning decision points; resolve them explicitly before running build again."
      }
    }

    if (input.dryRunPlan) {
      return {
        status: "planned",
        goal: input.goal,
        runtimeName: input.runtime,
        decisionRuntimeName: input.decisionRuntime,
        agentSessionId,
        featureId,
        dryRun: true,
        waves,
        decisionPoints,
        resolvedDecisions,
        problemReports,
        nextAction: `Inspect the DAG, then run \`xiezhi agent build "${input.goal}" --runtime ${input.runtime}\` to execute.`
      }
    }

    const maxWaves = Math.max(1, input.maxWaves)
    for (let waveIndex = 0; waveIndex < maxWaves; waveIndex += 1) {
      const ready = getReadyQueue(cwd, featureId)
      if (ready.readyTasks.length === 0) {
        const completed = ready.blockedTasks.length === 0 && ready.skippedTasks.length === 0
        this.db
          .update(agentSessionsTable)
          .set({ status: completed ? "completed" : "stopped", updatedAt: nowIso() })
          .where(eq(agentSessionsTable.id, agentSessionId))
          .run()
        return {
          status: completed ? "completed" : "stopped",
          goal: input.goal,
          runtimeName: input.runtime,
          decisionRuntimeName: input.decisionRuntime,
          agentSessionId,
          featureId,
          dryRun: false,
          waves,
          decisionPoints,
          resolvedDecisions,
          problemReports,
          nextAction: completed ? "Build DAG completed." : ready.nextAction
        }
      }

      this.recordSessionEvent({
        agentSessionId,
        runtime: input.runtime,
        type: "build_wave_started",
        summary: `Build wave ${waveIndex + 1} started with ${ready.readyTasks.length} ready task(s).`,
        metadata: { wave: waveIndex + 1, readyTasks: ready.readyTasks }
      })
      const wave = await this.runReady(cwd, {
        featureId,
        runtime: input.runtime,
        parallel: input.parallel,
        auto: true,
        decisionRuntime: input.decisionRuntime
      })
      waves.push(wave)
      this.recordSessionEvent({
        agentSessionId,
        runtime: input.runtime,
        type: "build_wave_completed",
        summary: `Build wave ${waveIndex + 1} completed with ${wave.runs.length} run(s).`,
        metadata: { wave: waveIndex + 1, result: wave }
      })

      const heldOrBlocked = wave.runs.filter((run) => run.promotion === "held" || run.promotion === "blocked")
      if (heldOrBlocked.length > 0) {
        const evidenceSummary = {
          reason: "A build wave produced held or blocked patches.",
          currentFeatureId: featureId,
          heldOrBlocked,
          wave,
          instruction:
            "Solve this automatically as the main agent. Return a recovery AgentPlan v1 with bounded tasks, an AgentDecisionPoint v1 if user choice is required, or a ProblemReport v1 if impossible."
        }
        this.recordSessionEvent({
          agentSessionId,
          runtime: input.runtime,
          type: "agent_problem_reported",
          summary: "Build wave produced held or blocked patches.",
          metadata: evidenceSummary
        })
        this.recordSessionEvent({
          agentSessionId,
          runtime: input.runtime,
          type: "agent_solution_proposed",
          summary: "Requesting a recovery plan from the main agent.",
          metadata: evidenceSummary
        })

        let recoveryRepair: { previousRawOutput: string; error: string; attempt: number } | undefined
        let recovered = false
        for (let recoveryAttempt = 0; recoveryAttempt < 3; recoveryAttempt += 1) {
          const recoveryRuntimeResult = await this.callAgentRuntime(
            cwd,
            input.runtime,
            buildAgentBuildIntakePrompt({
              goal: input.goal,
              resolvedDecisions,
              evidenceSummary,
              schemaRepair: recoveryRepair
            })
          )
          this.db
            .update(agentSessionsTable)
            .set({ rawAgentOutput: recoveryRuntimeResult.rawOutput, updatedAt: nowIso() })
            .where(eq(agentSessionsTable.id, agentSessionId))
            .run()

          if (recoveryRuntimeResult.exitCode !== 0) {
            break
          }

          let recoveryIntake: AgentBuildIntakeResult
          try {
            recoveryIntake = parseAgentBuildIntake(recoveryRuntimeResult.rawOutput)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            recoveryRepair = {
              previousRawOutput: recoveryRuntimeResult.rawOutput,
              error: message,
              attempt: (recoveryRepair?.attempt ?? 0) + 1
            }
            this.recordSessionEvent({
              agentSessionId,
              runtime: input.runtime,
              type: "agent_problem_reported",
              summary: "Recovery output failed schema validation.",
              metadata: { error: message, rawOutput: recoveryRuntimeResult.rawOutput.slice(-2000), recoveryAttempt }
            })
            continue
          }

          if (recoveryIntake.type === "plan") {
            const imported = this.importBuildPlan({
              cwd,
              agentSessionId,
              runtime: input.runtime,
              rawOutput: recoveryRuntimeResult.rawOutput,
              plan: recoveryIntake.plan
            })
            featureId = imported.featureId
            recovered = true
            break
          }

          if (recoveryIntake.type === "decision_point") {
            decisionPoints.push(recoveryIntake.decisionPoint)
            this.recordSessionEvent({
              agentSessionId,
              runtime: input.runtime,
              type: "decision_point_declared",
              summary: recoveryIntake.decisionPoint.problem,
              metadata: recoveryIntake.decisionPoint
            })
            if (input.assumeDefaults) {
              const selectedOptionId = recoveryIntake.decisionPoint.defaultIfUnanswered || recoveryIntake.decisionPoint.recommendedOptionId
              resolvedDecisions.push({ decisionPoint: recoveryIntake.decisionPoint, selectedOptionId })
              this.recordSessionEvent({
                agentSessionId,
                runtime: input.runtime,
                type: "decision_point_resolved",
                summary: `Selected ${selectedOptionId} for: ${recoveryIntake.decisionPoint.problem}`,
                metadata: { decisionPoint: recoveryIntake.decisionPoint, selectedOptionId, mode: "assume_defaults" }
              })
              continue
            }
            this.db
              .update(agentSessionsTable)
              .set({ status: "waiting_for_decision", updatedAt: nowIso() })
              .where(eq(agentSessionsTable.id, agentSessionId))
              .run()
            return {
              status: "waiting_for_decision",
              goal: input.goal,
              runtimeName: input.runtime,
              decisionRuntimeName: input.decisionRuntime,
              agentSessionId,
              featureId,
              dryRun: false,
              waves,
              decisionPoints,
              resolvedDecisions,
              problemReports,
              nextAction: "Resolve the recovery decision point, or rerun with `--assume-defaults`."
            }
          }

          problemReports.push(recoveryIntake.problemReport)
          this.recordSessionEvent({
            agentSessionId,
            runtime: input.runtime,
            type: "agent_problem_reported",
            summary: recoveryIntake.problemReport.problem,
            metadata: recoveryIntake.problemReport
          })
          this.recordSessionEvent({
            agentSessionId,
            runtime: input.runtime,
            type: "agent_solution_proposed",
            summary: recoveryIntake.problemReport.proposedSolution,
            metadata: recoveryIntake.problemReport
          })
          break
        }

        if (recovered) {
          continue
        }

        this.db.update(agentSessionsTable).set({ status: "stopped", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
        return {
          status: "stopped",
          goal: input.goal,
          runtimeName: input.runtime,
          decisionRuntimeName: input.decisionRuntime,
          agentSessionId,
          featureId,
          dryRun: false,
          waves,
          decisionPoints,
          resolvedDecisions,
          problemReports,
          nextAction: "A patch was held or blocked, and the main agent did not return a recovery plan."
        }
      }

      const afterWaveReady = getReadyQueue(cwd, featureId)
      if (afterWaveReady.readyTasks.length === 0 && afterWaveReady.blockedTasks.length === 0 && afterWaveReady.skippedTasks.length === 0) {
        this.db.update(agentSessionsTable).set({ status: "completed", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
        return {
          status: "completed",
          goal: input.goal,
          runtimeName: input.runtime,
          decisionRuntimeName: input.decisionRuntime,
          agentSessionId,
          featureId,
          dryRun: false,
          waves,
          decisionPoints,
          resolvedDecisions,
          problemReports,
          nextAction: "Build DAG completed."
        }
      }
    }

    this.db.update(agentSessionsTable).set({ status: "running", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
    return {
      status: "max_waves",
      goal: input.goal,
      runtimeName: input.runtime,
      decisionRuntimeName: input.decisionRuntime,
      agentSessionId,
      featureId,
      dryRun: false,
      waves,
      decisionPoints,
      resolvedDecisions,
      problemReports,
      nextAction: `Reached --max-waves ${maxWaves}. Inspect the ready queue or rerun build to continue.`
    }
  }
}

export async function runAgentPlan(cwd: string, goal: string, runtime: RuntimeName) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new AgentService(drizzle(sqlite, { schema }))
    return await service.plan(cwd, goal, runtime)
  } finally {
    sqlite.close()
  }
}

export async function runAgentTask(cwd: string, taskId: string, runtime: RuntimeName) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new AgentService(drizzle(sqlite, { schema }))
    return await service.run(cwd, taskId, runtime)
  } finally {
    sqlite.close()
  }
}

export async function runAgentReadyTasks(
  cwd: string,
  input: { featureId?: string; runtime: RuntimeName; parallel: number; auto: boolean; decisionRuntime: RuntimeName }
) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new AgentService(drizzle(sqlite, { schema }))
    return await service.runReady(cwd, input)
  } finally {
    sqlite.close()
  }
}

export async function runAgentFeedback(cwd: string, feedback: string, runtime: RuntimeName, featureId?: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new AgentService(drizzle(sqlite, { schema }))
    return await service.feedback(cwd, feedback, runtime, featureId)
  } finally {
    sqlite.close()
  }
}

export async function runAgentBuild(
  cwd: string,
  input: {
    goal: string
    runtime: RuntimeName
    parallel: number
    decisionRuntime: RuntimeName
    maxWaves: number
    assumeDefaults: boolean
    dryRunPlan: boolean
  }
) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new AgentService(drizzle(sqlite, { schema }))
    return await service.build(cwd, input)
  } finally {
    sqlite.close()
  }
}
