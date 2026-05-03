import { describe, expect, it } from "vitest"

import { runInit } from "../src/commands/init.js"
import { openDatabaseConnection } from "../src/db/client.js"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "../src/db/schema.js"
import { PatchRecordService } from "../src/services/patch-record-service.js"
import { createTempGitRepo } from "./support/git-fixture.js"

describe("patch record service", () => {
  it("stores patch metadata and command logs", async () => {
    const cwd = await createTempGitRepo("xiezhi-patch-")
    const initResult = await runInit(cwd)

    const sqlite = openDatabaseConnection(cwd)
    try {
      const service = new PatchRecordService(drizzle(sqlite, { schema }))
      const patchId = service.createPatch({
        taskId: "task.demo",
        baseCommit: initResult.repository.headCommit,
        worktreePath: `${cwd}/.xiezhi/worktrees/task-demo`,
        runtimeName: "opencode",
        changedFiles: ["README.md"],
        diff: "diff --git a/README.md b/README.md"
      })

      service.appendCommandLogs(patchId, [
        {
          command: "pnpm test",
          exitCode: 0,
          output: "ok"
        }
      ])
      service.updatePatchStatus(patchId, "verified")

      const stored = service.getPatch(patchId)

      expect(stored?.runtimeName).toBe("opencode")
      expect(stored?.changedFiles).toEqual(["README.md"])
      expect(stored?.commandLogs).toHaveLength(1)
      expect(stored?.status).toBe("verified")
    } finally {
      sqlite.close()
    }
  })
})
