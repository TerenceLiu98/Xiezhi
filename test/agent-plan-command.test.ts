import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { runAgentPlanCommand } from "../src/commands/agent.js"
import { runDagShowCommand } from "../src/commands/dag.js"
import { runInit } from "../src/commands/init.js"
import { XieZhiError } from "../src/core/errors.js"
import { clearRuntimeAvailabilityCache } from "../src/runtime/shared/capabilities.js"
import { createTempTsRepo } from "./support/git-fixture.js"
import { routerAgentPlan } from "./support/agent-plan-fixture.js"

async function withFakeOpenCode(cwd: string, output: string, fn: () => Promise<void>) {
  const binDir = path.join(cwd, ".test-bin")
  await mkdir(binDir, { recursive: true })
  const executable = path.join(binDir, "opencode")
  await writeFile(executable, `#!/bin/sh\ncat <<'JSON'\n${output}\nJSON\n`, "utf8")
  await chmod(executable, 0o755)

  const originalPath = process.env.PATH
  const originalForceScaffold = process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  process.env.PATH = `${binDir}:${originalPath ?? ""}`
  delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
  clearRuntimeAvailabilityCache()
  try {
    await fn()
  } finally {
    process.env.PATH = originalPath
    if (originalForceScaffold === undefined) {
      delete process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES
    } else {
      process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES = originalForceScaffold
    }
    clearRuntimeAvailabilityCache()
  }
}

describe("agent plan command", () => {
  it("imports strict JSON returned by fake OpenCode", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-plan-cli-")
    await runInit(cwd)
    const planJson = JSON.stringify(routerAgentPlan())

    await withFakeOpenCode(cwd, planJson, async () => {
      const result = await runAgentPlanCommand(cwd, "update router user flow", "opencode")
      const dag = await runDagShowCommand(cwd, result.featureId)

      expect(result.status).toBe("planned")
      expect(result.agentSessionId).toBeTruthy()
      expect(result.runtimeName).toBe("opencode")
      expect(result.tasks).toHaveLength(2)
      expect(dag.featureTitle).toBe("Update router user flow")
    })
  }, 15000)

  it("fails clearly when the agent returns non-JSON output", async () => {
    const cwd = await createTempTsRepo("xiezhi-agent-plan-cli-invalid-")
    await runInit(cwd)

    await withFakeOpenCode(cwd, "not json", async () => {
      await expect(runAgentPlanCommand(cwd, "update router user flow", "opencode")).rejects.toMatchObject({
        code: "CLI_USAGE_ERROR"
      } satisfies Partial<XieZhiError>)
    })
  }, 15000)
})
