import { realpath } from "node:fs/promises"

import { and, eq, inArray, or } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { assertDatabaseInitialized, openDatabaseConnection, type XieZhiDatabase } from "../db/client.js"
import * as schema from "../db/schema.js"
import { codeEdgesTable, codeNodesTable } from "../db/schema.js"
import { runGit } from "../core/git.js"
import { extractCodeGraph } from "../indexer/extractor.js"
import { getSourceFilesByRelativePath, loadProject } from "../indexer/project-loader.js"
import type { IndexExtraction, IndexSummary } from "../indexer/types.js"
import { RepositoryMetadataService } from "./repository-metadata-service.js"

export type IndexMode = "full" | "incremental"

export type IndexResult = {
  repoId: string
  requestedMode: IndexMode
  executedMode: IndexMode
  indexedPaths: string[]
  deletedPaths: string[]
  summary: IndexSummary
}

function summarizeExtraction(extraction: IndexExtraction): IndexSummary {
  return {
    files: extraction.nodes.filter((node) => node.kind === "file").length,
    functions: extraction.nodes.filter((node) => node.kind === "function").length,
    classes: extraction.nodes.filter((node) => node.kind === "class").length,
    interfaces: extraction.nodes.filter((node) => node.kind === "interface").length,
    types: extraction.nodes.filter((node) => node.kind === "type").length,
    routes: extraction.nodes.filter((node) => node.kind === "route").length,
    components: extraction.nodes.filter((node) => node.kind === "component").length,
    tests: extraction.nodes.filter((node) => node.kind === "test").length,
    edges: extraction.edges.length
  }
}

async function detectIncrementalPaths(repoRoot: string) {
  const status = (await runGit(["status", "--porcelain", "--untracked-files=all"], repoRoot)).stdout
  const changedPaths: string[] = []
  const deletedPaths: string[] = []

  for (const line of status.split("\n").filter(Boolean)) {
    const filePath = line.slice(3).trim()
    if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) {
      continue
    }
    if (line.startsWith("D ") || line.startsWith(" D")) {
      deletedPaths.push(filePath)
      continue
    }
    changedPaths.push(filePath)
  }

  return { changedPaths, deletedPaths }
}

function deleteExistingForPaths(db: XieZhiDatabase, repoId: string, paths: string[]) {
  if (paths.length === 0) {
    return
  }

  const existingNodes = db
    .select({ id: codeNodesTable.id })
    .from(codeNodesTable)
    .where(and(eq(codeNodesTable.repoId, repoId), inArray(codeNodesTable.path, paths)))
    .all()

  const nodeIds = existingNodes.map((node) => node.id)

  if (nodeIds.length > 0) {
    db.delete(codeEdgesTable)
      .where(
        and(
          eq(codeEdgesTable.repoId, repoId),
          or(inArray(codeEdgesTable.fromCodeNodeId, nodeIds), inArray(codeEdgesTable.toCodeNodeId, nodeIds))
        )
      )
      .run()
  }

  db.delete(codeNodesTable)
    .where(and(eq(codeNodesTable.repoId, repoId), inArray(codeNodesTable.path, paths)))
    .run()
}

export class CodeIndexService {
  constructor(private readonly db: XieZhiDatabase) {}

  async indexRepository(cwd: string, requestedMode: IndexMode): Promise<IndexResult> {
    const repoRoot = await realpath(cwd)
    const repositoryService = new RepositoryMetadataService(this.db)
    const repository = await repositoryService.refreshForCwd(repoRoot)

    const { project, sourceFiles } = loadProject(repoRoot)

    let executedMode: IndexMode = requestedMode
    let targetSourceFiles = sourceFiles
    let deletedPaths: string[] = []

    if (requestedMode === "incremental") {
      const incremental = await detectIncrementalPaths(repoRoot)
      deletedPaths = incremental.deletedPaths

      const shouldFallbackToFull =
        sourceFiles.length > 0 &&
        incremental.changedPaths.length + incremental.deletedPaths.length >= sourceFiles.length

      if (shouldFallbackToFull) {
        executedMode = "full"
        this.db.delete(codeEdgesTable).where(eq(codeEdgesTable.repoId, repository.id)).run()
        this.db.delete(codeNodesTable).where(eq(codeNodesTable.repoId, repository.id)).run()
      } else {
        if (incremental.changedPaths.length === 0 && incremental.deletedPaths.length === 0) {
          return {
            repoId: repository.id,
            requestedMode,
            executedMode: "incremental",
            indexedPaths: [],
            deletedPaths: [],
            summary: {
              files: 0,
              functions: 0,
              classes: 0,
              interfaces: 0,
              types: 0,
              routes: 0,
              components: 0,
              tests: 0,
              edges: 0
            }
          }
        }

        const filesToIndex = getSourceFilesByRelativePath(repoRoot, sourceFiles, incremental.changedPaths)

        if (filesToIndex.length === 0) {
          return {
            repoId: repository.id,
            requestedMode,
            executedMode: "incremental",
            indexedPaths: [],
            deletedPaths,
            summary: {
              files: 0,
              functions: 0,
              classes: 0,
              interfaces: 0,
              types: 0,
              routes: 0,
              components: 0,
              tests: 0,
              edges: 0
            }
          }
        }

        targetSourceFiles = filesToIndex
        deleteExistingForPaths(this.db, repository.id, [...incremental.changedPaths, ...deletedPaths])
      }
    } else {
      this.db.delete(codeEdgesTable).where(eq(codeEdgesTable.repoId, repository.id)).run()
      this.db.delete(codeNodesTable).where(eq(codeNodesTable.repoId, repository.id)).run()
    }

    const extraction = extractCodeGraph({
      repoId: repository.id,
      repoRoot,
      project,
      sourceFiles: targetSourceFiles
    })

    if (extraction.nodes.length > 0) {
      this.db.insert(codeNodesTable).values(extraction.nodes).run()
    }
    if (extraction.edges.length > 0) {
      this.db.insert(codeEdgesTable).values(extraction.edges).run()
    }

    const summary = summarizeExtraction(extraction)

    return {
      repoId: repository.id,
      requestedMode,
      executedMode,
      indexedPaths: extraction.indexedPaths,
      deletedPaths,
      summary
    }
  }
}

export async function indexRepository(cwd: string, requestedMode: IndexMode) {
  const sqlite = openDatabaseConnection(cwd)
  try {
    assertDatabaseInitialized(cwd, sqlite)
    const service = new CodeIndexService(drizzle(sqlite, { schema }))
    return await service.indexRepository(cwd, requestedMode)
  } finally {
    sqlite.close()
  }
}
