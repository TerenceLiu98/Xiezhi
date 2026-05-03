import type { CompiledExecutionPolicy } from "../../execution/policy-compiler.js"
import type { CliRuntimeDependencies } from "../cli/runtime.js"
import type { RunTaskInput } from "../shared/contracts.js"
import { CliRuntime } from "../cli/runtime.js"

export class ClaudeRuntime extends CliRuntime {
  constructor(options?: CliRuntimeDependencies) {
    super({
      binary: "claude",
      name: "claude",
      label: "Claude",
      ...options
    })
  }

  protected buildCommand(input: RunTaskInput & { compiledPolicy?: CompiledExecutionPolicy }) {
    return {
      args: [
        "-p",
        "--output-format",
        "stream-json",
        "--permission-mode",
        "bypassPermissions",
        "--add-dir",
        input.cwd
      ],
      prompt: input.compiledPolicy?.adapterHints.instructions.join("\n"),
      approvalMode: "bypass" as const,
      promptMode: "arg" as const
    }
  }
}
