import { ScaffoldRuntime } from "../scaffold/runtime.js"

export class CodexRuntime extends ScaffoldRuntime {
  constructor() {
    super({
      name: "codex",
      label: "Codex"
    })
  }
}
