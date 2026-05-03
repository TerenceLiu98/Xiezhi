import { existsSync, readdirSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type Database from "better-sqlite3"

import { getXieZhiDir } from "../config/paths.js"

const MIGRATIONS_TABLE = "__xiezhi_migrations"

function ensureMigrationsTable(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)
}

function resolveMigrationsDir(cwd: string) {
  const bootstrapFile = fileURLToPath(import.meta.url)
  const candidateDirs = [
    path.resolve(cwd, "drizzle"),
    path.resolve(path.dirname(bootstrapFile), "../drizzle"),
    path.resolve(path.dirname(bootstrapFile), "../../drizzle")
  ]

  return candidateDirs.find((candidate) => existsSync(candidate))
}

export async function bootstrapDatabase(cwd: string, sqlite: Database.Database) {
  await mkdir(getXieZhiDir(cwd), { recursive: true })
  ensureMigrationsTable(sqlite)

  const migrationsDir = resolveMigrationsDir(cwd)

  if (!migrationsDir || !existsSync(migrationsDir)) {
    return { appliedMigrations: [] as string[] }
  }

  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()

  const appliedMigrations: string[] = []
  const insertMigration = sqlite.prepare(
    `INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`
  )
  const selectMigration = sqlite.prepare(`SELECT id FROM ${MIGRATIONS_TABLE} WHERE id = ?`)

  for (const migrationFile of migrationFiles) {
    const existing = selectMigration.get(migrationFile)

    if (existing) {
      continue
    }

    const source = readFileSync(path.join(migrationsDir, migrationFile), "utf8")
    sqlite.exec(source)
    insertMigration.run(migrationFile, new Date().toISOString())
    appliedMigrations.push(migrationFile)
  }

  return { appliedMigrations }
}
