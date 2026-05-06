export type RuntimeName = "opencode" | "claude" | "codex"

export type ExecutionPolicy = {
  taskId: string
  allowedFiles: string[]
  forbiddenFiles: string[]
  allowedWriteRoots?: string[]
  allowedTools?: string[]
  envAllowlist?: string[]
  deniedCommands?: string[]
}

export type RuntimeEvent =
  | { id: string; timestamp: string; type: "message"; role: "assistant" | "system"; content: string }
  | { id: string; timestamp: string; type: "tool_call"; toolName: string; input?: unknown }
  | { id: string; timestamp: string; type: "file_edit"; path: string }
  | { id: string; timestamp: string; type: "approval"; status: "requested" | "granted" | "denied"; reason?: string }
  | { id: string; timestamp: string; type: "usage"; inputTokens?: number; outputTokens?: number }
  | { id: string; timestamp: string; type: "error"; message: string }
  | { id: string; timestamp: string; type: "complete"; success: boolean }

export type RunTaskInput = {
  taskId: string
  goal: string
  cwd: string
  runtime: RuntimeName
  runtimeModel?: string | null
  allowedFiles: string[]
  forbiddenFiles: string[]
  acceptance: string[]
  recommendedCommands: string[]
  policy: ExecutionPolicy
}

export type CommandLog = {
  command: string
  exitCode: number
  output: string
}

export type RuntimeUsage = {
  inputTokens: number
  outputTokens: number
}

export type RunTaskResult = {
  taskId: string
  runtime: RuntimeName
  mode?: "real" | "scaffold"
  success: boolean
  changedFiles: string[]
  diff: string
  commandLogs: CommandLog[]
  events: RuntimeEvent[]
  usage?: RuntimeUsage
  modelMessages: Array<{ role: string; content: string }>
  error?: string
}

export interface CodingRuntime {
  name: RuntimeName
  runTask(input: RunTaskInput): Promise<RunTaskResult>
  interruptTask?(taskId: string): Promise<void>
}
