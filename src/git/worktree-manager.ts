import { existsSync } from "node:fs"
import { mkdir, realpath } from "node:fs/promises"
import path from "node:path"

import { getXieZhiDir } from "../config/paths.js"
import { runGit } from "../core/git.js"
import { XieZhiError } from "../core/errors.js"

export type ManagedWorktree = {
  taskId: string
  path: string
  baseCommit: string
  headCommit: string
}

function sanitizeTaskId(taskId: string) {
  return taskId.replace(/[^a-zA-Z0-9._-]+/g, "-")
}

export class WorktreeManager {
  async createTaskWorktree(input: {
    repoRoot: string
    taskId: string
    baseCommit?: string
    replaceExisting?: boolean
  }): Promise<ManagedWorktree> {
    const repoRoot = await realpath(input.repoRoot)
    const baseCommit =
      input.baseCommit ?? (await runGit(["rev-parse", "HEAD"], repoRoot)).stdout.trim()
    const worktreesRoot = path.join(getXieZhiDir(repoRoot), "worktrees")
    const worktreePath = path.join(worktreesRoot, sanitizeTaskId(input.taskId))

    await mkdir(worktreesRoot, { recursive: true })

    if (existsSync(worktreePath)) {
      if (!input.replaceExisting) {
        throw new XieZhiError("GIT_ERROR", `Worktree already exists for task ${input.taskId}.`, {
          hint: "Remove the existing worktree first or retry with replacement enabled."
        })
      }

      await this.removeWorktree(worktreePath, repoRoot)
    }

    await runGit(["worktree", "add", "--detach", worktreePath, baseCommit], repoRoot)
    const normalizedPath = await realpath(worktreePath)
    const headCommit = (await runGit(["rev-parse", "HEAD"], normalizedPath)).stdout.trim()

    return {
      taskId: input.taskId,
      path: normalizedPath,
      baseCommit,
      headCommit
    }
  }

  async inspectWorktree(worktreePath: string): Promise<ManagedWorktree | null> {
    if (!existsSync(worktreePath)) {
      return null
    }

    const headCommit = (await runGit(["rev-parse", "HEAD"], worktreePath)).stdout.trim()
    const taskId = path.basename(worktreePath)

    return {
      taskId,
      path: worktreePath,
      baseCommit: headCommit,
      headCommit
    }
  }

  async listWorktrees(repoRoot: string) {
    const normalizedRoot = await realpath(repoRoot)
    const result = await runGit(["worktree", "list", "--porcelain"], normalizedRoot)
    const lines = result.stdout.split("\n")
    const worktrees: Array<{ path: string; headCommit: string; branch: string | null }> = []

    let currentPath: string | null = null
    let currentHead = ""
    let currentBranch: string | null = null

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        if (currentPath) {
          worktrees.push({
            path: currentPath,
            headCommit: currentHead,
            branch: currentBranch
          })
        }
        currentPath = line.slice("worktree ".length)
        currentHead = ""
        currentBranch = null
      } else if (line.startsWith("HEAD ")) {
        currentHead = line.slice("HEAD ".length)
      } else if (line.startsWith("branch ")) {
        currentBranch = line.slice("branch ".length)
      }
    }

    if (currentPath) {
      worktrees.push({ path: currentPath, headCommit: currentHead, branch: currentBranch })
    }

    return worktrees
  }

  async removeWorktree(worktreePath: string, repoRoot?: string) {
    const normalizedPath = await realpath(worktreePath)
    const cwd = repoRoot ? await realpath(repoRoot) : normalizedPath
    await runGit(["worktree", "remove", "--force", normalizedPath], cwd)
    if (repoRoot) {
      await runGit(["worktree", "prune"], cwd)
    }
  }
}
