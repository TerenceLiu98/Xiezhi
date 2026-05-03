import { runGit } from "../core/git.js"

export async function capturePatchState(worktreePath: string) {
  const changedFiles = (await runGit(["diff", "--name-only"], worktreePath)).stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
  const diff = (await runGit(["diff", "--no-ext-diff"], worktreePath)).stdout

  return { changedFiles, diff }
}
