import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { capturePatchState } from "../src/services/patch-state.js"
import { createTempGitRepo } from "./support/git-fixture.js"

describe("patch state capture", () => {
  it("captures tracked changes and untracked files", async () => {
    const cwd = await createTempGitRepo("xiezhi-patch-state-")
    await writeFile(path.join(cwd, "README.md"), "# Changed\n", "utf8")
    await writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "demo" }, null, 2), "utf8")
    await writeFile(path.join(cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }, null, 2), "utf8")
    await mkdir(path.join(cwd, "node_modules"), { recursive: true })
    await writeFile(path.join(cwd, "node_modules", "ignored.js"), "module.exports = true\n", "utf8")

    const patch = await capturePatchState(cwd)

    expect(patch.changedFiles).toEqual(expect.arrayContaining(["README.md", "package.json"]))
    expect(patch.changedFiles).not.toContain("node_modules/ignored.js")
    expect(patch.changedFiles).toContain("package-lock.json")
    expect(patch.diff).toContain("README.md")
    expect(patch.diff).toContain("package.json")
    expect(patch.diff).toContain("\"name\": \"demo\"")
  })

  it("ignores install-only package locks when the manifest did not change", async () => {
    const cwd = await createTempGitRepo("xiezhi-patch-state-")
    await writeFile(path.join(cwd, "README.md"), "# Changed\n", "utf8")
    await writeFile(path.join(cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }, null, 2), "utf8")

    const patch = await capturePatchState(cwd)

    expect(patch.changedFiles).toEqual(["README.md"])
    expect(patch.diff).toContain("README.md")
    expect(patch.diff).not.toContain("package-lock.json")
  })
})
