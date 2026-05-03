import { describe, expect, it } from "vitest"

import { runDoctorCommand } from "../src/commands/doctor.js"
import { runInit } from "../src/commands/init.js"
import { createTempGitRepo } from "./support/git-fixture.js"

describe("doctor command", () => {
  it("surfaces missing config and database state before init", async () => {
    const cwd = await createTempGitRepo("xiezhi-doctor-empty-")

    const result = await runDoctorCommand(cwd)

    expect(result.status).toBe("warning")
    expect(result.checks.find((check) => check.id === "config")?.status).toBe("warning")
    expect(result.checks.find((check) => check.id === "database")?.status).toBe("warning")
  })

  it("reports initialized state and runtime availability hints after init", async () => {
    const cwd = await createTempGitRepo("xiezhi-doctor-ready-")
    await runInit(cwd, { preset: "ci-guarded" })

    const result = await runDoctorCommand(cwd)

    expect(result.checks.find((check) => check.id === "config")?.status).toBe("passed")
    expect(result.checks.find((check) => check.id === "database")?.status).toBe("passed")
    expect(result.checks.find((check) => check.id === "runtime")?.status).toBe("warning")
  })
})
