import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { initializeDefaultConfig, loadProjectConfig } from "../src/config/loader.js"
import { getConfigPath } from "../src/config/paths.js"

describe("config loader", () => {
  it("creates and loads a default config", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "xiezhi-config-"))

    const config = await initializeDefaultConfig(cwd)
    const loaded = await loadProjectConfig(cwd)
    const source = await readFile(getConfigPath(cwd), "utf8")

    expect(config.project.name).toBe(path.basename(cwd))
    expect(loaded.runtime.default).toBe("opencode")
    expect(source).toContain("defaultWriteMode")
  })
})
