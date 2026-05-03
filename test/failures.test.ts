import { describe, expect, it } from "vitest"

import { XieZhiError } from "../src/core/errors.js"
import { summarizeFailure } from "../src/core/failures.js"

describe("failure summaries", () => {
  it("maps git failures into actionable output", () => {
    const summary = summarizeFailure(
      new XieZhiError("GIT_ERROR", "Git command failed.", {
        hint: "Check the repository state."
      })
    )

    expect(summary.failureType).toBe("git_failed")
    expect(summary.nextAction).toContain("repository")
  })
})
