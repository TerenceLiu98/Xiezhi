import { execa } from "execa"

import type { CompiledExecutionPolicy } from "../../execution/policy-compiler.js"
import { createRuntimeEvent } from "../shared/events.js"
import type {
  CodingRuntime,
  CommandLog,
  RunTaskInput,
  RunTaskResult,
  RuntimeEvent,
  RuntimeName
} from "../shared/contracts.js"
import { detectRuntimeAvailability, type RuntimeAvailability } from "../shared/capabilities.js"
import { ScaffoldRuntime } from "../scaffold/runtime.js"

type CommandRunnerResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type CommandRunner = (input: {
  command: string
  args: string[]
  cwd: string
  input?: string
}) => Promise<CommandRunnerResult>

type CliRuntimeOptions = {
  name: RuntimeName
  label: string
  binary: string
  runner?: CommandRunner
  availabilityResolver?: (runtime: RuntimeName) => Promise<RuntimeAvailability>
}

export type CliRuntimeDependencies = Pick<CliRuntimeOptions, "runner" | "availabilityResolver">

type BuiltRuntimeCommand = {
  args: string[]
  prompt?: string
  approvalMode?: "bypass" | "managed"
  promptMode?: "stdin" | "arg"
}

async function defaultRunner(input: {
  command: string
  args: string[]
  cwd: string
  input?: string
}): Promise<CommandRunnerResult> {
  try {
    const result = await execa(input.command, input.args, {
      cwd: input.cwd,
      input: input.input,
      reject: false
    })
    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout,
      stderr: result.stderr
    }
  } catch (error) {
    const value = error as { exitCode?: number; stdout?: string; stderr?: string; shortMessage?: string }
    return {
      exitCode: value.exitCode ?? 1,
      stdout: value.stdout ?? "",
      stderr: [value.shortMessage, value.stderr].filter(Boolean).join("\n")
    }
  }
}

async function captureChangedFiles(cwd: string) {
  const result = await execa("git", ["diff", "--name-only"], { cwd, reject: false })
  return result.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
}

function buildRuntimePrompt(input: RunTaskInput & { compiledPolicy?: CompiledExecutionPolicy }) {
  return [
    "You are running inside a task-scoped worktree managed by XieZhi.",
    "Treat the current working directory as the only repository root for this task.",
    "Do not read from, write to, copy from, or run commands against the parent repository or sibling .xiezhi/worktrees directories.",
    "Do not use absolute paths outside the current working directory.",
    "Do not commit, merge, promote, or copy files back to the main repository; XieZhi will capture and promote the patch after verification.",
    `Goal: ${input.goal}`,
    `Only edit these files when possible: ${input.allowedFiles.join(", ") || "none"}.`,
    `Do not edit these files: ${input.forbiddenFiles.join(", ") || "none"}.`,
    input.acceptance.length > 0 ? `Acceptance: ${input.acceptance.join(" ")}` : "",
    input.recommendedCommands.length > 0
      ? `When useful, prefer these verification commands: ${input.recommendedCommands.join(", ")}.`
      : "",
    "Make the requested code changes directly in the current repository and finish with a concise summary."
  ]
    .filter(Boolean)
    .join("\n")
}

function extractText(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractText(entry))
  }
  if (!value || typeof value !== "object") {
    return []
  }

  const objectValue = value as Record<string, unknown>
  return [
    ...extractText(objectValue.text),
    ...extractText(objectValue.content),
    ...extractText(objectValue.message),
    ...extractText(objectValue.delta),
    ...extractText(objectValue.output)
  ]
}

function normalizeJsonLine(rawLine: string): RuntimeEvent[] {
  try {
    const parsed = JSON.parse(rawLine) as Record<string, unknown>
    const type = typeof parsed.type === "string" ? parsed.type : "event"
    const events: RuntimeEvent[] = []
    const textParts = extractText(parsed)

    if (type.includes("tool")) {
      events.push(
        createRuntimeEvent<Extract<RuntimeEvent, { type: "tool_call" }>>({
          type: "tool_call",
          toolName:
            typeof parsed.toolName === "string"
              ? parsed.toolName
              : typeof parsed.name === "string"
                ? parsed.name
                : "tool",
          input: parsed.input ?? parsed.arguments ?? parsed
        })
      )
    }

    if (type.includes("error")) {
      events.push(
        createRuntimeEvent<Extract<RuntimeEvent, { type: "error" }>>({
          type: "error",
          message: textParts[0] ?? rawLine
        })
      )
      return events
    }

    if (parsed.usage && typeof parsed.usage === "object") {
      const usage = parsed.usage as Record<string, unknown>
      events.push(
        createRuntimeEvent<Extract<RuntimeEvent, { type: "usage" }>>({
          type: "usage",
          inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
          outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined
        })
      )
    }

    if (textParts.length > 0) {
      events.push(
        createRuntimeEvent<Extract<RuntimeEvent, { type: "message" }>>({
          type: "message",
          role: "assistant",
          content: textParts.join("\n")
        })
      )
    }

    if (type.includes("complete") || type.includes("done") || type.includes("finished")) {
      events.push(
        createRuntimeEvent<Extract<RuntimeEvent, { type: "complete" }>>({
          type: "complete",
          success: true
        })
      )
    }

    return events
  } catch {
    return rawLine.trim()
      ? [
          createRuntimeEvent<Extract<RuntimeEvent, { type: "message" }>>({
            type: "message",
            role: "assistant",
            content: rawLine.trim()
          })
        ]
      : []
  }
}

function normalizeCliOutput(stdout: string, stderr: string, success: boolean) {
  const events = stdout
    .split("\n")
    .flatMap((line) => normalizeJsonLine(line))

  if (events.length === 0 && stdout.trim()) {
    events.push(
      createRuntimeEvent<Extract<RuntimeEvent, { type: "message" }>>({
        type: "message",
        role: "assistant",
        content: stdout.trim()
      })
    )
  }

  if (stderr.trim()) {
    if (success) {
      events.push(
        createRuntimeEvent<Extract<RuntimeEvent, { type: "message" }>>({
          type: "message",
          role: "assistant",
          content: stderr.trim()
        })
      )
    } else {
      events.push(
        createRuntimeEvent<Extract<RuntimeEvent, { type: "error" }>>({
          type: "error",
          message: stderr.trim()
        })
      )
    }
  }

  return events
}

export abstract class CliRuntime implements CodingRuntime {
  readonly name: RuntimeName
  protected readonly label: string
  protected readonly binary: string
  protected readonly runner: CommandRunner
  protected readonly availabilityResolver: (runtime: RuntimeName) => Promise<RuntimeAvailability>

  constructor(options: CliRuntimeOptions) {
    this.name = options.name
    this.label = options.label
    this.binary = options.binary
    this.runner = options.runner ?? defaultRunner
    this.availabilityResolver = options.availabilityResolver ?? detectRuntimeAvailability
  }

  protected createScaffoldFallback(reason: string) {
    return new ScaffoldRuntime({
      name: this.name,
      label: `${this.label} (fallback)`
    })
  }

  protected abstract buildCommand(
    input: RunTaskInput & { compiledPolicy?: CompiledExecutionPolicy }
  ): BuiltRuntimeCommand

  async runTask(input: RunTaskInput & { compiledPolicy?: CompiledExecutionPolicy }): Promise<RunTaskResult> {
    const availability = await this.availabilityResolver(this.name)
    if (!availability.available) {
      return this.createScaffoldFallback(availability.reason ?? `${this.binary} unavailable`).runTask(input)
    }

    const built = this.buildCommand(input)
    const prompt = built.prompt ?? buildRuntimePrompt(input)
    const args = [...built.args]
    const promptInput = built.promptMode === "arg" ? undefined : prompt
    if (built.promptMode === "arg" && prompt) {
      args.push(prompt)
    }
    const commandLine = [this.binary, ...args].join(" ")
    const result = await this.runner({
      command: this.binary,
      args,
      cwd: input.cwd,
      input: promptInput
    })

    const changedFiles = await captureChangedFiles(input.cwd)
    const events = [
      createRuntimeEvent({
        type: "approval",
        status: built.approvalMode === "bypass" ? "granted" : "requested",
        reason:
          built.approvalMode === "bypass"
            ? `${this.label} executed with automatic permissions in the isolated task worktree.`
            : `${this.label} execution may require external approvals.`
      } as Extract<RuntimeEvent, { type: "approval" }>),
      ...normalizeCliOutput(result.stdout, result.stderr, result.exitCode === 0),
      ...changedFiles.map((filePath) =>
        createRuntimeEvent<Extract<RuntimeEvent, { type: "file_edit" }>>({
          type: "file_edit",
          path: filePath
        })
      ),
      createRuntimeEvent<Extract<RuntimeEvent, { type: "complete" }>>({
        type: "complete",
        success: result.exitCode === 0
      })
    ]

    const outputSummary = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n")

    return {
      taskId: input.taskId,
      runtime: this.name,
      mode: "real",
      success: result.exitCode === 0,
      changedFiles,
      diff: "",
      commandLogs: [
        {
          command: commandLine,
          exitCode: result.exitCode,
          output: outputSummary || `${this.label} produced no terminal output.`
        }
      ],
      events,
      modelMessages: events
        .filter((event): event is Extract<RuntimeEvent, { type: "message" }> => event.type === "message")
        .map((event) => ({
          role: event.role,
          content: event.content
        })),
      error: result.exitCode === 0 ? undefined : outputSummary || `${this.label} exited with code ${result.exitCode}.`
    }
  }
}
