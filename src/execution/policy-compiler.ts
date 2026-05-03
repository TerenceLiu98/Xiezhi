import { XieZhiError } from "../core/errors.js"
import type { ExecutionPolicy, RuntimeName } from "../runtime/shared/contracts.js"
import type { IntentIr } from "../planning/types.js"

export type CompiledExecutionPolicy = {
  runtime: RuntimeName
  taskId: string
  goal: string
  policy: ExecutionPolicy
  adapterHints: {
    instructions: string[]
    allowedPaths: string[]
    verificationCommands: string[]
  }
}

function unique(values: string[]) {
  return [...new Set(values)]
}

export function compileExecutionPolicy(input: {
  runtime: RuntimeName
  policy: ExecutionPolicy | null
  intent: IntentIr | null
}) {
  if (!input.policy || !input.intent) {
    throw new XieZhiError("CLI_USAGE_ERROR", "Task is missing policy or intent metadata.", {
      hint: "Re-run `xz plan` so the task has compiled Intent IR before execution."
    })
  }

  const allowedFiles = unique(
    [...input.policy.allowedFiles, ...input.intent.allowedFiles].filter((value) => Boolean(value))
  )
  const forbiddenFiles = unique(
    [...input.policy.forbiddenFiles, ...input.intent.forbiddenFiles].filter((value) => Boolean(value))
  )

  return {
    runtime: input.runtime,
    taskId: input.policy.taskId,
    goal: input.intent.goal,
    policy: {
      ...input.policy,
      allowedFiles,
      forbiddenFiles,
      allowedWriteRoots: input.policy.allowedWriteRoots ?? ["."],
      allowedTools: input.policy.allowedTools ?? ["read", "edit", "bash"],
      envAllowlist: input.policy.envAllowlist ?? [],
      deniedCommands: input.policy.deniedCommands ?? ["git reset --hard", "git checkout --"]
    },
    adapterHints: {
      instructions: [
        `Goal: ${input.intent.goal}`,
        `Stay within allowed files: ${allowedFiles.join(", ") || "none"}.`,
        `Avoid forbidden files: ${forbiddenFiles.join(", ") || "none"}.`
      ],
      allowedPaths: allowedFiles,
      verificationCommands: input.intent.recommendedCommands
    }
  } satisfies CompiledExecutionPolicy
}
