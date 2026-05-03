import { existsSync } from "node:fs"

import Database from "better-sqlite3"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"

import { XieZhiError } from "../core/errors.js"
import { getDatabasePath } from "../config/paths.js"
import * as schema from "./schema.js"

export type XieZhiDatabase = BetterSQLite3Database<typeof schema>

export function openDatabaseConnection(cwd: string): Database.Database {
  return new Database(getDatabasePath(cwd))
}

export function openDrizzle(cwd: string): XieZhiDatabase {
  const sqlite = openDatabaseConnection(cwd)
  return drizzle(sqlite, { schema })
}

export function assertDatabaseInitialized(cwd: string, sqlite: Database.Database) {
  const databasePath = getDatabasePath(cwd)

  if (!existsSync(databasePath)) {
    throw new XieZhiError("PROJECT_NOT_INITIALIZED", "XieZhi database not found.", {
      hint: "Run `xz init` in this repository first."
    })
  }

  const repositoriesTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("repositories") as { name: string } | undefined

  if (!repositoriesTable) {
    throw new XieZhiError("PROJECT_NOT_INITIALIZED", "XieZhi database is not initialized.", {
      hint: "Run `xz init` in this repository first so migrations can create the required tables."
    })
  }
}
