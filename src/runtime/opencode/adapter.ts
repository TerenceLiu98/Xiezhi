import { ScaffoldRuntime } from "../scaffold/runtime.js"

export class OpenCodeRuntime extends ScaffoldRuntime {
  constructor() {
    super({
      name: "opencode",
      label: "OpenCode"
    })
  }
}
