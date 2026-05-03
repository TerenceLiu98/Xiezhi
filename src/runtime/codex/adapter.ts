import type { CompiledExecutionPolicy } from "../../execution/policy-compiler.js"
import type { CliRuntimeDependencies } from "../cli/runtime.js"
import type { RunTaskInput } from "../shared/contracts.js"
import { CliRuntime } from "../cli/runtime.js"

export class CodexRuntime extends CliRuntime {
  constructor(options?: CliRuntimeDependencies) {
    super({
      binary: "codex",
      name: "codex",
      label: "Codex",
      ...options
    })
  }

  protected buildCommand(input: RunTaskInput & { compiledPolicy?: CompiledExecutionPolicy }) {
    return {
      args: [
        "exec",
        "--json",
        "--cd",
        input.cwd,
        "--sandbox",
        "workspace-write"
      ],
      prompt: input.compiledPolicy?.adapterHints.instructions.join("\n"),
      approvalMode: "managed" as const
    }
  }
}
