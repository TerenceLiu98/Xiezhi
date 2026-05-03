import { describe, expect, it } from "vitest"

import { runIndexCommand } from "../src/commands/index.js"
import { runInit } from "../src/commands/init.js"
import { runTaskRunCommand } from "../src/commands/task.js"
import { openDatabaseConnection } from "../src/db/client.js"
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
})
