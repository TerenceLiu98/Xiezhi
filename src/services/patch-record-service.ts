import { eq } from "drizzle-orm"

import type { RuntimeName, CommandLog } from "../runtime/shared/index.js"
import { createId } from "../core/ids.js"
import { nowIso } from "../core/time.js"
import type { XieZhiDatabase } from "../db/client.js"
import { commandLogsTable, patchesTable } from "../db/schema.js"

export type PatchStatus = "pending" | "verified" | "rejected" | "merged" | "discarded"
export type ActivePatchStatus = PatchStatus | "accepted"

export type CreatePatchInput = {
  taskId: string
  baseCommit: string
  worktreePath: string
  runtimeName: RuntimeName
  changedFiles: string[]
  diff?: string
  semanticDiffJson?: string | null
  status?: PatchStatus
}

export class PatchRecordService {
  constructor(private readonly db: XieZhiDatabase) {}

  createPatch(input: CreatePatchInput) {
    const timestamp = nowIso()
    const patchId = createId()

    this.db
      .insert(patchesTable)
      .values({
        id: patchId,
        taskId: input.taskId,
        baseCommit: input.baseCommit,
        worktreePath: input.worktreePath,
        runtimeName: input.runtimeName,
        changedFilesJson: JSON.stringify(input.changedFiles),
        diff: input.diff ?? "",
        semanticDiffJson: input.semanticDiffJson ?? null,
        status: input.status ?? "pending",
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run()

    return patchId
  }

  appendCommandLogs(patchId: string, logs: CommandLog[]) {
    const timestamp = nowIso()

    if (logs.length === 0) {
      return
    }

    this.db
      .insert(commandLogsTable)
      .values(
        logs.map((log) => ({
          id: createId(),
          patchId,
          command: log.command,
          exitCode: log.exitCode,
          output: log.output,
          createdAt: timestamp
        }))
      )
      .run()
  }

  updatePatchStatus(patchId: string, status: ActivePatchStatus) {
    this.db
      .update(patchesTable)
      .set({
        status,
        updatedAt: nowIso()
      })
      .where(eq(patchesTable.id, patchId))
      .run()
  }

  updateSemanticDiff(patchId: string, semanticDiffJson: string | null) {
    this.db
      .update(patchesTable)
      .set({
        semanticDiffJson,
        updatedAt: nowIso()
      })
      .where(eq(patchesTable.id, patchId))
      .run()
  }

  updatePatchSnapshot(patchId: string, input: { changedFiles: string[]; diff: string }) {
    this.db
      .update(patchesTable)
      .set({
        changedFilesJson: JSON.stringify(input.changedFiles),
        diff: input.diff,
        updatedAt: nowIso()
      })
      .where(eq(patchesTable.id, patchId))
      .run()
  }

  getPatch(patchId: string) {
    const patch = this.db.select().from(patchesTable).where(eq(patchesTable.id, patchId)).get()

    if (!patch) {
      return null
    }

    const commandLogs = this.db
      .select()
      .from(commandLogsTable)
      .where(eq(commandLogsTable.patchId, patchId))
      .all()

    return {
      ...patch,
      changedFiles: JSON.parse(patch.changedFilesJson) as string[],
      semanticDiff: patch.semanticDiffJson ? (JSON.parse(patch.semanticDiffJson) as unknown) : null,
      commandLogs
    }
  }

  listPatchesForTaskIds(taskIds: string[]) {
    if (taskIds.length === 0) {
      return []
    }

    return this.db
      .select()
      .from(patchesTable)
      .all()
      .filter((patch) => taskIds.includes(patch.taskId))
      .map((patch) => ({
        ...patch,
        changedFiles: JSON.parse(patch.changedFilesJson) as string[]
      }))
  }
}
