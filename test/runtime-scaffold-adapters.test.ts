import { describe, expect, it } from "vitest"

import { runIndexCommand } from "../src/commands/index.js"
import { runInit } from "../src/commands/init.js"
import { runTaskRunCommand } from "../src/commands/task.js"
import { openDatabaseConnection } from "../src/db/client.js"
import { OpenCodeRuntime } from "../src/runtime/opencode/adapter.js"
import { importRouterPlan } from "./support/agent-plan-fixture.js"
import { createTempTsRepo } from "./support/git-fixture.js"

describe("scaffold runtimes", () => {
  it("supports claude and codex scaffold task runs", async () => {
    const cwd = await createTempTsRepo("xiezhi-runtimes-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    const plan = importRouterPlan(cwd)
    const taskId = plan.tasks[0]!.id

    const claudeRun = await runTaskRunCommand(cwd, taskId, "claude")
    const codexRun = await runTaskRunCommand(cwd, taskId, "codex")

    expect(claudeRun.runtime).toBe("claude")
    expect(codexRun.runtime).toBe("codex")
    expect(claudeRun.mode).toBe("scaffold")
    expect(codexRun.mode).toBe("scaffold")

    const sqlite = openDatabaseConnection(cwd)
    try {
      const runtimes = sqlite
        .prepare("SELECT runtime_name FROM patches ORDER BY created_at")
        .all() as Array<{ runtime_name: string }>

      expect(runtimes.map((row) => row.runtime_name)).toEqual(["claude", "codex"])
    } finally {
      sqlite.close()
    }
  }, 20000)

  it("passes an OpenCode provider/model override to the CLI runtime", async () => {
    const cwd = await createTempTsRepo("xiezhi-opencode-model-")
    const calls: Array<{ args: string[]; input?: string }> = []
    const runtime = new OpenCodeRuntime({
      availabilityResolver: async () => ({ runtime: "opencode", binary: "opencode", available: true }),
      runner: async (input) => {
        calls.push({ args: input.args, input: input.input })
        return { exitCode: 0, stdout: JSON.stringify({ type: "complete", text: "done" }), stderr: "" }
      }
    })

    await runtime.runTask({
      taskId: "task-1",
      goal: "use selected model",
      cwd,
      runtime: "opencode",
      runtimeModel: "anthropic/claude-sonnet-4-5",
      allowedFiles: ["src/router.tsx"],
      forbiddenFiles: [".xiezhi/"],
      acceptance: ["done"],
      recommendedCommands: [],
      policy: { taskId: "task-1", allowedFiles: ["src/router.tsx"], forbiddenFiles: [".xiezhi/"] }
    })

    expect(calls[0]?.args).toEqual([
      "run",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "--model",
      "anthropic/claude-sonnet-4-5"
    ])
    expect(calls[0]?.input).toContain("Do not read from, write to, copy from, or run commands against the parent repository")
  })
})
