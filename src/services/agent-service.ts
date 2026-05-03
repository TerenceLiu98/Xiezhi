import { desc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { execa } from "execa"

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

function parseJsonCandidate(source: string): unknown {
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
