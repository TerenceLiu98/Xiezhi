import { realpath } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import { runInit } from "../src/commands/init.js"
import { openDatabaseConnection } from "../src/db/client.js"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "../src/db/schema.js"
import { RepositoryMetadataService } from "../src/services/repository-metadata-service.js"
import { createTempGitRepo } from "./support/git-fixture.js"

describe("repository metadata service", () => {
  it("persists repository metadata and can read it back", async () => {
    const cwd = await createTempGitRepo("xiezhi-repo-")
    const normalizedCwd = await realpath(cwd)
    await runInit(cwd)

    const sqlite = openDatabaseConnection(cwd)
    try {
      const service = new RepositoryMetadataService(drizzle(sqlite, { schema }))
      const metadata = await service.refreshForCwd(cwd)
      const stored = service.getById(metadata.id)

      expect(metadata.packageManager).toBe("pnpm")
      expect(metadata.headCommit.length).toBeGreaterThan(0)
      expect(stored?.rootPath).toBe(normalizedCwd)
    } finally {
      sqlite.close()
    }
  })
})
