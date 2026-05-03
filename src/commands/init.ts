import { existsSync } from "node:fs"

import { createDefaultConfig, detectPackageManager } from "../config/defaults.js"
import { initializeDefaultConfig } from "../config/loader.js"
import { getConfigPath, getDatabasePath, getXieZhiDir } from "../config/paths.js"
import { bootstrapDatabase } from "../db/bootstrap.js"
import { openDatabaseConnection } from "../db/client.js"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "../db/schema.js"
import { RepositoryMetadataService, type RepositoryMetadata } from "../services/repository-metadata-service.js"

export type InitResult = {
  metadataDir: string
  configPath: string
  databasePath: string
  packageManager: string
  createdConfig: boolean
  appliedMigrations: string[]
  repository: RepositoryMetadata
}

export async function runInit(cwd: string): Promise<InitResult> {
  const packageManager = detectPackageManager(cwd)
  const metadataDir = getXieZhiDir(cwd)
  const configPath = getConfigPath(cwd)
  const databasePath = getDatabasePath(cwd)
  const createdConfig = !existsSync(configPath)

  if (createdConfig) {
    await initializeDefaultConfig(cwd)
  } else {
    createDefaultConfig(cwd)
  }

  const sqlite = openDatabaseConnection(cwd)

  try {
    const result = await bootstrapDatabase(cwd, sqlite)
    const repositoryService = new RepositoryMetadataService(drizzle(sqlite, { schema }))
    const repository = await repositoryService.refreshForCwd(cwd)

    return {
      metadataDir,
      configPath,
      databasePath,
      packageManager,
      createdConfig,
      appliedMigrations: result.appliedMigrations,
      repository
    }
  } finally {
    sqlite.close()
  }
}
