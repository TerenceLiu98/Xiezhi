import { ScaffoldRuntime } from "../scaffold/runtime.js"

export class ClaudeRuntime extends ScaffoldRuntime {
  constructor() {
    super({
      name: "claude",
      label: "Claude"
    })
  }
}
