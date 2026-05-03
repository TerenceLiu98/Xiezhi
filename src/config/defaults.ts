import path from "node:path"
import { existsSync, readFileSync } from "node:fs"

import type { ProjectConfig } from "./schema.js"

type PackageJsonScripts = {
  scripts?: Record<string, string>
}

export function detectPackageManager(cwd: string) {
  const checks: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"]
  ]

  for (const [filename, packageManager] of checks) {
    if (existsSync(path.join(cwd, filename))) {
      return packageManager
    }
  }

  return "pnpm"
}

export function detectScripts(cwd: string) {
  const packageJsonPath = path.join(cwd, "package.json")

  if (!existsSync(packageJsonPath)) {
    return {
      test: "pnpm test",
      typecheck: "pnpm typecheck",
      lint: "pnpm lint"
    }
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJsonScripts
  const scripts = packageJson.scripts ?? {}

  return {
    test: scripts.test ? "pnpm test" : "pnpm test",
    typecheck: scripts.typecheck ? "pnpm typecheck" : "pnpm typecheck",
    lint: scripts.lint ? "pnpm lint" : "pnpm lint"
  }
}

export function createDefaultConfig(cwd: string): ProjectConfig {
  const projectName = path.basename(cwd)
  const packageManager = detectPackageManager(cwd)
  const detectedScripts = detectScripts(cwd)

  const prefix = packageManager === "npm" ? "npm run" : packageManager
  const fallback = {
    test: `${prefix} test`,
    typecheck: `${prefix} typecheck`,
    lint: `${prefix} lint`
  }

  return {
    project: {
      name: projectName,
      language: "typescript"
    },
    runtime: {
      default: "opencode"
    },
    commands: {
      test: detectedScripts.test || fallback.test,
      typecheck: detectedScripts.typecheck || fallback.typecheck,
      lint: detectedScripts.lint || fallback.lint
    },
    policy: {
      defaultWriteMode: "task_scope_only",
      denyCommands: ["git push", "git commit", "rm -rf *"]
    }
  }
}
