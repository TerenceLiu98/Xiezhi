import { XieZhiError, toError } from "./errors.js"

export type FailureType =
  | "planning_failed"
  | "runtime_failed"
  | "verification_failed"
  | "environment_failed"
  | "database_failed"
  | "git_failed"
  | "config_failed"
  | "unknown_failed"

export type FailureSummary = {
  failureType: FailureType
  failureStage: "config" | "database" | "git" | "runtime" | "planning" | "verification" | "unknown"
  message: string
  nextAction: string
}

export function summarizeFailure(error: unknown): FailureSummary {
  if (error instanceof XieZhiError) {
    switch (error.code) {
      case "CONFIG_NOT_FOUND":
      case "CONFIG_INVALID":
        return {
          failureType: "config_failed",
          failureStage: "config",
          message: error.message,
          nextAction: error.hint ?? "Run `xz init` or repair the config file."
        }
      case "DATABASE_ERROR":
        return {
          failureType: "database_failed",
          failureStage: "database",
          message: error.message,
          nextAction: error.hint ?? "Re-run `xz init` or inspect the local SQLite metadata store."
        }
      case "GIT_ERROR":
        return {
          failureType: "git_failed",
          failureStage: "git",
          message: error.message,
          nextAction: error.hint ?? "Check git status and repository health, then retry."
        }
      case "PROJECT_NOT_INITIALIZED":
        return {
          failureType: "environment_failed",
          failureStage: "config",
          message: error.message,
          nextAction: error.hint ?? "Initialize the project before continuing."
        }
      case "CLI_USAGE_ERROR":
        return {
          failureType: "environment_failed",
          failureStage: "unknown",
          message: error.message,
          nextAction: error.hint ?? "Review the command arguments and try again."
        }
      case "NOT_IMPLEMENTED":
        return {
          failureType: "unknown_failed",
          failureStage: "unknown",
          message: error.message,
          nextAction: error.hint ?? "Finish the next implementation slice for this command."
        }
      default:
        break
    }
  }

  const resolved = toError(error)
  return {
    failureType: "unknown_failed",
    failureStage: "unknown",
    message: resolved.message,
    nextAction: "Inspect the stack trace and retry after fixing the underlying issue."
  }
}
