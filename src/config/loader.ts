import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"

import { XieZhiError } from "../core/errors.js"
import { createDefaultConfig } from "./defaults.js"
import { getConfigPath, getXieZhiDir } from "./paths.js"
import { parseYamlConfig, stringifyYamlConfig } from "./parsers.js"
import { projectConfigSchema, type ProjectConfig } from "./schema.js"

export async function ensureXieZhiDir(cwd: string) {
  await mkdir(getXieZhiDir(cwd), { recursive: true })
}

export async function loadProjectConfig(cwd: string): Promise<ProjectConfig> {
  const configPath = getConfigPath(cwd)

  if (!existsSync(configPath)) {
    throw new XieZhiError("CONFIG_NOT_FOUND", "XieZhi config not found.", {
      hint: "Run `xz init` in this repository first."
    })
  }

  const source = await readFile(configPath, "utf8")
  const parsed = parseYamlConfig(source)
  const result = projectConfigSchema.safeParse(parsed)

  if (!result.success) {
    throw new XieZhiError("CONFIG_INVALID", "XieZhi config is invalid.", {
      hint: result.error.issues.map((issue) => issue.message).join("; ")
    })
  }

  return result.data
}

export async function writeProjectConfig(cwd: string, config: ProjectConfig) {
  await ensureXieZhiDir(cwd)
  const configPath = getConfigPath(cwd)
  const source = stringifyYamlConfig(config)
  await writeFile(configPath, source, "utf8")
}

export async function initializeDefaultConfig(cwd: string) {
  const config = createDefaultConfig(cwd)
  await writeProjectConfig(cwd, config)
  return config
}
