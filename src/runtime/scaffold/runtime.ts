import { execa } from "execa"

import type { CompiledExecutionPolicy } from "../../execution/policy-compiler.js"
import { createRuntimeEvent } from "../shared/events.js"
import type { CodingRuntime, CommandLog, RunTaskInput, RunTaskResult, RuntimeName } from "../shared/contracts.js"
import { normalizeOpencodeEvent } from "../opencode/normalizer.js"

async function runShellCommand(command: string, cwd: string): Promise<CommandLog> {
  try {
    const result = await execa(command, { cwd, shell: true })
    return {
      command,
      exitCode: result.exitCode ?? 0,
      output: [result.stdout, result.stderr].filter(Boolean).join("\n")
    }
  } catch (error) {
    const result = error as { shortMessage?: string; stdout?: string; stderr?: string; exitCode?: number }
    return {
      command,
      exitCode: result.exitCode ?? 1,
      output: [result.shortMessage, result.stdout, result.stderr].filter(Boolean).join("\n")
    }
  }
}

type ScaffoldRuntimeOptions = {
  name: RuntimeName
  label: string
}

export class ScaffoldRuntime implements CodingRuntime {
  readonly name: RuntimeName
  private readonly label: string

  constructor(options: ScaffoldRuntimeOptions) {
    this.name = options.name
    this.label = options.label
  }

  async runTask(input: RunTaskInput & { compiledPolicy?: CompiledExecutionPolicy }): Promise<RunTaskResult> {
    const messages = [
      `${this.label} adapter is running in scaffold mode for task ${input.taskId}.`,
      `Goal: ${input.goal}`,
      `Allowed files: ${input.allowedFiles.join(", ") || "none"}.`
    ]
    const events = [
      createRuntimeEvent<Extract<RunTaskResult["events"][number], { type: "message" }>>({
        type: "message",
        role: "system",
        content: `${this.label} adapter started.`
      }),
      normalizeOpencodeEvent({
        type: "assistant",
        content: messages.join(" ")
      }),
      normalizeOpencodeEvent({
        type: "tool",
        toolName: "compile_execution_policy",
        input: input.compiledPolicy ?? input.policy
      })
    ]

    const commandLogs = await Promise.all([
      runShellCommand("git status --short", input.cwd),
      runShellCommand("git diff --stat", input.cwd)
    ])

    events.push(
      normalizeOpencodeEvent({
        type: "usage",
        inputTokens: Math.max(32, input.goal.length),
        outputTokens: Math.max(48, messages.join(" ").length)
      })
    )
    events.push(normalizeOpencodeEvent({ type: "complete", success: true }))

    return {
      taskId: input.taskId,
      runtime: this.name,
      success: true,
      changedFiles: [],
      diff: "",
      commandLogs,
      events,
      usage: {
        inputTokens: Math.max(32, input.goal.length),
        outputTokens: Math.max(48, messages.join(" ").length)
      },
      modelMessages: [
        { role: "system", content: `${this.label} adapter started.` },
        { role: "assistant", content: messages.join(" ") }
      ]
    }
  }
}
