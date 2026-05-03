#!/usr/bin/env node

import { Command } from "commander"

import { runDagShowCommand } from "./commands/dag.js"
import { runDoctorCommand } from "./commands/doctor.js"
import { runIndexCommand } from "./commands/index.js"
import { runInit } from "./commands/init.js"
import { runPlanCommand } from "./commands/plan.js"
import { runReviewCommand } from "./commands/review.js"
import { runTaskDiscardCommand, runTaskListCommand, runTaskRetryCommand, runTaskRunCommand } from "./commands/task.js"
import { runVerifyCommand } from "./commands/verify.js"
import { loadProjectConfig } from "./config/loader.js"
import { XieZhiError, toError } from "./core/errors.js"
import {
  formatInlineList,
  formatStatus,
  printCard,
  printIndentedList,
  printKeyValue,
  printList,
  printSection,
  renderPathTree,
  shortenId
} from "./core/command-output.js"
import type { RuntimeName } from "./runtime/shared/index.js"

const program = new Command()

program
  .name("xz")
  .description("XieZhi CLI")
  .version("0.1.0")

program
  .command("init")
  .description("Initialize XieZhi in the current repository")
  .option("--preset <preset>", "Config preset to apply during initialization")
  .action(async (options: { preset?: "local-fast" | "ci-guarded" }) => {
    const result = await runInit(process.cwd(), { preset: options.preset })
    printSection("Initialized XieZhi", [
      `metadata dir: ${result.metadataDir}`,
      `config path: ${result.configPath}`,
      `database path: ${result.databasePath}`,
      `package manager: ${result.packageManager}`,
      `preset: ${result.preset}`,
      `created config: ${String(result.createdConfig)}`,
      `applied migrations: ${result.appliedMigrations.length}`,
      `repo id: ${result.repository.id}`,
      `repo root: ${result.repository.rootPath}`,
      `head commit: ${result.repository.headCommit}`,
      `dirty: ${String(result.repository.isDirty)}`
    ])
  })

program
  .command("doctor")
  .description("Check whether XieZhi is ready to run in the current repository")
  .action(async () => {
    const result = await runDoctorCommand(process.cwd())
    printSection("Doctor", [
      `status: ${formatStatus(result.status)}`,
      `cwd: ${result.cwd}`,
      `metadata dir: ${result.metadataDir}`,
      `config path: ${result.configPath}`,
      `database path: ${result.databasePath}`,
      `package manager: ${result.packageManager}`
    ])
    for (const check of result.checks) {
      printCard(`${check.title} · ${formatStatus(check.status)}`, [
        check.summary,
        ...(check.nextStep ? [`next: ${check.nextStep}`] : [])
      ])
    }
  })

program
  .command("index")
  .description("Index the codebase")
  .option("--full", "Perform a full index")
  .option("--incremental", "Perform an incremental index")
  .action(async (options: { full?: boolean; incremental?: boolean }) => {
    const mode = options.incremental ? "incremental" : "full"
    const result = await runIndexCommand({ cwd: process.cwd(), mode })

    printSection("Index", [
      `status: ${result.status}`,
      `requested mode: ${result.mode}`,
      `executed mode: ${result.executedMode}`,
      `repo id: ${result.repoId}`,
      `files: ${result.summary.files}`,
      `functions: ${result.summary.functions}`,
      `classes: ${result.summary.classes}`,
      `interfaces: ${result.summary.interfaces}`,
      `types: ${result.summary.types}`,
      `routes: ${result.summary.routes}`,
      `components: ${result.summary.components}`,
      `tests: ${result.summary.tests}`,
      `edges: ${result.summary.edges}`,
      `indexed paths: ${result.indexedPaths.length}`,
      `deleted paths: ${result.deletedPaths.length}`
    ])
  })

program
  .command("plan")
  .description("Generate a feature and task plan from a natural language request")
  .argument("<request>", "The feature request to plan")
  .action(async (request: string) => {
    const result = await runPlanCommand(process.cwd(), request)
    printSection("Plan", [
      `status: ${formatStatus(result.status)}`,
      `request: ${result.request}`,
      `feature id: ${result.featureId}`,
      `title: ${result.title}`,
      `feature status: ${formatStatus(result.featureStatus)}`,
      `tasks: ${result.taskCount}`,
      `nodes: ${result.nodeCount}`,
      `edges: ${result.edgeCount}`
    ])
    for (const [index, task] of result.tasks.entries()) {
      printCard(`Task ${index + 1}`, [
        `id: ${task.id}`,
        `status: ${formatStatus(task.status)}`,
        `title: ${task.title}`,
        `scope: ${formatInlineList(task.allowedFiles, { emptyText: "n/a", max: 4 })}`,
        `acceptance: ${formatInlineList(task.acceptance, { emptyText: "n/a", max: 3 })}`
      ])
    }
  })

const dagCommand = program.command("dag").description("Inspect DAG data")

dagCommand
  .command("show")
  .description("Show a feature DAG")
  .argument("[featureId]", "Optional feature id")
  .action(async (featureId?: string) => {
    const result = await runDagShowCommand(process.cwd(), featureId)
    printSection("DAG", [
      `status: ${formatStatus(result.status)}`,
      `feature id: ${result.featureId}`,
      `title: ${result.featureTitle}`,
      `feature status: ${formatStatus(result.featureStatus)}`,
      `nodes: ${result.nodeCount}`,
      `edges: ${result.edgeCount}`,
      `tasks: ${result.taskCount}`
    ])
    printCard("Structure", result.structure)
    printList("Dependencies", result.dependencies, { emptyText: "none" })
    printList("Coverage", result.coverage, { emptyText: "none" })
  })

const taskCommand = program.command("task").description("Inspect or run tasks")

taskCommand
  .command("list")
  .description("List tasks for a feature")
  .argument("[featureId]", "Optional feature id")
  .action(async (featureId?: string) => {
    const result = await runTaskListCommand(process.cwd(), featureId)
    const readyTask = result.tasks.find((task) => task.status === "ready") ?? result.tasks[0]

    printSection("Tasks", [
      `status: ${formatStatus(result.status)}`,
      `feature id: ${result.featureId}`,
      `title: ${result.featureTitle}`,
      `tasks: ${result.tasks.length}`
    ])
    if (readyTask) {
      printCard("Next Up", [
        `${formatStatus(readyTask.status)} ${readyTask.title}`,
        `task: ${shortenId(readyTask.id)}  full: ${readyTask.id}`,
        `run: xz task run ${readyTask.id} --runtime opencode`
      ])
    }

    for (const [index, task] of result.tasks.entries()) {
      printCard(`Task ${index + 1} · ${formatStatus(task.status)} · ${shortenId(task.id)}`, [
        task.title,
        `Scope: ${task.scopeSummary}`,
        `Depends: ${formatInlineList(task.dependsOnTaskIds.map((id) => shortenId(id)), { emptyText: "none" })}`,
        `Run: xz task run ${task.id} --runtime opencode`
      ])
      printIndentedList("Files", task.allowedFiles, { emptyText: "n/a" })
      if (task.relatedSymbols.length > 0) {
        printIndentedList("Symbols", task.relatedSymbols, { emptyText: "none" })
      }
      printIndentedList("Acceptance", task.acceptance, { emptyText: "n/a" })
      printIndentedList("Commands", task.recommendedCommands, { emptyText: "n/a" })
      console.log("")
    }
  })

taskCommand
  .command("run")
  .description("Run a task using a coding runtime")
  .argument("<taskId>", "Task id")
  .option("--runtime <runtime>", "Runtime to use", "opencode")
  .action(async (taskId: string, options: { runtime: RuntimeName }) => {
    const result = await runTaskRunCommand(process.cwd(), taskId, options.runtime)
    printSection("Task Run", [
      `status: ${formatStatus(result.status)}`,
      `task id: ${result.taskId}`,
      `runtime: ${result.runtime}`,
      `mode: ${formatStatus(result.mode)}`,
      `success: ${String(result.success)}`,
      `task status: ${formatStatus(result.taskStatus)}`,
      `patch id: ${result.patchId}`,
      `patch status: ${formatStatus(result.patchStatus)}`,
      `changed files: ${result.changedFiles.length}`,
      `command logs: ${result.commandLogs}`,
      `events: ${result.eventCount}`,
      `next step: ${result.nextStep}`
    ])
    printList(
      "Execution Timeline",
      result.timeline.map((step) => `${formatStatus(step.status)} ${step.label}: ${step.detail}`)
    )
    printList(
      "Command Summary",
      result.commands.map((command) => `${command.exitCode === 0 ? "ok" : "fail"} ${command.command}`)
    )
    printCard("Worktree", renderPathTree(process.cwd(), result.worktreePath))
    if (result.changedFiles.length > 0) {
      printList("Changed Files", result.changedFiles)
    }
  })

taskCommand
  .command("discard")
  .description("Discard a patch and remove its worktree")
  .argument("<patchId>", "Patch id")
  .action(async (patchId: string) => {
    const result = await runTaskDiscardCommand(process.cwd(), patchId)
    printSection("Task Discard", [
      `status: ${formatStatus(result.status)}`,
      `patch id: ${result.patchId}`,
      `task id: ${result.taskId}`,
      `patch status: ${formatStatus(result.patchStatus)}`,
      `task status: ${formatStatus(result.taskStatus)}`,
      `next step: ${result.nextStep}`
    ])
    printCard("Removed Worktree", renderPathTree(process.cwd(), result.removedWorktree))
  })

taskCommand
  .command("retry")
  .description("Discard a patch worktree and rerun the task")
  .argument("<patchId>", "Patch id")
  .option("--runtime <runtime>", "Optional runtime override")
  .action(async (patchId: string, options: { runtime?: RuntimeName }) => {
    const result = await runTaskRetryCommand(process.cwd(), patchId, options.runtime)
    printSection("Task Retry", [
      `status: ${formatStatus(result.status)}`,
      `previous patch id: ${result.previousPatchId}`,
      `new patch id: ${result.patchId}`,
      `task id: ${result.taskId}`,
      `runtime: ${result.runtime}`,
      `mode: ${formatStatus(result.mode)}`,
      `task status: ${formatStatus(result.taskStatus)}`,
      `patch status: ${formatStatus(result.patchStatus)}`,
      `next step: ${result.nextStep}`
    ])
    printList(
      "Execution Timeline",
      result.timeline.map((step) => `${formatStatus(step.status)} ${step.label}: ${step.detail}`)
    )
    printCard("Worktree", renderPathTree(process.cwd(), result.worktreePath))
  })

program
  .command("verify")
  .description("Verify a patch")
  .argument("<patchId>", "Patch id")
  .action(async (patchId: string) => {
    const result = await runVerifyCommand(process.cwd(), patchId)
    printSection("Verify", [
      `status: ${formatStatus(result.status)}`,
      `patch id: ${result.patchId}`,
      `task id: ${result.taskId}`,
      `runtime: ${result.runtimeName}`,
      `patch status: ${formatStatus(result.patchStatus)}`,
      `task status: ${formatStatus(result.taskStatus)}`,
      `goal: ${result.goal}`,
      `changed files: ${result.changedFiles.length}`,
      `next step: ${result.nextStep}`
    ])
    printList(
      "Checks",
      result.checks.map((check) => `${formatStatus(check.status)} ${check.type}: ${check.summary}`),
      { emptyText: "none" }
    )
    printList(
      "Blocking Violations",
      result.blockingViolations.map((violation) => `${violation.type}: ${violation.message}`),
      { emptyText: "none" }
    )
    printList(
      "Warnings",
      result.warnings.map((warning) => `${warning.type}: ${warning.message}`),
      { emptyText: "none" }
    )
    printList(
      "Semantic Diff",
      [
        `added nodes: ${result.semanticDiff.addedNodes.length}`,
        `removed nodes: ${result.semanticDiff.removedNodes.length}`,
        `added exports: ${result.semanticDiff.addedExports.length}`,
        `removed exports: ${result.semanticDiff.removedExports.length}`
      ],
      { emptyText: "none" }
    )
    printCard("Outcome", [result.nextStep])
  })

program
  .command("review")
  .description("Review a patch")
  .argument("<patchId>", "Patch id")
  .option("--format <format>", "Optional export format: text, json, markdown", "text")
  .option("--output <path>", "Optional output path for exported review artifacts")
  .action(async (patchId: string, options: { format?: "text" | "json" | "markdown"; output?: string }) => {
    const result = await runReviewCommand(process.cwd(), patchId, {
      format: options.format === "markdown" ? "markdown" : options.format,
      outputPath: options.output
    })
    printSection("Review", [
      `status: ${formatStatus(result.status)}`,
      `patch id: ${result.patchId}`,
      `task id: ${result.taskId}`,
      `runtime: ${result.runtimeName}`,
      `goal: ${result.goal}`,
      `summary: ${result.summary}`
    ])
    printList("Changed Files", result.changedFiles, { emptyText: "none" })
    printList(
      "Semantic Changes",
      [
        ...result.semanticDiff.addedNodes.map((node) => `added ${node.kind}: ${node.symbol ?? node.path}`),
        ...result.semanticDiff.removedNodes.map((node) => `removed ${node.kind}: ${node.symbol ?? node.path}`),
        ...result.semanticDiff.addedExports.map((entry) => `export added: ${entry.symbol} (${entry.path})`),
        ...result.semanticDiff.removedExports.map((entry) => `export removed: ${entry.symbol} (${entry.path})`)
      ],
      { emptyText: "no semantic changes captured" }
    )
    printList(
      "Checks",
      result.checks.map((check) => `${formatStatus(check.status)} ${check.type}: ${check.summary}`),
      { emptyText: "none" }
    )
    printList(
      "Warnings",
      result.warnings.map((warning) => `${warning.type}: ${warning.message}`),
      { emptyText: "none" }
    )
    printList(
      "Blocking Violations",
      result.blockingViolations.map((violation) => `${violation.type}: ${violation.message}`),
      { emptyText: "none" }
    )
    printList("Next Actions", result.nextActions, { emptyText: "none" })
    printCard("Outcome", result.nextActions)
    if ("export" in result && result.export) {
      printCard("Export", [`format: ${result.export.format}`, `path: ${result.export.outputPath}`])
    }
  })

program.hook("preAction", async (thisCommand, actionCommand) => {
  if (actionCommand.name() === "init" || actionCommand.name() === "doctor") {
    return
  }

  try {
    const config = await loadProjectConfig(process.cwd())
    printKeyValue("runtime:", config.runtime.default)
  } catch (error) {
    if (error instanceof XieZhiError && error.code === "CONFIG_NOT_FOUND") {
      throw error
    }

    throw error
  }
})

async function main() {
  await program.parseAsync(process.argv)
}

main().catch((error) => {
  const resolvedError = toError(error)

  if (error instanceof XieZhiError) {
    printSection("Error", [
      `code: ${error.code}`,
      `message: ${error.message}`,
      `hint: ${error.hint ?? defaultRecoveryHint(error.code)}`
    ])
  } else {
    console.error(resolvedError.message)
  }

  process.exit(1)
})

function defaultRecoveryHint(code: XieZhiError["code"]) {
  switch (code) {
    case "CONFIG_NOT_FOUND":
    case "PROJECT_NOT_INITIALIZED":
      return "Run `xz init` in the repository root, then rerun the command."
    case "GIT_ERROR":
      return "Check that this directory is a git repo and the worktree path still exists."
    case "CLI_USAGE_ERROR":
      return "Run the corresponding `xz ... --help` command or inspect `xz task list` for valid ids."
    case "DATABASE_ERROR":
      return "Re-run `xz init` if the local metadata directory was deleted or partially created."
    case "NOT_IMPLEMENTED":
      return "Choose one of the currently available runtimes or defer this workflow."
    case "CONFIG_INVALID":
      return "Fix `.xiezhi/config.yaml` or regenerate it with `xz init`."
    default:
      return "Retry the command after checking the repository and XieZhi metadata state."
  }
}
