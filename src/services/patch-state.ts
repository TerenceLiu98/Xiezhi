import { execa } from "execa"

import { runGit } from "../core/git.js"

function unique(values: string[]) {
  return [...new Set(values)]
}

function shouldIgnorePatchPath(filePath: string) {
  return (
    filePath === ".git" ||
    filePath.startsWith(".git/") ||
    filePath === ".xiezhi" ||
    filePath.startsWith(".xiezhi/") ||
    filePath === "node_modules" ||
    filePath.startsWith("node_modules/") ||
    filePath === "dist" ||
    filePath.startsWith("dist/")
  )
}

function isUntrackedInstallArtifact(filePath: string, changedFiles: string[]) {
  return filePath === "package-lock.json" && !changedFiles.includes("package.json")
}

async function diffUntrackedFile(worktreePath: string, filePath: string) {
  const result = await execa("git", ["diff", "--no-ext-diff", "--no-index", "--", "/dev/null", filePath], {
    cwd: worktreePath,
    reject: false
  })

  return [result.stdout, result.stderr].filter(Boolean).join("\n")
}

export async function capturePatchState(worktreePath: string) {
  const trackedChangedFiles = (await runGit(["diff", "--name-only"], worktreePath)).stdout
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => Boolean(value) && !shouldIgnorePatchPath(value))
  const rawUntrackedFiles = (await runGit(["ls-files", "--others", "--exclude-standard"], worktreePath)).stdout
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => Boolean(value) && !shouldIgnorePatchPath(value))
  const changedManifests = [...trackedChangedFiles, ...rawUntrackedFiles]
  const untrackedFiles = rawUntrackedFiles.filter((value) => !isUntrackedInstallArtifact(value, changedManifests))
  const changedFiles = unique([...trackedChangedFiles, ...untrackedFiles])
  const trackedDiff = (await runGit(["diff", "--no-ext-diff"], worktreePath)).stdout
  const untrackedDiffs = await Promise.all(untrackedFiles.map((filePath) => diffUntrackedFile(worktreePath, filePath)))
  const diff = [trackedDiff, ...untrackedDiffs].filter(Boolean).join("\n")

  return { changedFiles, diff }
}
