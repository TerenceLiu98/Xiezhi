import { writeFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { runIndexCommand } from "../src/commands/index.js"
import { runInit } from "../src/commands/init.js"
import { openDatabaseConnection } from "../src/db/client.js"
import { createTempJsRepo, createTempPythonRepo, createTempTsRepo } from "./support/git-fixture.js"

describe("index command", () => {
  it("indexes a TypeScript repo and persists code graph records", async () => {
    const cwd = await createTempTsRepo("xiezhi-index-")
    await runInit(cwd)

    const result = await runIndexCommand({ cwd, mode: "full" })

    const sqlite = openDatabaseConnection(cwd)
    try {
      const codeNodeCount = sqlite.prepare("SELECT COUNT(*) as count FROM code_nodes").get() as {
        count: number
      }
      const codeEdgeCount = sqlite.prepare("SELECT COUNT(*) as count FROM code_edges").get() as {
        count: number
      }

      expect(result.status).toBe("indexed")
      expect(result.summary.files).toBeGreaterThan(0)
      expect(result.summary.functions).toBeGreaterThan(0)
      expect(result.summary.routes).toBeGreaterThan(0)
      expect(result.summary.tests).toBeGreaterThan(0)
      expect(result.summary.edges).toBeGreaterThan(0)
      expect(codeNodeCount.count).toBeGreaterThan(0)
      expect(codeEdgeCount.count).toBeGreaterThan(0)
    } finally {
      sqlite.close()
    }
  }, 15000)

  it("supports incremental indexing for changed files", async () => {
    const cwd = await createTempTsRepo("xiezhi-index-incremental-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })

    await writeFile(
      path.join(cwd, "src", "router.tsx"),
      [
        "export interface User {",
        "  id: string",
        "}",
        "",
        "export type UserRole = 'admin' | 'member'",
        "",
        "export function getUser(id: string) {",
        "  return { id }",
        "}",
        "",
        "export function listUsers() {",
        "  return []",
        "}",
        "",
        "router.get('/users', getUser)"
      ].join("\n"),
      "utf8"
    )

    const result = await runIndexCommand({ cwd, mode: "incremental" })

    expect(result.executedMode).toBe("incremental")
    expect(result.indexedPaths).toContain("src/router.tsx")
    expect(result.summary.functions).toBeGreaterThan(0)
  }, 15000)

  it("supports incremental indexing for untracked files", async () => {
    const cwd = await createTempTsRepo("xiezhi-index-untracked-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })

    await writeFile(
      path.join(cwd, "src", "new-file.ts"),
      ["export function helper() {", "  return 1", "}"].join("\n"),
      "utf8"
    )

    const result = await runIndexCommand({ cwd, mode: "incremental" })

    expect(result.executedMode).toBe("incremental")
    expect(result.indexedPaths).toContain("src/new-file.ts")
    expect(result.summary.files).toBe(1)
  }, 15000)

  it("indexes JavaScript and JSX repositories", async () => {
    const cwd = await createTempJsRepo("xiezhi-index-js-")
    await runInit(cwd)

    const result = await runIndexCommand({ cwd, mode: "full" })

    expect(result.summary.files).toBeGreaterThan(0)
    expect(result.summary.functions).toBeGreaterThan(0)
    expect(result.summary.classes).toBeGreaterThan(0)
    expect(result.summary.components).toBeGreaterThan(0)
    expect(result.summary.routes).toBeGreaterThan(0)
    expect(result.summary.tests).toBeGreaterThan(0)
  }, 15000)

  it("indexes Python functions, classes, methods, and tests", async () => {
    const cwd = await createTempPythonRepo("xiezhi-index-python-")
    await runInit(cwd)

    const result = await runIndexCommand({ cwd, mode: "full" })

    const sqlite = openDatabaseConnection(cwd)
    try {
      const methodCount = sqlite.prepare("SELECT COUNT(*) as count FROM code_nodes WHERE kind = 'method'").get() as { count: number }
      expect(result.summary.files).toBeGreaterThan(0)
      expect(result.summary.functions).toBeGreaterThan(0)
      expect(result.summary.classes).toBeGreaterThan(0)
      expect(result.summary.tests).toBeGreaterThan(0)
      expect(methodCount.count).toBeGreaterThan(0)
    } finally {
      sqlite.close()
    }
  }, 15000)

  it("supports incremental indexing for changed Python files", async () => {
    const cwd = await createTempPythonRepo("xiezhi-index-python-incremental-")
    await runInit(cwd)
    await runIndexCommand({ cwd, mode: "full" })
    await writeFile(path.join(cwd, "src", "extra.py"), ["def extra():", "    return 1"].join("\n"), "utf8")

    const result = await runIndexCommand({ cwd, mode: "incremental" })

    expect(result.executedMode).toBe("incremental")
    expect(result.indexedPaths).toContain("src/extra.py")
    expect(result.summary.functions).toBe(1)
  }, 15000)
})
