import { access } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import { WorktreeManager } from "../src/git/worktree-manager.js"
import { createTempGitRepo } from "./support/git-fixture.js"

async function pathExists(targetPath: string) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

describe("worktree manager", () => {
  it("creates, lists, and removes a task worktree", async () => {
    const cwd = await createTempGitRepo("xiezhi-worktree-")
    const manager = new WorktreeManager()

    const worktree = await manager.createTaskWorktree({
      repoRoot: cwd,
      taskId: "task.demo"
    })

    const listed = await manager.listWorktrees(cwd)
    expect(await pathExists(worktree.path)).toBe(true)
    expect(listed.some((entry) => entry.path === worktree.path)).toBe(true)

    await manager.removeWorktree(worktree.path, cwd)

    expect(await pathExists(worktree.path)).toBe(false)
  }, 15000)
})
