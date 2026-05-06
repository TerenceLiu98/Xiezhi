import path from "node:path"

import { desc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { execa } from "execa"
import { z } from "zod"

import { XieZhiError } from "../core/errors.js"
import { createId } from "../core/ids.js"
import { nowIso } from "../core/time.js"
import { assertDatabaseInitialized, openDatabaseConnection, type XieZhiDatabase } from "../db/client.js"
import * as schema from "../db/schema.js"
import { agentEventsTable, agentRunsTable, agentSessionsTable, assignmentsTable, dagNodesTable, tasksTable } from "../db/schema.js"
import { compileExecutionPolicy } from "../execution/policy-compiler.js"
import {
  agentPlanV1Schema,
  getIntentAllowedSymbols,
  getIntentExpectedOutputs,
  getIntentForbiddenSymbols,
  getIntentHandoff,
  getIntentParallelGroup,
  getIntentSubagentRole,
  type AgentPlanV1,
  type IntentIr
} from "../planning/types.js"
import type { CommandLog, ExecutionPolicy, RuntimeName } from "../runtime/shared/contracts.js"
import { detectRuntimeAvailability } from "../runtime/shared/capabilities.js"
import { importAgentPlan, type ImportAgentPlanResult } from "./planning-service.js"
import { PatchRecordService } from "./patch-record-service.js"
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

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.length > 0))]
}

function isXieZhiPath(filePath: string) {
  return filePath === ".xiezhi" || filePath.startsWith(".xiezhi/")
}

function assertSafeScopePath(filePath: string, field: string) {
  const normalized = filePath.replace(/\\/g, "/")
  if (!normalized || path.isAbsolute(normalized) || normalized.split("/").includes("..") || isXieZhiPath(normalized)) {
    throw new XieZhiError("CLI_USAGE_ERROR", `AgentScopeRevision contains unsafe ${field}: ${filePath}`, {
      hint: "Ask the main agent to revise scope with repo-relative paths outside .xiezhi/."
    })
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

function extractJsonObjectsFromText(source: string) {
  const candidates: unknown[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{") {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char === "}" && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        try {
          candidates.push(JSON.parse(source.slice(start, index + 1)))
        } catch {
          // Keep scanning; agent output often contains prose around valid JSON.
        }
        start = -1
      }
    }
  }
  return candidates
}

export function parseJsonCandidates(source: string): unknown[] {
  const candidates: unknown[] = []
  try {
    candidates.push(parseJsonCandidate(source))
  } catch {
    // Fall back to object extraction below.
  }

  const textParts: string[] = []
  for (const line of source.trim().split("\n")) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line) as unknown
      const collectText = (item: unknown) => {
        if (typeof item === "string") {
          textParts.push(item)
          return
        }
        if (!item || typeof item !== "object") return
        const record = item as Record<string, unknown>
        for (const key of ["text", "content", "message", "output"]) {
          if (typeof record[key] === "string") textParts.push(record[key])
        }
        if (record.part) collectText(record.part)
        if (record.message) collectText(record.message)
      }
      collectText(value)
      if (value && typeof value === "object") candidates.push(value)
    } catch {
      textParts.push(line)
    }
  }

  candidates.push(...extractJsonObjectsFromText(textParts.join("\n")))
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate)
    if (seen.has(key)) return false
    seen.add(key)
    return true
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
    '      "subagentRole": "implementation|test|design|integration|review",',
    '      "parallelGroup": "optional wave/group label or null",',
    '      "handoff": ["context this subagent needs from prior tasks"],',
    '      "rationale": ["string"]',
    "    }",
    "  ]",
    "}",
    "Plan for OpenCode subagents: each task is a bounded assignment for a subagent, not a vague step for one main agent.",
    "Use independent allowedFiles and parallelGroup labels so XieZhi can show safe ready waves and scope conflicts.",
    "Put architecture/design/test/integration ownership in subagentRole and handoff.",
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
    "You are the supervisor agent. Own product judgment, architecture decisions, subagent planning, progress reports, and recovery proposals.",
    "Before planning a greenfield app, expose important product/architecture/experience/validation choices as AgentDecisionPoint v1 unless already resolved.",
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
    '      "subagentRole": "implementation|test|design|integration|review",',
    '      "parallelGroup": "optional wave/group label or null",',
    '      "handoff": ["context this subagent needs from prior tasks"],',
    '      "rationale": ["string"]',
    "    }",
    "  ]",
    "}",
    "Do not return {type:'plan'}, task id/scope/steps fields, markdown, or explanatory text.",
    "Return AgentDecisionPoint v1 only when a user decision is required before safe planning:",
    '{"version":"v1","type":"decision_point","goal":"string","problem":"string","impact":"string","recommendedOptionId":"string","options":[{"id":"string","label":"string","tradeoff":"string","planDelta":"string"}],"defaultIfUnanswered":"string"}',
    "Return ProblemReport v1 when you found a blocker or important issue and are proposing a solution:",
    '{"version":"v1","type":"problem_report","problem":"string","evidence":["string"],"proposedSolution":"string","requiresUserDecision":false}',
    "Return AgentScopeRevision v1 when XieZhi evidence shows the current patch/checks are valid for the goal but the task declaration was too narrow:",
    '{"version":"v1","type":"scope_revision","featureId":"string","taskId":"string","patchId":"string or null","reason":"string","addAllowedFiles":["repo-relative path"],"addForbiddenFiles":["repo-relative path"],"addChecks":["command"],"addAcceptance":["string"],"rationale":["string"],"action":"reverify_patch|rerun_task"}',
    "You may also emit AgentProgressReport v1 JSON objects in runtime output before the final object when your runtime supports multiple JSON events:",
    '{"version":"v1","type":"progress_report","phase":"intake|planning|decision|building|verifying|reviewing|promoting|recovering|completed|stalled","summary":"string","currentTaskId":null,"executionGroup":null,"subagents":[{"id":"string","role":"supervisor|implementation|test|design|integration|review","taskId":null,"status":"planned|running|blocked|completed|failed","summary":"string"}],"risks":["string"],"nextAction":"string"}',
    "You may include AgentExecutionPlan v1 JSON when declaring subagent execution groups; XieZhi treats --parallel as a hard resource limit and validates DAG/scope safety:",
    '{"version":"v1","type":"execution_plan","executionGroups":[{"id":"string","summary":"string","tasks":["task-key"],"parallelism":1,"subagents":[{"role":"implementation|test|design|review","taskKey":"string","reason":"string"}]}]}',
    "For greenfield app goals or ambiguous product goals, first declare AgentDecisionPoint v1 for user-facing choices such as platform, app shell, MVP feature scope, interaction model, UI visual style, persistence strategy, notification behavior, and validation/check policy unless those decisions are already resolved.",
    "Validation/check policy is a user decision because it controls speed versus confidence. Offer options such as fast smoke only, build/typecheck required, or build plus tests required.",
    "For app goals, do not hand off to normalization until feature scope and UI/interaction style are resolved by user choice, resolved decisions, or explicit --assume-defaults.",
    "Declare one DecisionPoint at a time in priority order. Do not hide architecture or design choices as silent assumptions when they materially affect the app.",
    "For short goals, choose practical defaults only after exposing important decision points, record assumptions in AgentPlan requirements, and explain them in task rationale.",
    "Plan as a supervisor agent: use the DAG and AST/scope evidence to split work into subagent-sized tasks.",
    "Do not make the main agent own all implementation. Assign clear subagentRole values, parallelGroup labels, and handoff notes.",
    "Prefer parallel-ready tasks only when allowedFiles do not overlap. Use dependencies when one subagent needs another subagent's output.",
    "Make task scope explicit and bounded because XieZhi will enforce file and symbol scope.",
    "When XieZhi returns blocking, verification, review, promotion, or scope evidence, solve it automatically by replanning, returning AgentScopeRevision, or proposing a bounded recovery; ask the user only for product, UI, architecture, or validation-policy decisions.",
    "If a patch is held because required checks are missing and no validation/check policy has been resolved, return an AgentDecisionPoint about validation strictness. If validation policy is resolved, plan a recovery that runs or fixes the required checks automatically.",
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
          "Previous raw output failed validation. Convert it into exactly one valid AgentPlan v1, AgentDecisionPoint v1, ProblemReport v1, or AgentScopeRevision v1 JSON object.",
          "Do not inspect the repo again unless absolutely necessary. Prefer repairing the previous plan content into the required schema.",
          `Previous raw output excerpt: ${input.schemaRepair.previousRawOutput.slice(-6000)}`
        ].join("\n")
      : ""
  ].join("\n")
}

function buildAgentSupervisorIntakePrompt(input: {
  goal: string
  resolvedDecisions?: Array<{ decisionPoint: AgentDecisionPointV1; selectedOptionId: string }>
  evidenceSummary?: unknown
}) {
  return [
    "You are the OpenCode supervisor agent being harnessed by XieZhi.",
    "Move quickly. You may explore the repository, inspect files, reason naturally, and report progress before producing a final structured handoff.",
    "XieZhi will not require an AgentPlan at the start. XieZhi will normalize your final supervisor handoff into DAG/task state after intake.",
    "If user judgment is required, output a parseable AgentDecisionPoint v1 JSON object in your message.",
    '{"version":"v1","type":"decision_point","goal":"string","problem":"string","impact":"string","recommendedOptionId":"string","options":[{"id":"string","label":"string","tradeoff":"string","planDelta":"string"}],"defaultIfUnanswered":"string"}',
    "If you can proceed without user input, finish with a parseable SupervisorHandoff v1 JSON object. It may appear inside OpenCode JSON event text; markdown fences are allowed but unnecessary.",
    '{"version":"v1","type":"supervisor_handoff","goal":"string","summary":"string","assumptions":["string"],"resolvedDecisions":["string"],"subagentPlan":[{"id":"string","role":"implementation|test|design|integration|review","summary":"string","suggestedScope":["repo-relative path"]}],"normalizationInstructions":["string"],"readyToNormalize":true}',
    "You may also emit AgentProgressReport v1 JSON objects while exploring:",
    '{"version":"v1","type":"progress_report","phase":"intake|planning|decision|building|verifying|reviewing|promoting|recovering|completed|stalled","summary":"string","currentTaskId":null,"executionGroup":null,"subagents":[{"id":"string","role":"supervisor|implementation|test|design|integration|review","taskId":null,"status":"planned|running|blocked|completed|failed","summary":"string"}],"risks":["string"],"nextAction":"string"}',
    "Do not edit application files during supervisor intake. This phase is for exploration, user decisions, and subagent planning only.",
    "For greenfield app goals, explicitly resolve or ask decision points for MVP feature scope, UI/interaction style, and validation/check policy before SupervisorHandoff.",
    "Validation/check policy is a user-facing tradeoff: fast smoke only, build/typecheck required, or build plus tests required. Do not silently choose a strictness level unless --assume-defaults/resolved decisions make that acceptable.",
    "Do not ask the user to resolve verification/review/blocking engineering issues; XieZhi will return those as recovery evidence later.",
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
    input.evidenceSummary ? `XieZhi evidence summary: ${JSON.stringify(input.evidenceSummary, null, 2)}` : "XieZhi evidence summary: none"
  ].join("\n")
}

function buildSupervisorNormalizationPrompt(input: {
  goal: string
  handoff: SupervisorHandoffV1
  rawSupervisorOutput: string
  schemaRepair?: { previousRawOutput: string; error: string; attempt: number }
}) {
  return [
    "Convert the supervisor handoff into exactly one strict AgentPlan v1 JSON object and no markdown.",
    "Do not explore or edit files in this normalization step.",
    "The JSON must match AgentPlan v1:",
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
    '      "subagentRole": "implementation|test|design|integration|review",',
    '      "parallelGroup": "optional execution group label or null",',
    '      "handoff": ["context this subagent needs from prior tasks"],',
    '      "rationale": ["string"]',
    "    }",
    "  ]",
    "}",
    "Create bounded subagent-sized tasks. Keep allowedFiles explicit and repository-relative.",
    "Task checks must follow the resolved validation/check policy from the handoff and resolved decisions. If no explicit validation policy exists, add a requirement explaining the default policy you are assuming and choose checks consistent with that assumption.",
    `Goal: ${input.goal}`,
    `Supervisor handoff: ${JSON.stringify(input.handoff, null, 2)}`,
    `Raw supervisor transcript excerpt: ${input.rawSupervisorOutput.slice(-6000)}`,
    input.schemaRepair
      ? [
          `Schema repair attempt: ${input.schemaRepair.attempt}`,
          `Previous output error: ${input.schemaRepair.error}`,
          "Previous normalization output failed AgentPlan validation. Return one corrected AgentPlan v1 object only.",
          `Previous normalization output excerpt: ${input.schemaRepair.previousRawOutput.slice(-6000)}`
        ].join("\n")
      : ""
  ].join("\n")
}

function buildRuntimeCommand(runtime: RuntimeName, cwd: string, prompt: string, model?: string | null) {
  if (runtime === "opencode") {
    return { command: "opencode", args: ["run", "--format", "json", ...(model ? ["--model", model] : [])], cwd, input: prompt }
  }
  if (runtime === "codex") {
    return { command: "codex", args: ["exec", "--json", "--cd", cwd, "--sandbox", "workspace-write", prompt], cwd }
  }
  throw new XieZhiError("CLI_USAGE_ERROR", `Agent planning runtime ${runtime} is not supported yet.`, {
    hint: "Use `--runtime opencode` for the first agent-plan path."
  })
}

function extractRuntimeFailure(rawOutput: string) {
  for (const line of rawOutput.split("\n")) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.type !== "error") continue
      const error = parsed.error && typeof parsed.error === "object" ? (parsed.error as Record<string, unknown>) : null
      const data = error?.data && typeof error.data === "object" ? (error.data as Record<string, unknown>) : null
      const message =
        typeof data?.message === "string"
          ? data.message
          : typeof error?.message === "string"
            ? error.message
            : typeof parsed.message === "string"
              ? parsed.message
              : null
      if (message) return message
    } catch {
      // Non-JSON lines are handled below.
    }
  }

  const providerModelMatch = rawOutput.match(/Model not found:[^\n]+/)
  if (providerModelMatch) return providerModelMatch[0]
  const providerMatch = rawOutput.match(/Provider not found:[^\n]+/)
  if (providerMatch) return providerMatch[0]
  const genericMatch = rawOutput.match(/ProviderModelNotFoundError[^\n]*/)
  if (genericMatch) return genericMatch[0]
  return null
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
  subagentRole: string
  parallelGroup: string | null
  handoff: string[]
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

const agentProgressReportV1Schema = z.object({
  version: z.literal("v1"),
  type: z.literal("progress_report"),
  phase: z.enum(["intake", "planning", "decision", "building", "verifying", "reviewing", "promoting", "recovering", "completed", "stalled"]),
  summary: z.string().min(1),
  currentTaskId: z.string().min(1).nullable(),
  executionGroup: z.string().min(1).nullable(),
  subagents: z.array(
    z.object({
      id: z.string().min(1),
      role: z.enum(["supervisor", "implementation", "test", "design", "integration", "review"]),
      taskId: z.string().min(1).nullable(),
      status: z.enum(["planned", "running", "blocked", "completed", "failed"]),
      summary: z.string().min(1)
    })
  ),
  risks: z.array(z.string().min(1)),
  nextAction: z.string().min(1)
})

const agentExecutionPlanV1Schema = z.object({
  version: z.literal("v1"),
  type: z.literal("execution_plan"),
  executionGroups: z.array(
    z.object({
      id: z.string().min(1),
      summary: z.string().min(1),
      tasks: z.array(z.string().min(1)).min(1),
      parallelism: z.number().int().positive(),
      subagents: z.array(
        z.object({
          role: z.enum(["implementation", "test", "design", "review"]),
          taskKey: z.string().min(1),
          reason: z.string().min(1)
        })
      )
    })
  )
})

const supervisorHandoffV1Schema = z.object({
  version: z.literal("v1"),
  type: z.literal("supervisor_handoff"),
  goal: z.string().min(1),
  summary: z.string().min(1),
  assumptions: z.array(z.string().min(1)),
  resolvedDecisions: z.array(z.string().min(1)),
  subagentPlan: z.array(
    z.object({
      id: z.string().min(1),
      role: z.enum(["implementation", "test", "design", "integration", "review"]),
      summary: z.string().min(1),
      suggestedScope: z.array(z.string().min(1))
    })
  ),
  normalizationInstructions: z.array(z.string().min(1)),
  readyToNormalize: z.literal(true)
})

const agentScopeRevisionV1Schema = z.object({
  version: z.literal("v1"),
  type: z.literal("scope_revision"),
  featureId: z.string().min(1),
  taskId: z.string().min(1),
  patchId: z.string().min(1).nullable(),
  reason: z.string().min(1),
  addAllowedFiles: z.array(z.string()).default([]),
  addForbiddenFiles: z.array(z.string()).default([]),
  addChecks: z.array(z.string()).default([]),
  addAcceptance: z.array(z.string()).default([]),
  rationale: z.array(z.string()).default([]),
  action: z.enum(["reverify_patch", "rerun_task"])
})

export type AgentDecisionPointV1 = z.infer<typeof agentDecisionPointV1Schema>
export type ProblemReportV1 = z.infer<typeof problemReportV1Schema>
export type AgentProgressReportV1 = z.infer<typeof agentProgressReportV1Schema>
export type AgentExecutionPlanV1 = z.infer<typeof agentExecutionPlanV1Schema>
export type SupervisorHandoffV1 = z.infer<typeof supervisorHandoffV1Schema>
export type AgentScopeRevisionV1 = z.infer<typeof agentScopeRevisionV1Schema>

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

export type AgentDecisionResolver = (input: {
  agentSessionId: string
  decisionPoint: AgentDecisionPointV1
}) => Promise<string>

type AgentBuildIntakeResult =
  | { type: "plan"; plan: AgentPlanV1 }
  | { type: "decision_point"; decisionPoint: AgentDecisionPointV1 }
  | { type: "problem_report"; problemReport: ProblemReportV1 }
  | { type: "scope_revision"; scopeRevision: AgentScopeRevisionV1 }

type AgentSupervisorIntakeResult =
  | AgentBuildIntakeResult
  | { type: "supervisor_handoff"; handoff: SupervisorHandoffV1 }

function parseAgentBuildIntake(rawOutput: string): AgentBuildIntakeResult {
  for (const candidate of parseJsonCandidates(rawOutput).reverse()) {
    const candidateType = candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>).type : null
    if (candidateType === "progress_report" || candidateType === "execution_plan") {
      continue
    }
    const decisionPoint = agentDecisionPointV1Schema.safeParse(candidate)
    if (decisionPoint.success) {
      return { type: "decision_point", decisionPoint: decisionPoint.data }
    }
    const problemReport = problemReportV1Schema.safeParse(candidate)
    if (problemReport.success) {
      return { type: "problem_report", problemReport: problemReport.data }
    }
    const scopeRevision = agentScopeRevisionV1Schema.safeParse(candidate)
    if (scopeRevision.success) {
      return { type: "scope_revision", scopeRevision: scopeRevision.data }
    }
    const plan = agentPlanV1Schema.safeParse(candidate)
    if (plan.success) {
      return { type: "plan", plan: plan.data }
    }
  }
  throw new XieZhiError("CLI_USAGE_ERROR", "Agent build output did not match AgentPlan, AgentDecisionPoint, ProblemReport, or AgentScopeRevision v1.", {
    hint: "Ask the agent to return exactly one strict JSON object using a supported build-loop schema."
  })
}

function parseAgentSupervisorIntake(rawOutput: string): AgentSupervisorIntakeResult {
  for (const candidate of parseJsonCandidates(rawOutput).reverse()) {
    const candidateType = candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>).type : null
    if (candidateType === "progress_report" || candidateType === "execution_plan") {
      continue
    }
    const handoff = supervisorHandoffV1Schema.safeParse(candidate)
    if (handoff.success) {
      return { type: "supervisor_handoff", handoff: handoff.data }
    }
    const decisionPoint = agentDecisionPointV1Schema.safeParse(candidate)
    if (decisionPoint.success) {
      return { type: "decision_point", decisionPoint: decisionPoint.data }
    }
    const problemReport = problemReportV1Schema.safeParse(candidate)
    if (problemReport.success) {
      return { type: "problem_report", problemReport: problemReport.data }
    }
    const scopeRevision = agentScopeRevisionV1Schema.safeParse(candidate)
    if (scopeRevision.success) {
      return { type: "scope_revision", scopeRevision: scopeRevision.data }
    }
    const plan = agentPlanV1Schema.safeParse(candidate)
    if (plan.success) {
      return { type: "plan", plan: plan.data }
    }
  }
  throw new XieZhiError("CLI_USAGE_ERROR", "Supervisor intake did not include AgentDecisionPoint, SupervisorHandoff, AgentPlan, or ProblemReport v1.", {
    hint: "Ask the supervisor to finish with a parseable SupervisorHandoff v1 object, or a DecisionPoint if user input is required."
  })
}

function extractAgentStructuredEvents(rawOutput: string) {
  const progressReports: AgentProgressReportV1[] = []
  const executionPlans: AgentExecutionPlanV1[] = []
  for (const candidate of parseJsonCandidates(rawOutput)) {
    const progress = agentProgressReportV1Schema.safeParse(candidate)
    if (progress.success) {
      progressReports.push(progress.data)
      continue
    }
    const executionPlan = agentExecutionPlanV1Schema.safeParse(candidate)
    if (executionPlan.success) {
      executionPlans.push(executionPlan.data)
    }
  }
  return { progressReports, executionPlans }
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
    "If the main concern is missing checks, treat validation strictness as a user-facing policy decision unless the session evidence already resolved it; hold and explain that the supervisor should ask or apply the resolved policy.",
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

  private async callAgentRuntime(cwd: string, runtime: RuntimeName, prompt: string, model?: string | null) {
    const availability = await detectRuntimeAvailability(runtime)
    if (!availability.available) {
      throw new XieZhiError("CLI_USAGE_ERROR", `${runtime} is not available for agent build.`, {
        hint: availability.reason ?? `Install ${runtime} and ensure it is on PATH.`
      })
    }
    const commandInput = buildRuntimeCommand(runtime, cwd, prompt, model)
    const result = await execa(commandInput.command, commandInput.args, {
      cwd: commandInput.cwd,
      input: "input" in commandInput ? commandInput.input : undefined,
      reject: false
    })
    const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n")
    const runtimeError = extractRuntimeFailure(rawOutput)
    return {
      exitCode: runtimeError && result.exitCode === 0 ? 1 : result.exitCode,
      rawOutput,
      runtimeError
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

  private recordSyntheticProgress(input: {
    agentSessionId: string
    runtime: RuntimeName
    phase: AgentProgressReportV1["phase"]
    summary: string
    currentTaskId?: string | null
    executionGroup?: string | null
    subagents?: AgentProgressReportV1["subagents"]
    risks?: string[]
    nextAction: string
  }) {
    const progress: AgentProgressReportV1 & { source: "xiezhi_observed" } = {
      version: "v1",
      type: "progress_report",
      phase: input.phase,
      summary: input.summary,
      currentTaskId: input.currentTaskId ?? null,
      executionGroup: input.executionGroup ?? null,
      subagents: input.subagents ?? [],
      risks: input.risks ?? [],
      nextAction: input.nextAction,
      source: "xiezhi_observed"
    }
    this.recordSessionEvent({
      agentSessionId: input.agentSessionId,
      runtime: input.runtime,
      type: "agent_progress_reported",
      summary: input.summary,
      metadata: progress
    })
  }

  private recordRuntimeStructuredEvents(input: { agentSessionId: string; runtime: RuntimeName; rawOutput: string }) {
    const structured = extractAgentStructuredEvents(input.rawOutput)
    for (const progress of structured.progressReports) {
      this.recordSessionEvent({
        agentSessionId: input.agentSessionId,
        runtime: input.runtime,
        type: "agent_progress_reported",
        summary: progress.summary,
        metadata: { ...progress, source: "agent" }
      })
    }
    for (const executionPlan of structured.executionPlans) {
      const totalSubagents = executionPlan.executionGroups.reduce((count, group) => count + group.subagents.length, 0)
      this.recordSessionEvent({
        agentSessionId: input.agentSessionId,
        runtime: input.runtime,
        type: "agent_execution_plan_declared",
        summary: `Agent declared ${executionPlan.executionGroups.length} execution group(s) and ${totalSubagents} subagent(s).`,
        metadata: executionPlan
      })
    }
    return structured
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

  private async normalizeSupervisorHandoff(input: {
    cwd: string
    agentSessionId: string
    runtime: RuntimeName
    model?: string | null
    goal: string
    handoff: SupervisorHandoffV1
    rawSupervisorOutput: string
  }) {
    this.recordSessionEvent({
      agentSessionId: input.agentSessionId,
      runtime: input.runtime,
      type: "normalization_started",
      summary: "Normalizing supervisor handoff into AgentPlan v1.",
      metadata: { handoff: input.handoff }
    })

    let repair: { previousRawOutput: string; error: string; attempt: number } | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const runtimeResult = await this.callAgentRuntime(
        input.cwd,
        input.runtime,
        buildSupervisorNormalizationPrompt({
          goal: input.goal,
          handoff: input.handoff,
          rawSupervisorOutput: input.rawSupervisorOutput,
          schemaRepair: repair
        }),
        input.model
      )
      this.db
        .update(agentSessionsTable)
        .set({ rawAgentOutput: runtimeResult.rawOutput, updatedAt: nowIso() })
        .where(eq(agentSessionsTable.id, input.agentSessionId))
        .run()

      if (runtimeResult.exitCode !== 0) {
        const summary = runtimeResult.runtimeError ?? `Normalization runtime exited with code ${runtimeResult.exitCode}.`
        this.recordSessionEvent({
          agentSessionId: input.agentSessionId,
          runtime: input.runtime,
          type: "normalization_failed",
          summary,
          metadata: {
            problem: "Normalization runtime failed before returning AgentPlan v1.",
            evidence: [runtimeResult.runtimeError ?? runtimeResult.rawOutput.slice(-2000)],
            proposedSolution: "Fix runtime/model configuration and rerun agent build."
          }
        })
        throw new XieZhiError("CLI_USAGE_ERROR", `AgentPlan normalization failed: ${summary}`, {
          hint: runtimeResult.runtimeError?.includes("Model not found")
            ? "Run `opencode models` and pass an exact provider/model id with `--model`."
            : runtimeResult.rawOutput || "Inspect the normalization runtime output."
        })
      }

      try {
        const plan = agentPlanV1Schema.parse(parseJsonCandidate(runtimeResult.rawOutput))
        const imported = this.importBuildPlan({
          cwd: input.cwd,
          agentSessionId: input.agentSessionId,
          runtime: input.runtime,
          rawOutput: runtimeResult.rawOutput,
          plan
        })
        this.recordSessionEvent({
          agentSessionId: input.agentSessionId,
          runtime: input.runtime,
          type: "normalization_completed",
          summary: `Normalized supervisor handoff into feature "${imported.title}" with ${imported.taskCount} task(s).`,
          metadata: { featureId: imported.featureId, taskCount: imported.taskCount, handoff: input.handoff }
        })
        return imported
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        repair = {
          previousRawOutput: runtimeResult.rawOutput,
          error: message,
          attempt: (repair?.attempt ?? 0) + 1
        }
        this.recordSessionEvent({
          agentSessionId: input.agentSessionId,
          runtime: input.runtime,
          type: "normalization_failed",
          summary: "AgentPlan normalization output failed schema validation.",
          metadata: { error: message, rawOutput: runtimeResult.rawOutput.slice(-2000), attempt }
        })
      }
    }

    throw new XieZhiError("CLI_USAGE_ERROR", "AgentPlan normalization failed after schema repair attempts.", {
      hint: "Inspect `xiezhi agent session show` for supervisor handoff and normalization evidence."
    })
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
      subagentRole: getIntentSubagentRole(input.intent),
      parallelGroup: getIntentParallelGroup(input.intent),
      handoff: getIntentHandoff(input.intent),
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

  async plan(cwd: string, goal: string, runtime: RuntimeName, model?: string | null): Promise<AgentPlanCommandResult> {
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
    const commandInput = buildRuntimeCommand(runtime, cwd, prompt, model)
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

  async run(cwd: string, taskId: string, runtime: RuntimeName, model?: string | null): Promise<AgentRunCommandResult> {
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
      taskRun = await new TaskRunService(this.db).runTask(cwd, taskId, runtime, { agentRunId, model })
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

  private async runDeclaredTaskChecks(cwd: string, patchId: string) {
    const patchService = new PatchRecordService(this.db)
    const patch = patchService.getPatch(patchId)
    if (!patch) {
      throw new XieZhiError("CLI_USAGE_ERROR", `Patch ${patchId} was not found while running declared checks.`)
    }

    const task = this.db.select().from(tasksTable).where(eq(tasksTable.id, patch.taskId)).get()
    const intent = safeJsonParse<IntentIr | null>(task?.intentIrJson ?? null, null)
    const commands = uniqueStrings(intent?.recommendedCommands ?? [])
    const existingCommands = new Set(patch.commandLogs.map((log) => log.command))
    const commandsToRun = commands.filter((command) => !existingCommands.has(command))
    if (commandsToRun.length === 0) {
      return []
    }

    const logs: CommandLog[] = []
    for (const command of commandsToRun) {
      const result = await execa(command, {
        cwd: patch.worktreePath,
        shell: true,
        reject: false,
        timeout: 120_000
      })
      logs.push({
        command,
        exitCode: result.exitCode ?? 0,
        output: [result.stdout, result.stderr].filter(Boolean).join("\n")
      })
    }
    patchService.appendCommandLogs(patchId, logs)

    const agentRun = patch.agentRunId ? this.db.select().from(agentRunsTable).where(eq(agentRunsTable.id, patch.agentRunId)).get() : null
    if (agentRun) {
      this.db
        .insert(agentEventsTable)
        .values({
          id: createId(),
          agentRunId: agentRun.id,
          type: "task_checks_executed",
          summary: `Ran ${logs.length} agent-declared check(s).`,
          metadataJson: JSON.stringify({ patchId, commands: logs.map((log) => ({ command: log.command, exitCode: log.exitCode })) }),
          createdAt: nowIso()
        })
        .run()
    }

    return logs
  }

  private applyScopeRevision(revision: AgentScopeRevisionV1, runtime: RuntimeName) {
    for (const filePath of [...revision.addAllowedFiles, ...revision.addForbiddenFiles]) {
      assertSafeScopePath(filePath, "path")
    }

    const task = this.db.select().from(tasksTable).where(eq(tasksTable.id, revision.taskId)).get()
    if (!task) {
      throw new XieZhiError("CLI_USAGE_ERROR", `AgentScopeRevision referenced unknown task ${revision.taskId}.`)
    }
    if (task.featureId !== revision.featureId) {
      throw new XieZhiError("CLI_USAGE_ERROR", "AgentScopeRevision task does not belong to the referenced feature.", {
        hint: "Ask the main agent to revise the task within the active feature DAG."
      })
    }

    let patch: ReturnType<PatchRecordService["getPatch"]> = null
    if (revision.patchId) {
      patch = new PatchRecordService(this.db).getPatch(revision.patchId)
      if (!patch) {
        throw new XieZhiError("CLI_USAGE_ERROR", `AgentScopeRevision referenced unknown patch ${revision.patchId}.`)
      }
      if (patch.taskId !== revision.taskId) {
        throw new XieZhiError("CLI_USAGE_ERROR", "AgentScopeRevision patch does not belong to the referenced task.")
      }
    }

    const intent = safeJsonParse<IntentIr | null>(task.intentIrJson, null)
    const policy = safeJsonParse<ExecutionPolicy | null>(task.policyJson, null)
    if (!intent || !policy) {
      throw new XieZhiError("CLI_USAGE_ERROR", `Task ${revision.taskId} is missing intent/policy metadata.`)
    }

    const revisedIntent: IntentIr =
      intent.version === "v2"
        ? {
            ...intent,
            allowedFiles: uniqueStrings([...intent.allowedFiles, ...revision.addAllowedFiles]),
            forbiddenFiles: uniqueStrings([...intent.forbiddenFiles, ...revision.addForbiddenFiles]),
            acceptance: uniqueStrings([...intent.acceptance, ...revision.addAcceptance]),
            recommendedCommands: uniqueStrings([...intent.recommendedCommands, ...revision.addChecks]),
            rationale: uniqueStrings([...intent.rationale, ...revision.rationale, revision.reason])
          }
        : {
            ...intent,
            allowedFiles: uniqueStrings([...intent.allowedFiles, ...revision.addAllowedFiles]),
            forbiddenFiles: uniqueStrings([...intent.forbiddenFiles, ...revision.addForbiddenFiles]),
            acceptance: uniqueStrings([...intent.acceptance, ...revision.addAcceptance]),
            recommendedCommands: uniqueStrings([...intent.recommendedCommands, ...revision.addChecks]),
            rationale: uniqueStrings([...intent.rationale, ...revision.rationale, revision.reason])
          }
    const revisedPolicy: ExecutionPolicy = {
      ...policy,
      allowedFiles: uniqueStrings([...policy.allowedFiles, ...revision.addAllowedFiles]),
      forbiddenFiles: uniqueStrings([...policy.forbiddenFiles, ...revision.addForbiddenFiles])
    }

    const node = this.db.select().from(dagNodesTable).where(eq(dagNodesTable.id, task.dagNodeId)).get()
    const metadata = safeJsonParse<Record<string, unknown>>(node?.metadataJson ?? null, {})
    const acceptance = Array.isArray(metadata.acceptance) ? metadata.acceptance.filter((value): value is string => typeof value === "string") : []
    const scopeSummary =
      revisedIntent.allowedFiles.length > 0
        ? `${revisedIntent.allowedFiles.length} declared file${revisedIntent.allowedFiles.length === 1 ? "" : "s"}`
        : "verification-only task"

    const updatedAt = nowIso()
    this.db
      .update(tasksTable)
      .set({
        intentIrJson: JSON.stringify(revisedIntent),
        policyJson: JSON.stringify(revisedPolicy),
        status: revision.action === "rerun_task" ? "ready" : task.status,
        updatedAt
      })
      .where(eq(tasksTable.id, revision.taskId))
      .run()
    if (node) {
      this.db
        .update(dagNodesTable)
        .set({
          status: revision.action === "rerun_task" ? "ready" : node.status,
          metadataJson: JSON.stringify({
            ...metadata,
            scopeSummary,
            acceptance: uniqueStrings([...acceptance, ...revision.addAcceptance]),
            scopeRevision: revision
          }),
          updatedAt
        })
        .where(eq(dagNodesTable.id, node.id))
        .run()
    }

    const session = this.db.select().from(agentSessionsTable).where(eq(agentSessionsTable.featureId, task.featureId)).orderBy(desc(agentSessionsTable.createdAt)).get()
    if (session) {
      this.recordSessionEvent({
        agentSessionId: session.id,
        runtime,
        type: "task_scope_revised",
        summary: `Main agent revised scope/check declarations for ${revision.taskId}.`,
        metadata: { revision, patchId: patch?.id ?? null }
      })
    }

    return { task, patch, revisedIntent }
  }

  private async recoverWithScopeRevision(
    cwd: string,
    revision: AgentScopeRevisionV1,
    input: { runtime: RuntimeName; decisionRuntime: RuntimeName; model?: string | null; decisionModel?: string | null }
  ) {
    const { patch } = this.applyScopeRevision(revision, input.runtime)
    if (revision.action === "rerun_task") {
      return {
        recovered: true,
        summary: `Task ${revision.taskId} scope/check declarations were revised and marked ready for rerun.`
      }
    }

    if (!revision.patchId || !patch) {
      throw new XieZhiError("CLI_USAGE_ERROR", "AgentScopeRevision action reverify_patch requires a valid patchId.")
    }

    await this.runDeclaredTaskChecks(cwd, revision.patchId)
    const verify = await verifyPatch(cwd, revision.patchId)
    const review = await reviewPatch(cwd, revision.patchId)
    if (verify.blockingViolations.length > 0) {
      return {
        recovered: false,
        summary: "Scope revision applied, but the patch is still blocked.",
        evidence: {
          verifyStatus: verify.status,
          reviewStatus: review.status,
          blockingViolations: verify.blockingViolations.map((violation) => ({
            type: violation.type,
            message: violation.message
          }))
        }
      }
    }
    if (verify.warnings.length > 0) {
      let parsedDecision: z.infer<typeof promotionDecisionSchema> | null = null
      let rawOutput = ""
      let repair: { previousRawOutput: string; error: string; attempt: number } | undefined
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const commandInput = buildRuntimeCommand(
          input.decisionRuntime,
          cwd,
          buildPromotionDecisionPrompt({
            reviews: [
              {
                patchId: revision.patchId,
                taskId: revision.taskId,
                goal: review.goal,
                changedFiles: review.changedFiles,
                warnings: review.warnings.map((warning) => ({ type: warning.type, message: warning.message })),
                checks: review.checks.map((check) => ({ type: check.type, status: check.status, summary: check.summary })),
                semanticCoverage: review.semanticDiff.semanticCoverage
              }
            ],
            schemaRepair: repair
          }),
          input.decisionModel ?? input.model
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
      const decision = parsedDecision?.decisions.find((candidate) => candidate.patchId === revision.patchId)
      if (decision?.decision === "promote") {
        await promotePatch(cwd, revision.patchId)
        return {
          recovered: true,
          summary: `Scope revision reverified and promotion decision approved patch ${revision.patchId}.`,
          evidence: { verifyStatus: verify.status, reviewStatus: review.status, decision, rawOutput }
        }
      }
      return {
        recovered: false,
        summary: "Scope revision applied, but the patch still has warnings and was held by promotion decision.",
        evidence: {
          verifyStatus: verify.status,
          reviewStatus: review.status,
          warnings: verify.warnings.map((warning) => ({ type: warning.type, message: warning.message })),
          decision: decision ?? null,
          rawOutput
        }
      }
    }

    await promotePatch(cwd, revision.patchId)
    return {
      recovered: true,
      summary: `Scope revision reverified and promoted patch ${revision.patchId}.`,
      evidence: { verifyStatus: verify.status, reviewStatus: review.status }
    }
  }

  async runReady(
    cwd: string,
    input: { featureId?: string; runtime: RuntimeName; parallel: number; auto: boolean; decisionRuntime: RuntimeName; model?: string | null; decisionModel?: string | null }
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

    const taskRuns = await Promise.all(selected.map((task) => runAgentTask(cwd, task.id, input.runtime, input.model)))
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
        const declaredCheckLogs = await this.runDeclaredTaskChecks(cwd, summary.patchId)
        const verify = await verifyPatch(cwd, summary.patchId)
        const review = await reviewPatch(cwd, summary.patchId)
        summary.verifyStatus = verify.status
        summary.reviewStatus = review.status
        if (verify.blockingViolations.length > 0) {
          summary.promotion = "blocked"
          summary.decisionRationale = [
            ...verify.blockingViolations.map((violation) => violation.message),
            ...declaredCheckLogs.filter((log) => log.exitCode !== 0).map((log) => `Declared check failed: ${log.command}`)
          ]
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
            buildPromotionDecisionPrompt({ reviews: warningReviews, schemaRepair: repair }),
            input.decisionModel ?? input.model
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

  async feedback(cwd: string, feedback: string, runtime: RuntimeName, featureId?: string, model?: string | null): Promise<AgentFeedbackResult> {
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
      runtime,
      model
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
      strictPlanFirst?: boolean
      model?: string | null
      decisionModel?: string | null
      decisionResolver?: AgentDecisionResolver
    }
  ): Promise<AgentBuildResult> {
    const reusableSession = input.dryRunPlan ? null : this.findReusableBuildSession(input.goal)
    const agentSessionId = reusableSession?.id ?? this.createAgentSession({ goal: input.goal, runtime: input.runtime })
    this.db.update(agentSessionsTable).set({ status: "running", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
    const decisionPoints: AgentDecisionPointV1[] = []
    const resolvedDecisions: AgentBuildResult["resolvedDecisions"] = []
    const problemReports: ProblemReportV1[] = []
    const waves: AgentRunReadyResult[] = []
    let featureId: string | null = reusableSession?.featureId ?? null
    let schemaRepair: { previousRawOutput: string; error: string; attempt: number } | undefined

    this.recordSyntheticProgress({
      agentSessionId,
      runtime: input.runtime,
      phase: featureId ? "building" : "intake",
      summary: featureId ? "Resuming an existing feature DAG." : "Supervisor exploring goal and repository context.",
      nextAction: featureId ? "Inspect ready tasks and begin automatic build execution." : "Let the supervisor return a decision point or handoff for normalization."
    })

    for (let attempt = 0; !featureId && attempt < 6; attempt += 1) {
      const prompt = input.strictPlanFirst
        ? buildAgentBuildIntakePrompt({
            goal: input.goal,
            resolvedDecisions,
            evidenceSummary: attempt === 0 ? null : { previousDecisionPoints: decisionPoints.map((point) => point.problem) },
            schemaRepair
          })
        : buildAgentSupervisorIntakePrompt({
            goal: input.goal,
            resolvedDecisions,
            evidenceSummary: attempt === 0 ? null : { previousDecisionPoints: decisionPoints.map((point) => point.problem) }
          })
      const runtimeResult = await this.callAgentRuntime(cwd, input.runtime, prompt, input.model)
      const structured = this.recordRuntimeStructuredEvents({ agentSessionId, runtime: input.runtime, rawOutput: runtimeResult.rawOutput })
      if (structured.progressReports.length === 0) {
        this.recordSyntheticProgress({
          agentSessionId,
          runtime: input.runtime,
          phase: schemaRepair ? "recovering" : "planning",
          summary: "Main agent returned build-loop output.",
          risks: runtimeResult.exitCode === 0 ? [] : [`Runtime exited with code ${runtimeResult.exitCode}.`],
          nextAction: "Validate the agent output against XieZhi build-loop schemas."
        })
      }
      this.db
        .update(agentSessionsTable)
        .set({ rawAgentOutput: runtimeResult.rawOutput, updatedAt: nowIso() })
        .where(eq(agentSessionsTable.id, agentSessionId))
        .run()

      if (runtimeResult.exitCode !== 0) {
        this.db.update(agentSessionsTable).set({ status: "failed", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
        throw new XieZhiError("CLI_USAGE_ERROR", runtimeResult.runtimeError ? `Agent build runtime failed: ${runtimeResult.runtimeError}` : `Agent build runtime exited with code ${runtimeResult.exitCode}.`, {
          hint: runtimeResult.runtimeError?.includes("Model not found")
            ? "Run `opencode models` and pass an exact provider/model id with `--model`, for example `--model xiaomi-token-plan-ams/mimo-v2.5-pro`."
            : runtimeResult.rawOutput || "Inspect the runtime configuration and retry agent build."
        })
      }

      let intake: AgentSupervisorIntakeResult
      try {
        intake = input.strictPlanFirst ? parseAgentBuildIntake(runtimeResult.rawOutput) : parseAgentSupervisorIntake(runtimeResult.rawOutput)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.recordSessionEvent({
          agentSessionId,
          runtime: input.runtime,
          type: "agent_problem_reported",
          summary: input.strictPlanFirst ? "Agent build output failed schema validation." : "Supervisor intake did not produce a handoff or decision.",
          metadata: {
            problem: input.strictPlanFirst ? "Agent returned malformed build-loop output." : "Supervisor intake ended without SupervisorHandoff, DecisionPoint, AgentPlan, or ProblemReport.",
            evidence: [message, runtimeResult.rawOutput.slice(-2000)],
            proposedSolution: input.strictPlanFirst
              ? "Ask the main agent to repair its previous output into strict AgentPlan v1, AgentDecisionPoint v1, or ProblemReport v1 JSON."
              : "Ask the supervisor to finish with a parseable SupervisorHandoff v1 object, or a DecisionPoint if user input is required.",
            requiresUserDecision: false,
            attempt: schemaRepair ? schemaRepair.attempt : 0
          }
        })
        if (input.strictPlanFirst && (schemaRepair?.attempt ?? 0) < 2) {
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
          problem: input.strictPlanFirst
            ? "Agent repeatedly returned malformed build-loop output."
            : "Supervisor did not return a handoff, decision point, plan, or problem report.",
          evidence: [message, runtimeResult.rawOutput.slice(-2000)],
          proposedSolution: input.strictPlanFirst
            ? "Rerun agent build after inspecting session evidence, or improve the runtime prompt/schema adherence."
            : "Rerun agent build; the supervisor prompt requires a final SupervisorHandoff v1 before normalization.",
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

      if (intake.type === "supervisor_handoff") {
        this.recordSessionEvent({
          agentSessionId,
          runtime: input.runtime,
          type: "supervisor_handoff",
          summary: intake.handoff.summary,
          metadata: intake.handoff
        })
        const imported = await this.normalizeSupervisorHandoff({
          cwd,
          agentSessionId,
          runtime: input.runtime,
          model: input.model,
          goal: input.goal,
          handoff: intake.handoff,
          rawSupervisorOutput: runtimeResult.rawOutput
        })
        this.recordSyntheticProgress({
          agentSessionId,
          runtime: input.runtime,
          phase: "planning",
          summary: `Imported normalized feature DAG "${imported.title}" with ${imported.taskCount} task(s).`,
          nextAction: input.dryRunPlan ? "Stop after planning because --dry-run-plan is enabled." : "Run the first safe execution group."
        })
        featureId = imported.featureId
        break
      }

      if (intake.type === "decision_point") {
        decisionPoints.push(intake.decisionPoint)
        this.recordSessionEvent({
          agentSessionId,
          runtime: input.runtime,
          type: "decision_point_declared",
          summary: intake.decisionPoint.problem,
          metadata: intake.decisionPoint
        })
        if (!input.assumeDefaults && !input.decisionResolver) {
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
        if (input.decisionResolver) {
          this.db
            .update(agentSessionsTable)
            .set({ status: "waiting_for_decision", updatedAt: nowIso() })
            .where(eq(agentSessionsTable.id, agentSessionId))
            .run()
        }
        const selectedOptionId = input.decisionResolver
          ? await input.decisionResolver({ agentSessionId, decisionPoint: intake.decisionPoint })
          : intake.decisionPoint.defaultIfUnanswered || intake.decisionPoint.recommendedOptionId
        if (input.decisionResolver) {
          this.db
            .update(agentSessionsTable)
            .set({ status: "running", updatedAt: nowIso() })
            .where(eq(agentSessionsTable.id, agentSessionId))
            .run()
        }
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

      if (intake.type === "scope_revision") {
        this.recordSessionEvent({
          agentSessionId,
          runtime: input.runtime,
          type: "agent_problem_reported",
          summary: "Agent returned AgentScopeRevision before a feature DAG existed.",
          metadata: { scopeRevision: intake.scopeRevision }
        })
        continue
      }

      const imported = this.importBuildPlan({
        cwd,
        agentSessionId,
        runtime: input.runtime,
        rawOutput: runtimeResult.rawOutput,
        plan: intake.plan
      })
      this.recordSyntheticProgress({
        agentSessionId,
        runtime: input.runtime,
        phase: "planning",
        summary: `Imported feature DAG "${imported.title}" with ${imported.taskCount} task(s).`,
        nextAction: input.dryRunPlan ? "Stop after planning because --dry-run-plan is enabled." : "Run the first safe execution group."
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
        if (!completed) {
          const evidenceSummary = {
            reason: "The build DAG has no ready tasks but still has blocked or skipped work.",
            currentFeatureId: featureId,
            ready,
            instruction:
              "Solve this automatically as the main agent. Return AgentScopeRevision v1 if the task declaration should be expanded, a recovery AgentPlan v1 with bounded tasks, an AgentDecisionPoint v1 if user choice is required, or a ProblemReport v1 if impossible. If the stall is caused by missing checks and validation/check policy has not been resolved, ask the user for that policy; otherwise plan automatic check execution or fixes."
          }
          this.recordSessionEvent({
            agentSessionId,
            runtime: input.runtime,
            type: "agent_problem_reported",
            summary: "Build DAG stalled without ready tasks.",
            metadata: evidenceSummary
          })
          this.recordSessionEvent({
            agentSessionId,
            runtime: input.runtime,
            type: "agent_solution_proposed",
            summary: "Requesting an automatic recovery plan from the main agent.",
            metadata: evidenceSummary
          })

          let recoveryRepair: { previousRawOutput: string; error: string; attempt: number } | undefined
          let recovered = false
          for (let recoveryAttempt = 0; recoveryAttempt < 3; recoveryAttempt += 1) {
            this.db.update(agentSessionsTable).set({ status: "running", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
            const recoveryRuntimeResult = await this.callAgentRuntime(
              cwd,
              input.runtime,
              buildAgentBuildIntakePrompt({
                goal: input.goal,
                resolvedDecisions,
                evidenceSummary,
                schemaRepair: recoveryRepair
              }),
              input.model
            )
            const recoveryStructured = this.recordRuntimeStructuredEvents({
              agentSessionId,
              runtime: input.runtime,
              rawOutput: recoveryRuntimeResult.rawOutput
            })
            if (recoveryStructured.progressReports.length === 0) {
              this.recordSyntheticProgress({
                agentSessionId,
                runtime: input.runtime,
                phase: "recovering",
                summary: "Main agent returned stalled-DAG recovery output.",
                risks: recoveryRuntimeResult.exitCode === 0 ? [] : [`Runtime exited with code ${recoveryRuntimeResult.exitCode}.`],
                nextAction: "Validate recovery output and continue automatically if it is safe."
              })
            }
            this.db
              .update(agentSessionsTable)
              .set({ rawAgentOutput: recoveryRuntimeResult.rawOutput, updatedAt: nowIso() })
              .where(eq(agentSessionsTable.id, agentSessionId))
              .run()

            if (recoveryRuntimeResult.exitCode !== 0) {
              this.recordSessionEvent({
                agentSessionId,
                runtime: input.runtime,
                type: "agent_problem_reported",
                summary: recoveryRuntimeResult.runtimeError ?? `Recovery runtime exited with code ${recoveryRuntimeResult.exitCode}.`,
                metadata: {
                  problem: "Main agent recovery runtime failed before returning a build-loop object.",
                  evidence: [recoveryRuntimeResult.runtimeError ?? recoveryRuntimeResult.rawOutput.slice(-2000)],
                  proposedSolution: "Fix the runtime/model configuration and rerun agent build.",
                  requiresUserDecision: false
                }
              })
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
                summary: "Stalled-DAG recovery output failed schema validation.",
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
              if (input.assumeDefaults || input.decisionResolver) {
                if (input.decisionResolver) {
                  this.db
                    .update(agentSessionsTable)
                    .set({ status: "waiting_for_decision", updatedAt: nowIso() })
                    .where(eq(agentSessionsTable.id, agentSessionId))
                    .run()
                }
                const selectedOptionId = input.decisionResolver
                  ? await input.decisionResolver({ agentSessionId, decisionPoint: recoveryIntake.decisionPoint })
                  : recoveryIntake.decisionPoint.defaultIfUnanswered || recoveryIntake.decisionPoint.recommendedOptionId
                if (input.decisionResolver) {
                  this.db
                    .update(agentSessionsTable)
                    .set({ status: "running", updatedAt: nowIso() })
                    .where(eq(agentSessionsTable.id, agentSessionId))
                    .run()
                }
                resolvedDecisions.push({ decisionPoint: recoveryIntake.decisionPoint, selectedOptionId })
                this.recordSessionEvent({
                  agentSessionId,
                  runtime: input.runtime,
                  type: "decision_point_resolved",
                  summary: `Selected ${selectedOptionId} for: ${recoveryIntake.decisionPoint.problem}`,
                  metadata: { decisionPoint: recoveryIntake.decisionPoint, selectedOptionId, mode: input.decisionResolver ? "ui" : "assume_defaults" }
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
                nextAction: "Resolve the agent-declared decision point to continue."
              }
            }

            if (recoveryIntake.type === "scope_revision") {
              const scopeRecovery = await this.recoverWithScopeRevision(cwd, recoveryIntake.scopeRevision, {
                runtime: input.runtime,
                decisionRuntime: input.decisionRuntime,
                model: input.model,
                decisionModel: input.decisionModel ?? input.model
              })
              this.recordSessionEvent({
                agentSessionId,
                runtime: input.runtime,
                type: scopeRecovery.recovered ? "agent_solution_proposed" : "agent_problem_reported",
                summary: scopeRecovery.summary,
                metadata: { scopeRevision: recoveryIntake.scopeRevision, result: scopeRecovery }
              })
              recovered = scopeRecovery.recovered
              break
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
        }
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
          nextAction: completed ? "Build DAG completed." : "The build stalled and the main agent did not return a recovery plan."
        }
      }

      this.recordSessionEvent({
        agentSessionId,
        runtime: input.runtime,
        type: "build_wave_started",
        summary: `Execution group ${waveIndex + 1} started with ${ready.readyTasks.length} ready task(s).`,
        metadata: { wave: waveIndex + 1, readyTasks: ready.readyTasks }
      })
      this.recordSyntheticProgress({
        agentSessionId,
        runtime: input.runtime,
        phase: "building",
        summary: `Starting execution group ${waveIndex + 1} with up to ${input.parallel} parallel subagent slot(s).`,
        executionGroup: `group-${waveIndex + 1}`,
        subagents: chooseParallelReadyTasks(ready.readyTasks, Math.max(1, input.parallel)).selected.map((task) => ({
          id: `${waveIndex + 1}:${task.id}`,
          role: task.subagentRole as AgentProgressReportV1["subagents"][number]["role"],
          taskId: task.id,
          status: "planned" as const,
          summary: `${task.title} (${task.parallelGroup ?? "no group"})`
        })),
        risks: chooseParallelReadyTasks(ready.readyTasks, Math.max(1, input.parallel)).skipped.map((task) => `${task.taskId}: ${task.reason}`),
        nextAction: "Run assigned tasks, then verify, review, and promote or recover automatically."
      })
      this.db.update(agentSessionsTable).set({ status: "running", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
      const wave = await this.runReady(cwd, {
        featureId,
        runtime: input.runtime,
        parallel: input.parallel,
        auto: true,
        decisionRuntime: input.decisionRuntime,
        model: input.model,
        decisionModel: input.decisionModel ?? input.model
      })
      waves.push(wave)
      this.recordSessionEvent({
        agentSessionId,
        runtime: input.runtime,
        type: "build_wave_completed",
        summary: `Execution group ${waveIndex + 1} completed with ${wave.runs.length} run(s).`,
        metadata: { wave: waveIndex + 1, result: wave }
      })
      this.recordSyntheticProgress({
        agentSessionId,
        runtime: input.runtime,
        phase: wave.runs.some((run) => run.promotion === "held" || run.promotion === "blocked") ? "recovering" : "promoting",
        summary: `Execution group ${waveIndex + 1} finished: ${wave.runs.length} run(s), ${wave.runs.filter((run) => run.promotion === "promoted").length} promoted.`,
        executionGroup: `group-${waveIndex + 1}`,
        subagents: wave.runs.map((run) => ({
          id: `${waveIndex + 1}:${run.taskId}`,
          role: "implementation",
          taskId: run.taskId,
          status: run.promotion === "promoted" ? "completed" : run.promotion === "blocked" ? "blocked" : "running",
          summary: `Patch ${run.patchId}: ${run.promotion}.`
        })),
        risks: wave.runs.flatMap((run) => (run.promotion === "blocked" || run.promotion === "held" ? run.decisionRationale : [])),
        nextAction: "Continue with the next ready group, or ask the main agent for recovery if anything was held or blocked."
      })

      const heldOrBlocked = wave.runs.filter((run) => run.promotion === "held" || run.promotion === "blocked")
      if (heldOrBlocked.length > 0) {
        const evidenceSummary = {
          reason: "A build wave produced held or blocked patches.",
          currentFeatureId: featureId,
          heldOrBlocked,
          wave,
          instruction:
            "Solve this automatically as the main agent. Return AgentScopeRevision v1 if changed files/checks/acceptance should be declared for the existing task, a recovery AgentPlan v1 with bounded tasks, an AgentDecisionPoint v1 if user choice is required, or a ProblemReport v1 if impossible. If a patch was held because checks are missing and validation/check policy has not been resolved, ask the user for that policy; otherwise plan automatic check execution or fixes."
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
          this.db.update(agentSessionsTable).set({ status: "running", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
          const recoveryRuntimeResult = await this.callAgentRuntime(
            cwd,
            input.runtime,
            buildAgentBuildIntakePrompt({
              goal: input.goal,
              resolvedDecisions,
              evidenceSummary,
              schemaRepair: recoveryRepair
            }),
            input.model
          )
          const recoveryStructured = this.recordRuntimeStructuredEvents({
            agentSessionId,
            runtime: input.runtime,
            rawOutput: recoveryRuntimeResult.rawOutput
          })
          if (recoveryStructured.progressReports.length === 0) {
            this.recordSyntheticProgress({
              agentSessionId,
              runtime: input.runtime,
              phase: "recovering",
              summary: "Main agent returned blocked-patch recovery output.",
              risks: recoveryRuntimeResult.exitCode === 0 ? [] : [`Runtime exited with code ${recoveryRuntimeResult.exitCode}.`],
              nextAction: "Validate recovery output and continue automatically if it is safe."
            })
          }
          this.db
            .update(agentSessionsTable)
            .set({ rawAgentOutput: recoveryRuntimeResult.rawOutput, updatedAt: nowIso() })
            .where(eq(agentSessionsTable.id, agentSessionId))
            .run()

          if (recoveryRuntimeResult.exitCode !== 0) {
            this.recordSessionEvent({
              agentSessionId,
              runtime: input.runtime,
              type: "agent_problem_reported",
              summary: recoveryRuntimeResult.runtimeError ?? `Recovery runtime exited with code ${recoveryRuntimeResult.exitCode}.`,
              metadata: {
                problem: "Main agent recovery runtime failed before returning a build-loop object.",
                evidence: [recoveryRuntimeResult.runtimeError ?? recoveryRuntimeResult.rawOutput.slice(-2000)],
                proposedSolution: "Fix the runtime/model configuration and rerun agent build.",
                requiresUserDecision: false
              }
            })
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
            if (input.assumeDefaults || input.decisionResolver) {
              if (input.decisionResolver) {
                this.db
                  .update(agentSessionsTable)
                  .set({ status: "waiting_for_decision", updatedAt: nowIso() })
                  .where(eq(agentSessionsTable.id, agentSessionId))
                  .run()
              }
              const selectedOptionId = input.decisionResolver
                ? await input.decisionResolver({ agentSessionId, decisionPoint: recoveryIntake.decisionPoint })
                : recoveryIntake.decisionPoint.defaultIfUnanswered || recoveryIntake.decisionPoint.recommendedOptionId
              if (input.decisionResolver) {
                this.db
                  .update(agentSessionsTable)
                  .set({ status: "running", updatedAt: nowIso() })
                  .where(eq(agentSessionsTable.id, agentSessionId))
                  .run()
              }
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

          if (recoveryIntake.type === "scope_revision") {
            const scopeRecovery = await this.recoverWithScopeRevision(cwd, recoveryIntake.scopeRevision, {
              runtime: input.runtime,
              decisionRuntime: input.decisionRuntime,
              model: input.model,
              decisionModel: input.decisionModel ?? input.model
            })
            this.recordSessionEvent({
              agentSessionId,
              runtime: input.runtime,
              type: scopeRecovery.recovered ? "agent_solution_proposed" : "agent_problem_reported",
              summary: scopeRecovery.summary,
              metadata: { scopeRevision: recoveryIntake.scopeRevision, result: scopeRecovery }
            })
            recovered = scopeRecovery.recovered
            break
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

        const readyAfterRecoveryAttempt = getReadyQueue(cwd, featureId)
        if (readyAfterRecoveryAttempt.readyTasks.length > 0) {
          this.recordSessionEvent({
            agentSessionId,
            runtime: input.runtime,
            type: "agent_solution_proposed",
            summary: "Continuing with existing ready tasks after recovery output failed.",
            metadata: {
              reason: "The main agent did not return a valid recovery plan, but the current DAG still has runnable work.",
              readyTasks: readyAfterRecoveryAttempt.readyTasks
            }
          })
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

    this.db.update(agentSessionsTable).set({ status: "stopped", updatedAt: nowIso() }).where(eq(agentSessionsTable.id, agentSessionId)).run()
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

export async function runAgentPlan(cwd: string, goal: string, runtime: RuntimeName, model?: string | null) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new AgentService(drizzle(sqlite, { schema }))
    return await service.plan(cwd, goal, runtime, model)
  } finally {
    sqlite.close()
  }
}

export async function runAgentTask(cwd: string, taskId: string, runtime: RuntimeName, model?: string | null) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new AgentService(drizzle(sqlite, { schema }))
    return await service.run(cwd, taskId, runtime, model)
  } finally {
    sqlite.close()
  }
}

export async function runAgentReadyTasks(
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
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new AgentService(drizzle(sqlite, { schema }))
    return await service.runReady(cwd, input)
  } finally {
    sqlite.close()
  }
}

export async function runAgentFeedback(cwd: string, feedback: string, runtime: RuntimeName, featureId?: string, model?: string | null) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new AgentService(drizzle(sqlite, { schema }))
    return await service.feedback(cwd, feedback, runtime, featureId, model)
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
    strictPlanFirst?: boolean
    model?: string | null
    decisionModel?: string | null
    decisionResolver?: AgentDecisionResolver
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
