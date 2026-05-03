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
}) {
  return [
    "You are deciding whether XieZhi may promote warning patches.",
    "Return exactly one strict JSON object and no markdown.",
    "The JSON must match PromotionDecision v1:",
    '{"version":"v1","decisions":[{"patchId":"string","decision":"promote|hold","rationale":["string"]}]}',
    "Only choose promote when the warnings are acceptable for the task acceptance and the patch should enter the main repo.",
    "Choose hold when a human or agent should inspect or rerun the task.",
    JSON.stringify({ reviews: input.reviews }, null, 2)
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
        const commandInput = buildRuntimeCommand(
          input.decisionRuntime,
          cwd,
          buildPromotionDecisionPrompt({ reviews: warningReviews })
        )
        const decisionResult = await execa(commandInput.command, commandInput.args, {
          cwd: commandInput.cwd,
          input: "input" in commandInput ? commandInput.input : undefined,
          reject: false
        })
        const rawOutput = [decisionResult.stdout, decisionResult.stderr].filter(Boolean).join("\n")
        if (decisionResult.exitCode !== 0) {
          throw new XieZhiError("CLI_USAGE_ERROR", `Promotion decision runtime exited with code ${decisionResult.exitCode}.`, {
            hint: rawOutput || "Retry run-ready or inspect held warning patches."
          })
        }
        const parsedDecision = promotionDecisionSchema.parse(parseJsonCandidate(rawOutput))
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
