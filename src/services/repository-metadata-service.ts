import { realpath } from "node:fs/promises"

import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { detectPackageManager } from "../config/defaults.js"
import { openDatabaseConnection, type XieZhiDatabase } from "../db/client.js"
import * as schema from "../db/schema.js"
import { repositoriesTable } from "../db/schema.js"
import { stableId } from "../core/ids.js"
import { nowIso } from "../core/time.js"
import { runGit } from "../core/git.js"

export type RepositoryMetadata = {
  id: string
  rootPath: string
  gitDir: string
  currentBranch: string | null
  headCommit: string
  isDirty: boolean
  packageManager: string
  createdAt: string
  updatedAt: string
}

async function inspectRepository(cwd: string) {
  const rootPathRaw = (await runGit(["rev-parse", "--show-toplevel"], cwd)).stdout.trim()
  const gitDirRaw = (await runGit(["rev-parse", "--absolute-git-dir"], cwd)).stdout.trim()
  const headCommit = (await runGit(["rev-parse", "HEAD"], cwd)).stdout.trim()
  const branchResult = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
  const statusResult = await runGit(["status", "--porcelain"], cwd)
  const rootPath = await realpath(rootPathRaw)
  const gitDir = await realpath(gitDirRaw)

  return {
    rootPath,
    gitDir,
    currentBranch: branchResult.stdout.trim() === "HEAD" ? null : branchResult.stdout.trim(),
    headCommit,
    isDirty: statusResult.stdout.trim().length > 0,
    packageManager: detectPackageManager(rootPath)
  }
}

export class RepositoryMetadataService {
  constructor(private readonly db: XieZhiDatabase) {}

  async refreshForCwd(cwd: string): Promise<RepositoryMetadata> {
    const details = await inspectRepository(cwd)
    const existing = this.db
      .select()
      .from(repositoriesTable)
      .where(eq(repositoriesTable.rootPath, details.rootPath))
      .get()
    const timestamp = nowIso()
    const id = existing?.id ?? stableId("repo", details.rootPath)

    this.db
      .insert(repositoriesTable)
      .values({
        id,
        rootPath: details.rootPath,
        gitDir: details.gitDir,
        currentBranch: details.currentBranch,
        headCommit: details.headCommit,
        isDirty: details.isDirty,
        packageManager: details.packageManager,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      })
      .onConflictDoUpdate({
        target: repositoriesTable.rootPath,
        set: {
          gitDir: details.gitDir,
          currentBranch: details.currentBranch,
          headCommit: details.headCommit,
          isDirty: details.isDirty,
          packageManager: details.packageManager,
          updatedAt: timestamp
        }
      })
      .run()

    const stored = this.db.select().from(repositoriesTable).where(eq(repositoriesTable.id, id)).get()

    if (!stored) {
      throw new Error("Failed to persist repository metadata.")
    }

    return stored
  }

  getById(id: string) {
    return this.db.select().from(repositoriesTable).where(eq(repositoriesTable.id, id)).get()
  }
}

export async function refreshRepositoryMetadata(cwd: string) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    const service = new RepositoryMetadataService(drizzle(sqlite, { schema }))
    return await service.refreshForCwd(cwd)
  } finally {
    sqlite.close()
  }
}
