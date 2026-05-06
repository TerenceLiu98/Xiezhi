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
      hint: "Re-run `xiezhi agent plan` so the task has compiled Intent IR before execution."
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
        ...(input.intent.summary ? [`Summary: ${input.intent.summary}`] : []),
        `Stay within allowed files: ${allowedFiles.join(", ") || "none"}.`,
        `Avoid forbidden files: ${forbiddenFiles.join(", ") || "none"}.`,
        "You are already inside the isolated task worktree. Treat the current working directory as the repository root for this task.",
        "Do not read from, write to, copy from, or run commands against the parent repository path or any sibling .xiezhi/worktrees directory.",
        "Do not use absolute paths outside the current working directory. If you need prior context, use only files already present in this worktree and the task contract.",
        "Do not commit, merge, promote, or copy files back to the main repository. XieZhi captures the patch from this worktree and promotes it after verification.",
        "Do not create, edit, install, format, or regenerate files outside the allowed file list.",
        "If a command would create lockfiles, build artifacts, or other files outside the allowed scope, skip that command and explain it in your final summary.",
        ...(input.intent.relatedSymbols.length > 0
          ? [`Relevant symbols: ${input.intent.relatedSymbols.join(", ")}.`]
          : []),
        ...("allowedSymbols" in input.intent && input.intent.allowedSymbols.length > 0
          ? [`Allowed symbols: ${input.intent.allowedSymbols.join(", ")}.`]
          : []),
        ...("forbiddenSymbols" in input.intent && input.intent.forbiddenSymbols.length > 0
          ? [`Forbidden symbols: ${input.intent.forbiddenSymbols.join(", ")}.`]
          : []),
        "Acceptance criteria:",
        ...(input.intent.acceptance.length > 0 ? input.intent.acceptance.map((criterion) => `- ${criterion}`) : ["- None recorded."]),
        ...("expectedOutputs" in input.intent && input.intent.expectedOutputs.length > 0
          ? ["Expected outputs:", ...input.intent.expectedOutputs.map((output) => `- ${output}`)]
          : []),
        ...(input.intent.recommendedCommands.length > 0
          ? ["Recommended checks:", ...input.intent.recommendedCommands.map((command) => `- ${command}`)]
          : [])
      ],
      allowedPaths: allowedFiles,
      verificationCommands: input.intent.recommendedCommands
    }
  } satisfies CompiledExecutionPolicy
}
