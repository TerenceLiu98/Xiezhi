import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

import { initializeDefaultConfig } from "../src/config/loader.js"
import { getDatabasePath } from "../src/config/paths.js"
import { XieZhiError } from "../src/core/errors.js"
import { runIndexCommand } from "../src/commands/index.js"
import { createTempGitRepo } from "./support/git-fixture.js"

describe("project initialization guard", () => {
  it("raises a friendly error when config exists but the database was not initialized", async () => {
    const cwd = await createTempGitRepo("xiezhi-uninitialized-")
    await initializeDefaultConfig(cwd)

    const sqlite = new Database(getDatabasePath(cwd))
    sqlite.close()

    await expect(runIndexCommand({ cwd, mode: "full" })).rejects.toMatchObject({
      code: "PROJECT_NOT_INITIALIZED"
    } satisfies Partial<XieZhiError>)
  })
})
