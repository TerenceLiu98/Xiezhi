import { indexRepository, type IndexMode } from "../services/code-index-service.js"

export type IndexCommandInput = {
  cwd: string
  mode: IndexMode
}

export async function runIndexCommand(input: IndexCommandInput) {
  const result = await indexRepository(input.cwd, input.mode)

  return {
    status: "indexed",
    cwd: input.cwd,
    mode: result.requestedMode,
    executedMode: result.executedMode,
    repoId: result.repoId,
    indexedPaths: result.indexedPaths,
    deletedPaths: result.deletedPaths,
    summary: result.summary
  }
}
