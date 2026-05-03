import { execa } from "execa"

import { XieZhiError } from "./errors.js"

export const UNBORN_HEAD = "UNBORN"

export async function runGit(args: string[], cwd: string) {
  try {
    return await execa("git", args, { cwd })
  } catch (error) {
    throw new XieZhiError("GIT_ERROR", `Git command failed: git ${args.join(" ")}`, {
      cause: error,
      hint: "Make sure this directory is a valid git repository and git is installed."
    })
  }
}

export async function tryRunGit(args: string[], cwd: string) {
  try {
    return await execa("git", args, { cwd })
  } catch {
    return null
  }
}

export async function ensureGitRepository(cwd: string) {
  const existing = await tryRunGit(["rev-parse", "--show-toplevel"], cwd)
  if (existing) {
    return { initialized: false }
  }

  const initWithBranch = await tryRunGit(["init", "-b", "main"], cwd)
  if (!initWithBranch) {
    await runGit(["init"], cwd)
  }

  return { initialized: true }
}
