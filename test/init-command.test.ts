import { access, realpath } from "node:fs/promises"
import path from "node:path"

import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { execa } from "execa"

import { loadProjectConfig } from "../src/config/loader.js"
import { UNBORN_HEAD } from "../src/core/git.js"
import { getConfigPath, getDatabasePath, getXieZhiDir } from "../src/config/paths.js"
import { runInit } from "../src/commands/init.js"
import { createTempDir, createTempGitRepo } from "./support/git-fixture.js"

describe("init command", () => {
  it("creates metadata and bootstraps the sqlite database", async () => {
    const cwd = await createTempGitRepo("xiezhi-init-")
    const normalizedCwd = await realpath(cwd)

    const result = await runInit(cwd)

    await access(path.join(cwd, ".xiezhi"))
    await access(getXieZhiDir(cwd))
    await access(getConfigPath(cwd))
    await access(getDatabasePath(cwd))

    const sqlite = new Database(getDatabasePath(cwd), { readonly: true })
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>
    sqlite.close()

    expect(result.appliedMigrations.length).toBeGreaterThan(0)
    expect(result.repository.rootPath).toBe(normalizedCwd)
    expect(tables.some((table) => table.name === "features")).toBe(true)
    expect(tables.some((table) => table.name === "repositories")).toBe(true)
    expect(tables.some((table) => table.name === "__xiezhi_migrations")).toBe(true)
  })

  it("applies the requested config preset during init", async () => {
    const cwd = await createTempGitRepo("xiezhi-init-preset-")

    const result = await runInit(cwd, { preset: "local-fast" })
    const config = await loadProjectConfig(cwd)

    expect(result.preset).toBe("local-fast")
    expect(config.runtime.default).toBe("claude")
    expect(config.policy.denyCommands).toEqual(["git push", "git commit", "rm -rf *"])
  })

  it("initializes git metadata when run in a plain directory", async () => {
    const cwd = await createTempDir("xiezhi-init-plain-")

    const result = await runInit(cwd)
    const gitTopLevel = await execa("git", ["rev-parse", "--show-toplevel"], { cwd })

    expect(result.createdGitRepository).toBe(true)
    expect(result.repository.rootPath).toBe(await realpath(cwd))
    expect(result.repository.headCommit).toBe(UNBORN_HEAD)
    expect(gitTopLevel.stdout.trim()).toBe(await realpath(cwd))
  })
})
