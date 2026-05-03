#!/usr/bin/env node

import { Command } from "commander"

import { runAgentPlanCommand, runAgentTaskCommand } from "./commands/agent.js"
import { runDagShowCommand } from "./commands/dag.js"
import { runDoctorCommand } from "./commands/doctor.js"
import { runIndexCommand } from "./commands/index.js"
import { runInit } from "./commands/init.js"
import { runReviewCommand } from "./commands/review.js"
import {
  runPatchAcceptCommand,
  runPatchPromoteCommand,
  runTaskDiscardCommand,
  runTaskListCommand,
  runTaskRetryCommand,
  runTaskRunCommand,
  runTaskShowCommand
} from "./commands/task.js"
import { runVerifyCommand } from "./commands/verify.js"
import { loadProjectConfig } from "./config/loader.js"
import { XieZhiError, toError } from "./core/errors.js"
import { UNBORN_HEAD } from "./core/git.js"
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
  .name("xiezhi")
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
      `created git repo: ${String(result.createdGitRepository)}`,
      `applied migrations: ${result.appliedMigrations.length}`,
      `repo id: ${result.repository.id}`,
      `repo root: ${result.repository.rootPath}`,
      `head commit: ${result.repository.headCommit}`,
      `dirty: ${String(result.repository.isDirty)}`
    ])
    if (result.repository.headCommit === UNBORN_HEAD) {
      printCard("Next Step", [
        "This repository has no commit yet, so task worktrees cannot be created.",
        "Create a baseline commit with `git add . && git commit -m \"chore: initial baseline\"` before `xiezhi agent run`."
      ])
    }
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

const agentCommand = program.command("agent").description("Plan and execute work through external coding agents")

agentCommand
  .command("plan")
  .description("Ask an agent runtime for a strict AgentPlan JSON object and import it as XieZhi DAG state")
  .argument("<goal>", "Goal for the planning agent")
  .option("--runtime <runtime>", "Runtime to use", "opencode")
  .action(async (goal: string, options: { runtime: RuntimeName }) => {
    const result = await runAgentPlanCommand(process.cwd(), goal, options.runtime)
    printSection("Agent Plan", [
      `status: ${formatStatus(result.status)}`,
      `agent session: ${result.agentSessionId}`,
      `runtime: ${result.runtimeName}`,
      `goal: ${result.goal}`,
      `feature id: ${result.featureId}`,
      `title: ${result.title}`,
      `feature status: ${formatStatus(result.featureStatus)}`,
      `tasks: ${result.taskCount}`,
      `nodes: ${result.nodeCount}`,
      `edges: ${result.edgeCount}`
    ])
    for (const [index, task] of result.tasks.entries()) {
      printCard(`Task ${index + 1} · ${task.key}`, [
        `id: ${task.id}`,
        `status: ${formatStatus(task.status)}`,
        `title: ${task.title}`,
        `scope: ${formatInlineList(task.allowedFiles, { emptyText: "n/a", max: 4 })}`,
        `acceptance: ${formatInlineList(task.acceptance, { emptyText: "n/a", max: 3 })}`
      ])
    }
  })

agentCommand
  .command("run")
  .description("Compile a task assignment, run the selected agent runtime, and capture a patch")
  .argument("<taskId>", "Task id")
  .option("--runtime <runtime>", "Runtime to use", "opencode")
  .action(async (taskId: string, options: { runtime: RuntimeName }) => {
    const result = await runAgentTaskCommand(process.cwd(), taskId, options.runtime)
    printSection("Agent Run", [
      `status: ${formatStatus(result.status)}`,
      `agent session: ${result.agentSessionId ?? "none"}`,
      `task id: ${result.taskId}`,
      `task title: ${result.taskTitle}`,
      `assignment: ${result.assignmentId}`,
      `agent run: ${result.agentRunId}`,
      `runtime: ${result.runtime}/${result.runtimeMode}`,
      `patch id: ${result.patchId}`,
      `patch status: ${formatStatus(result.patchStatus)}`,
      `task status: ${formatStatus(result.taskStatus)}`,
      `changed files: ${result.changedFiles.length}`,
      `next step: ${result.nextStep}`
    ])
    printList("Changed Files", result.changedFiles, { emptyText: "none" })
    printCard("Inspect", [
      `xiezhi task show ${result.taskId}`,
      `xiezhi verify ${result.patchId}`,
      `xiezhi review ${result.patchId}`
    ])
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
        `run: xiezhi agent run ${readyTask.id} --runtime opencode`
      ])
    }

    for (const [index, task] of result.tasks.entries()) {
      printCard(`Task ${index + 1} · ${formatStatus(task.status)} · ${shortenId(task.id)}`, [
        task.title,
        `Scope: ${task.scopeSummary}`,
        `Depends: ${formatInlineList(task.dependsOnTaskIds.map((id) => shortenId(id)), { emptyText: "none" })}`,
        `Patches: ${task.patchCount}${
          task.latestPatch
            ? ` · latest ${task.latestPatch.status} (${shortenId(task.latestPatch.id)}) via ${task.latestPatch.runtimeName}/${task.latestPatch.runtimeMode} · files ${task.latestPatch.changedFiles.length}`
            : ""
        }`,
        `Run: xiezhi agent run ${task.id} --runtime opencode`
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
  .command("show")
  .description("Show task intent, latest patch evidence, and next action")
  .argument("<taskId>", "Task id")
  .action(async (taskId: string) => {
    const result = await runTaskShowCommand(process.cwd(), taskId)

    printSection("Task", [
      `status: ${formatStatus(result.status)}`,
      `task id: ${result.taskId}`,
      `task status: ${formatStatus(result.taskStatus)}`,
      `title: ${result.title}`,
      `goal: ${result.goal}`,
      `next action: ${result.nextAction}`
    ])
    printCard("Intent", [
      result.summary || "No summary recorded.",
      ...(result.rationale.length > 0 ? [`rationale: ${result.rationale.join(" | ")}`] : []),
      ...(result.expectedOutputs.length > 0 ? [`expected: ${result.expectedOutputs.join(" | ")}`] : [])
    ])
    printIndentedList("Allowed Files", result.allowedFiles, { emptyText: "none" })
    printIndentedList("Forbidden Files", result.forbiddenFiles, { emptyText: "none" })
    printIndentedList("Related Symbols", result.relatedSymbols, { emptyText: "none" })
    printIndentedList("Allowed Symbols", result.allowedSymbols, { emptyText: "none" })
    printIndentedList("Forbidden Symbols", result.forbiddenSymbols, { emptyText: "none" })
    printIndentedList("Acceptance", result.acceptance, { emptyText: "none" })
    printIndentedList("Commands", result.recommendedCommands, { emptyText: "none" })
    if (result.latestPatch) {
      printCard("Latest Patch", [
        `id: ${result.latestPatch.id}`,
        `status: ${formatStatus(result.latestPatch.status)}`,
        `runtime: ${result.latestPatch.runtimeName}/${result.latestPatch.runtimeMode}`,
        `changed files: ${result.latestPatch.changedFiles.length}`,
        `worktree: ${result.latestPatch.worktreePath}`,
        ...(result.latestPatch.promotedAt ? [`promoted: ${result.latestPatch.promotedAt}`] : []),
        ...(result.latestPatch.evidence ? [`evidence: ${result.latestPatch.evidence.message}`] : [])
      ])
      printIndentedList("Changed Files", result.latestPatch.changedFiles, { emptyText: "none" })
    }
    if (result.latestAgentRun) {
      printCard("Latest Agent Run", [
        `id: ${result.latestAgentRun.id}`,
        `status: ${formatStatus(result.latestAgentRun.status)}`,
        `runtime: ${result.latestAgentRun.runtimeName}/${result.latestAgentRun.runtimeMode ?? "unknown"}`,
        `patch: ${result.latestAgentRun.patchId ?? "none"}`
      ])
    }
    if (result.latestAssignment) {
      printCard("Latest Assignment", [
        `id: ${result.latestAssignment.id}`,
        `status: ${formatStatus(result.latestAssignment.status)}`,
        `goal: ${result.latestAssignment.goal}`
      ])
    }
    printList(
      "Checks",
      result.checks.map((check) => `${formatStatus(check.status)} ${check.type}: ${check.summary}`),
      { emptyText: "none" }
    )
    printList(
      "Violations",
      result.violations.map((violation) => `${violation.severity} ${violation.type}: ${violation.message}`),
      { emptyText: "none" }
    )
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
      `required checks: ${result.requiredCheckTypes.join(", ") || "none"}`,
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
        `modified nodes: ${result.semanticDiff.modifiedNodes.length}`,
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
      `summary: ${result.summary}`,
      `required checks: ${result.requiredCheckTypes.join(", ") || "none"}`
    ])
    printList("Changed Files", result.changedFiles, { emptyText: "none" })
    printList(
      "Semantic Changes",
      [
        ...result.semanticDiff.addedNodes.map((node) => `added ${node.kind}: ${node.symbol ?? node.path}`),
        ...result.semanticDiff.removedNodes.map((node) => `removed ${node.kind}: ${node.symbol ?? node.path}`),
        ...result.semanticDiff.modifiedNodes.map((node) => `modified ${node.kind}: ${node.symbol ?? node.path}`),
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

const patchCommand = program.command("patch").description("Inspect or advance patch lifecycle state")

patchCommand
  .command("accept")
  .description("Accept a verified patch")
  .argument("<patchId>", "Patch id")
  .action(async (patchId: string) => {
    const result = await runPatchAcceptCommand(process.cwd(), patchId)
    printSection("Patch Accept", [
      `status: ${formatStatus(result.status)}`,
      `patch id: ${result.patchId}`,
      `task id: ${result.taskId}`,
      `patch status: ${formatStatus(result.patchStatus)}`,
      `task status: ${formatStatus(result.taskStatus)}`,
      `next step: ${result.nextStep}`
    ])
  })

patchCommand
  .command("promote")
  .description("Promote a verified patch into the repository working tree")
  .argument("<patchId>", "Patch id")
  .action(async (patchId: string) => {
    const result = await runPatchPromoteCommand(process.cwd(), patchId)
    printSection("Patch Promote", [
      `status: ${formatStatus(result.status)}`,
      `patch id: ${result.patchId}`,
      `task id: ${result.taskId}`,
      `patch status: ${formatStatus(result.patchStatus)}`,
      `task status: ${formatStatus(result.taskStatus)}`,
      `repo root: ${result.repoRoot}`,
      `changed files: ${result.changedFiles.length}`,
      `commit: ${result.commitHash ?? "none"}`,
      `unlocked tasks: ${formatInlineList(result.unlockedTaskIds, { emptyText: "none", max: 3 })}`,
      `next step: ${result.nextStep}`
    ])
    printList("Promoted Files", result.changedFiles, { emptyText: "none" })
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
      return "Run `xiezhi init` in the repository root, then rerun the command."
    case "GIT_ERROR":
      return "Check that this directory is a git repo and the worktree path still exists."
    case "CLI_USAGE_ERROR":
      return "Run the corresponding `xiezhi ... --help` command or inspect `xiezhi task list` for valid ids."
    case "DATABASE_ERROR":
      return "Re-run `xiezhi init` if the local metadata directory was deleted or partially created."
    case "NOT_IMPLEMENTED":
      return "Choose one of the currently available runtimes or defer this workflow."
    case "CONFIG_INVALID":
      return "Fix `.xiezhi/config.yaml` or regenerate it with `xiezhi init`."
    default:
      return "Retry the command after checking the repository and XieZhi metadata state."
  }
}
