import type { ProjectConfig } from "./schema.js"

export const configPresetNames = ["local-fast", "ci-guarded"] as const

export type ConfigPresetName = (typeof configPresetNames)[number]

export type ConfigPreset = {
  name: ConfigPresetName
  description: string
  runtimeDefault: ProjectConfig["runtime"]["default"]
  denyCommands: string[]
}

const baseDeniedCommands = ["git push", "git commit", "rm -rf *"]

export const configPresets: Record<ConfigPresetName, ConfigPreset> = {
  "local-fast": {
    name: "local-fast",
    description: "Fast local iteration with Claude as the default runtime and the standard safety rails.",
    runtimeDefault: "claude",
    denyCommands: baseDeniedCommands
  },
  "ci-guarded": {
    name: "ci-guarded",
    description: "Stricter CI-oriented defaults with Codex as the default runtime and publish-style commands denied.",
    runtimeDefault: "codex",
    denyCommands: [...baseDeniedCommands, "npm publish", "pnpm publish", "yarn publish"]
  }
}

export function isConfigPresetName(value: string): value is ConfigPresetName {
  return configPresetNames.includes(value as ConfigPresetName)
}

export function applyConfigPreset(config: ProjectConfig, presetName?: ConfigPresetName): ProjectConfig {
  if (!presetName) {
    return config
  }

  const preset = configPresets[presetName]

  return {
    ...config,
    runtime: {
      ...config.runtime,
      default: preset.runtimeDefault
    },
    policy: {
      ...config.policy,
      denyCommands: preset.denyCommands
    }
  }
}
