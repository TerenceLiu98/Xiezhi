import path from "node:path"
import { existsSync, readFileSync } from "node:fs"

import { applyConfigPreset, type ConfigPresetName } from "./presets.js"
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

export function detectScripts(cwd: string, packageManager = detectPackageManager(cwd)) {
  const packageJsonPath = path.join(cwd, "package.json")

  const prefix = packageManager === "npm" ? "npm run" : packageManager

  if (!existsSync(packageJsonPath)) {
    return {
      test: `${prefix} test`,
      typecheck: `${prefix} typecheck`,
      lint: `${prefix} lint`
    }
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJsonScripts
  const scripts = packageJson.scripts ?? {}

  return {
    test: scripts.test ? `${prefix} test` : `${prefix} test`,
    typecheck: scripts.typecheck ? `${prefix} typecheck` : `${prefix} typecheck`,
    lint: scripts.lint ? `${prefix} lint` : `${prefix} lint`
  }
}

export function createDefaultConfig(cwd: string, presetName?: ConfigPresetName): ProjectConfig {
  const projectName = path.basename(cwd)
  const packageManager = detectPackageManager(cwd)
  const detectedScripts = detectScripts(cwd, packageManager)

  const prefix = packageManager === "npm" ? "npm run" : packageManager
  const fallback = {
    test: `${prefix} test`,
    typecheck: `${prefix} typecheck`,
    lint: `${prefix} lint`
  }

  return applyConfigPreset(
    {
    project: {
      name: projectName,
      languages: ["typescript", "javascript", "python"]
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
    },
    presetName
  )
}
