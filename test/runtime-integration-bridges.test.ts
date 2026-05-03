import { appendFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import type { CommandRunner } from "../src/runtime/cli/runtime.js"
import { ClaudeRuntime } from "../src/runtime/claude/adapter.js"
import { CodexRuntime } from "../src/runtime/codex/adapter.js"
import type { RuntimeAvailability } from "../src/runtime/shared/capabilities.js"
import { createTempTsRepo } from "./support/git-fixture.js"

function available(runtime: "claude" | "codex"): RuntimeAvailability {
  return {
    runtime,
    binary: runtime,
    available: true,
    reason: `${runtime} available in test`
  }
}

describe("runtime integration bridges", () => {
  it("uses the real Claude bridge when the CLI is available", async () => {
    const cwd = await createTempTsRepo("xiezhi-runtime-claude-")
    const runner: CommandRunner = async ({ command, args, cwd: runnerCwd, input }) => {
      expect(command).toBe("claude")
      expect(args).toContain("-p")
      expect(args).toContain("--output-format")
      expect(args[args.length - 1]).toContain("Only edit these files when possible")
      expect(input).toBeUndefined()

      await appendFile(path.join(runnerCwd, "tests", "router.test.ts"), "\n// claude real bridge\n", "utf8")

      return {
        exitCode: 0,
        stdout: JSON.stringify({
          type: "assistant_message",
          message: {
            content: "Updated tests/router.test.ts"
          }
        }),
        stderr: ""
      }
    }

    const runtime = new ClaudeRuntime({
      runner,
      availabilityResolver: async () => available("claude")
    })

    const result = await runtime.runTask({
      taskId: "task_claude",
      goal: "Update the router test",
      cwd,
      runtime: "claude",
      allowedFiles: ["tests/router.test.ts"],
      forbiddenFiles: ["README.md"],
      acceptance: ["Router test is updated."],
      recommendedCommands: ["pnpm test"],
      policy: {
        taskId: "task_claude",
        allowedFiles: ["tests/router.test.ts"],
        forbiddenFiles: ["README.md"]
      }
    })

    expect(result.mode).toBe("real")
    expect(result.success).toBe(true)
    expect(result.changedFiles).toContain("tests/router.test.ts")
    expect(result.events.some((event) => event.type === "file_edit")).toBe(true)
    expect(result.events.some((event) => event.type === "approval")).toBe(true)
  })

  it("uses the real Codex bridge when the CLI is available", async () => {
    const cwd = await createTempTsRepo("xiezhi-runtime-codex-")
    const runner: CommandRunner = async ({ command, args, cwd: runnerCwd, input }) => {
      expect(command).toBe("codex")
      expect(args).toContain("exec")
      expect(args).toContain("--json")
      expect(input).toContain("Do not edit these files")

      await appendFile(path.join(runnerCwd, "src", "helpers.ts"), "\nexport const codexBridge = true\n", "utf8")

      return {
        exitCode: 0,
        stdout: JSON.stringify({
          type: "assistant_message",
          content: "Updated src/helpers.ts"
        }),
        stderr: ""
      }
    }

    const runtime = new CodexRuntime({
      runner,
      availabilityResolver: async () => available("codex")
    })

    const result = await runtime.runTask({
      taskId: "task_codex",
      goal: "Update the helper implementation",
      cwd,
      runtime: "codex",
      allowedFiles: ["src/helpers.ts"],
      forbiddenFiles: ["README.md"],
      acceptance: ["Helper implementation is updated."],
      recommendedCommands: ["pnpm typecheck"],
      policy: {
        taskId: "task_codex",
        allowedFiles: ["src/helpers.ts"],
        forbiddenFiles: ["README.md"]
      }
    })

    expect(result.mode).toBe("real")
    expect(result.success).toBe(true)
    expect(result.changedFiles).toContain("src/helpers.ts")
    expect(result.commandLogs[0]?.command).toContain("codex exec")
    expect(result.events.some((event) => event.type === "file_edit")).toBe(true)
  })
})
