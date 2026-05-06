import type { CompiledExecutionPolicy } from "../../execution/policy-compiler.js"
import type { CliRuntimeDependencies } from "../cli/runtime.js"
import type { RunTaskInput } from "../shared/contracts.js"
import { CliRuntime } from "../cli/runtime.js"

export class OpenCodeRuntime extends CliRuntime {
  constructor(options?: CliRuntimeDependencies) {
    super({
      binary: "opencode",
      name: "opencode",
      label: "OpenCode",
      ...options
    })
  }

  protected buildCommand(input: RunTaskInput & { compiledPolicy?: CompiledExecutionPolicy }) {
    return {
      args: [
        "run",
        "--format",
        "json",
        "--dangerously-skip-permissions",
        ...(input.runtimeModel ? ["--model", input.runtimeModel] : [])
      ],
      prompt: input.compiledPolicy?.adapterHints.instructions.join("\n"),
      approvalMode: "bypass" as const
    }
  }
}
