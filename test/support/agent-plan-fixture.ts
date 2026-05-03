import { importAgentPlan } from "../../src/services/planning-service.js"
import type { AgentPlanV1 } from "../../src/planning/types.js"

export function routerAgentPlan(overrides?: Partial<AgentPlanV1>): AgentPlanV1 {
  return {
    version: "v1",
    goal: "update router user flow",
    title: "Update router user flow",
    requirements: ["Update the router user flow with bounded changes."],
    tasks: [
      {
        key: "implement-router",
        title: "Implement router user flow",
        summary: "Make the smallest router change needed for the user flow.",
        dependsOn: [],
        allowedFiles: ["src/router.tsx", "src/helpers.ts"],
        forbiddenFiles: [".xiezhi/"],
        allowedSymbols: ["getUser", "App"],
        forbiddenSymbols: [],
        acceptance: ["Router behavior is updated without touching unrelated files."],
        checks: ["pnpm typecheck"],
        expectedOutputs: ["A task-scoped patch is captured."],
        rationale: ["Agent selected the router and helper files as the bounded implementation surface."]
      },
      {
        key: "verify-router",
        title: "Verify router user flow",
        summary: "Update tests and run checks for the router flow.",
        dependsOn: ["implement-router"],
        allowedFiles: ["tests/router.test.ts", "src/router.tsx"],
        forbiddenFiles: [".xiezhi/"],
        allowedSymbols: ["getUser"],
        forbiddenSymbols: [],
        acceptance: ["Coverage exists for the router flow."],
        checks: ["pnpm typecheck", "pnpm test"],
        expectedOutputs: ["Passing typecheck and test evidence is recorded."],
        rationale: ["Agent selected the existing router test as the verification surface."]
      }
    ],
    ...overrides
  }
}

export function appBootstrapAgentPlan(overrides?: Partial<AgentPlanV1>): AgentPlanV1 {
  return {
    version: "v1",
    goal: "build an electron note taking app",
    title: "Build an Electron note taking app",
    requirements: ["Create a minimal app scaffold that can be promoted into the repository."],
    tasks: [
      {
        key: "scaffold-app",
        title: "Scaffold Electron app files",
        summary: "Create the first app files through an agent patch.",
        dependsOn: [],
        allowedFiles: ["README.md", "package.json", "tsconfig.json", "src/app.tsx"],
        forbiddenFiles: [".xiezhi/"],
        allowedSymbols: ["App"],
        forbiddenSymbols: [],
        acceptance: ["The app has a minimal package and source entry."],
        checks: [],
        expectedOutputs: ["Tracked and untracked app files are captured."],
        rationale: ["Agent selected the starter files needed for a small app scaffold."]
      },
      {
        key: "verify-app",
        title: "Verify Electron app files",
        summary: "Verify the app scaffold.",
        dependsOn: ["scaffold-app"],
        allowedFiles: ["tests/app.test.ts", "vitest.config.ts", "package.json"],
        forbiddenFiles: [".xiezhi/"],
        allowedSymbols: [],
        forbiddenSymbols: [],
        acceptance: ["Tests can be added for the app scaffold."],
        checks: ["pnpm typecheck", "pnpm test"],
        expectedOutputs: ["Verification evidence is captured."],
        rationale: ["Agent selected tests and config as the verification surface."]
      }
    ],
    ...overrides
  }
}

export function noteTakingAgentPlan(overrides?: Partial<AgentPlanV1>): AgentPlanV1 {
  return {
    version: "v1",
    goal: "add search and tags",
    title: "Add search and tags",
    requirements: ["Add search and tag filtering to the note-taking app."],
    tasks: [
      {
        key: "notes-search-tags",
        title: "Implement note search and tags",
        summary: "Update note helpers and UI for search and tags.",
        dependsOn: [],
        allowedFiles: ["src/notes.ts", "src/app.tsx", "tests/notes.test.ts"],
        forbiddenFiles: [".xiezhi/"],
        allowedSymbols: ["searchNotes", "notesByTag", "App"],
        forbiddenSymbols: [],
        acceptance: ["Notes can be searched and filtered by tag."],
        checks: ["pnpm typecheck", "pnpm test"],
        expectedOutputs: ["A bounded patch implements search and tags."],
        rationale: ["Agent selected the existing note domain and app files."]
      }
    ],
    ...overrides
  }
}

export function importRouterPlan(cwd: string, overrides?: Partial<AgentPlanV1>) {
  return importAgentPlan(cwd, routerAgentPlan(overrides), { runtimeName: "test-agent" })
}

export function importAppBootstrapPlan(cwd: string, overrides?: Partial<AgentPlanV1>) {
  return importAgentPlan(cwd, appBootstrapAgentPlan(overrides), { runtimeName: "test-agent" })
}

export function importNoteTakingPlan(cwd: string, overrides?: Partial<AgentPlanV1>) {
  return importAgentPlan(cwd, noteTakingAgentPlan(overrides), { runtimeName: "test-agent" })
}
