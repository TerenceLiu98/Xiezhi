import { existsSync } from "node:fs"

import Database from "better-sqlite3"

import { detectPackageManager } from "../config/defaults.js"
import { loadProjectConfig } from "../config/loader.js"
import { getConfigPath, getDatabasePath, getXieZhiDir } from "../config/paths.js"
import { XieZhiError } from "../core/errors.js"
import { runGit, tryRunGit, UNBORN_HEAD } from "../core/git.js"
import { assertDatabaseInitialized } from "../db/client.js"
import { detectRuntimeAvailability } from "../runtime/shared/capabilities.js"
import type { RuntimeName } from "../runtime/shared/contracts.js"

export type DoctorCheckStatus = "passed" | "warning" | "failed"

export type DoctorCheck = {
  id: string
  title: string
  status: DoctorCheckStatus
  summary: string
  nextStep?: string
}

export type DoctorResult = {
  status: "passed" | "warning" | "failed"
  cwd: string
  metadataDir: string
  configPath: string
  databasePath: string
  packageManager: string
  checks: DoctorCheck[]
}

function summarizeOverallStatus(checks: DoctorCheck[]): DoctorResult["status"] {
  if (checks.some((check) => check.status === "failed")) {
    return "failed"
  }
  if (checks.some((check) => check.status === "warning")) {
    return "warning"
  }
  return "passed"
}

function createCheck(input: DoctorCheck): DoctorCheck {
  return input
}

function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10)

  if (major >= 22) {
    return createCheck({
      id: "node",
      title: "Node.js",
      status: "passed",
      summary: `Node ${process.versions.node} satisfies the >=22 runtime requirement.`
    })
  }

  return createCheck({
    id: "node",
    title: "Node.js",
    status: "failed",
    summary: `Node ${process.versions.node} is below the supported runtime floor.`,
    nextStep: "Install Node.js 22 or newer, then rerun `xiezhi doctor`."
  })
}

async function checkGitRepo(cwd: string) {
  try {
    const result = await runGit(["rev-parse", "--show-toplevel"], cwd)
    const headResult = await tryRunGit(["rev-parse", "HEAD"], cwd)
    const headCommit = headResult?.stdout.trim() || UNBORN_HEAD

    if (headCommit === UNBORN_HEAD) {
      return createCheck({
        id: "git",
        title: "Git repository",
        status: "warning",
        summary: `Repository root detected at ${result.stdout.trim()}, but there is no baseline commit yet.`,
        nextStep: "Create an initial commit before `xiezhi task run`, for example `git add . && git commit -m \"chore: initial baseline\"`."
      })
    }

    return createCheck({
      id: "git",
      title: "Git repository",
      status: "passed",
      summary: `Repository root detected at ${result.stdout.trim()}.`
    })
  } catch {
    return createCheck({
      id: "git",
      title: "Git repository",
      status: "failed",
      summary: "This directory is not a usable git repository for XieZhi.",
      nextStep: "Run `xiezhi init` here and XieZhi will initialize a git repository if needed."
    })
  }
}

async function checkConfig(cwd: string) {
  const configPath = getConfigPath(cwd)
  if (!existsSync(configPath)) {
    return createCheck({
      id: "config",
      title: "Project config",
      status: "warning",
      summary: "No `.xiezhi/config.yaml` file was found.",
      nextStep: "Run `xiezhi init` to create the project metadata directory and default config."
    })
  }

  try {
    const config = await loadProjectConfig(cwd)
    return createCheck({
      id: "config",
      title: "Project config",
      status: "passed",
      summary: `Loaded config for ${config.project.name} with default runtime ${config.runtime.default}.`
    })
  } catch (error) {
    const resolvedError = error as XieZhiError
    return createCheck({
      id: "config",
      title: "Project config",
      status: "failed",
      summary: resolvedError.message,
      nextStep: resolvedError.hint ?? "Fix `.xiezhi/config.yaml` or regenerate it with `xiezhi init`."
    })
  }
}

function checkDatabase(cwd: string) {
  const databasePath = getDatabasePath(cwd)
  if (!existsSync(databasePath)) {
    return createCheck({
      id: "database",
      title: "Local database",
      status: "warning",
      summary: "No `.xiezhi/xiezhi.db` file was found.",
      nextStep: "Run `xiezhi init` so XieZhi can create and migrate the local database."
    })
  }

  const sqlite = new Database(databasePath)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    return createCheck({
      id: "database",
      title: "Local database",
      status: "passed",
      summary: "The local SQLite database exists and required tables are present."
    })
  } catch (error) {
    const resolvedError = error as XieZhiError
    return createCheck({
      id: "database",
      title: "Local database",
      status: "failed",
      summary: resolvedError.message,
      nextStep: resolvedError.hint ?? "Re-run `xiezhi init` to repair the local metadata database."
    })
  } finally {
    sqlite.close()
  }
}

async function checkRuntimeAvailability(defaultRuntime?: string) {
  const runtimes = await Promise.all(
    (["opencode", "claude", "codex"] as const).map((runtime) => detectRuntimeAvailability(runtime))
  )

  const availableRuntimes = runtimes.filter((runtime) => runtime.available)
  const defaultEntry = defaultRuntime ? runtimes.find((runtime) => runtime.runtime === defaultRuntime) : null

  if (defaultEntry?.available) {
    return createCheck({
      id: "runtime",
      title: "Runtime availability",
      status: "passed",
      summary: `Default runtime ${defaultEntry.runtime} is available. Also detected: ${availableRuntimes
        .map((runtime) => runtime.runtime)
        .join(", ") || "none"}.`
    })
  }

  if (availableRuntimes.length > 0) {
    return createCheck({
      id: "runtime",
      title: "Runtime availability",
      status: "warning",
      summary: `Detected runtimes: ${availableRuntimes.map((runtime) => runtime.runtime).join(", ")}.`,
      nextStep: defaultRuntime
        ? `Update \`.xiezhi/config.yaml\` to use one of the available runtimes or install ${defaultRuntime}.`
        : "Run `xiezhi init --preset local-fast` or edit `.xiezhi/config.yaml` to pick an available runtime."
    })
  }

  return createCheck({
    id: "runtime",
    title: "Runtime availability",
    status: "warning",
    summary: "No supported runtime CLI was detected on PATH.",
    nextStep: "Install `claude`, `codex`, or `opencode`, then rerun `xiezhi doctor`."
  })
}

function toRuntimeName(value?: string): RuntimeName | undefined {
  if (value === "opencode" || value === "claude" || value === "codex") {
    return value
  }
  return undefined
}

function checkInstallPath(cwd: string) {
  const packageJsonPath = `${cwd}/package.json`

  if (existsSync(packageJsonPath)) {
    return createCheck({
      id: "install",
      title: "Install path",
      status: "passed",
      summary: `Package manifest found. Current package manager guess: ${detectPackageManager(cwd)}.`
    })
  }

  return createCheck({
    id: "install",
    title: "Install path",
    status: "warning",
    summary: "No package.json was found in this directory.",
    nextStep: "Open the XieZhi repo root before trying to build or package the CLI."
  })
}

export async function runDoctor(cwd: string): Promise<DoctorResult> {
  const metadataDir = getXieZhiDir(cwd)
  const configPath = getConfigPath(cwd)
  const databasePath = getDatabasePath(cwd)
  const packageManager = detectPackageManager(cwd)
  const configCheck = await checkConfig(cwd)
  const defaultRuntimeMatch = configCheck.summary.match(/default runtime (\w+)/)
  const defaultRuntime = toRuntimeName(defaultRuntimeMatch?.[1])

  const checks = [
    checkNodeVersion(),
    await checkGitRepo(cwd),
    checkInstallPath(cwd),
    configCheck,
    checkDatabase(cwd),
    await checkRuntimeAvailability(defaultRuntime)
  ]

  return {
    status: summarizeOverallStatus(checks),
    cwd,
    metadataDir,
    configPath,
    databasePath,
    packageManager,
    checks
  }
}
