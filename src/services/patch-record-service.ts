import { eq } from "drizzle-orm"

import type { RuntimeName, CommandLog } from "../runtime/shared/index.js"
import { createId } from "../core/ids.js"
import { nowIso } from "../core/time.js"
import type { XieZhiDatabase } from "../db/client.js"
import { commandLogsTable, patchesTable } from "../db/schema.js"

export type PatchStatus = "pending" | "verified" | "rejected" | "merged" | "discarded" | "promoted"
export type ActivePatchStatus = PatchStatus | "accepted"

export type CreatePatchInput = {
  taskId: string
  baseCommit: string
  worktreePath: string
  runtimeName: RuntimeName
  runtimeMode?: "real" | "scaffold"
  runtimeEvidence?: PatchRuntimeEvidence
  agentRunId?: string | null
  changedFiles: string[]
  diff?: string
  semanticDiffJson?: string | null
  status?: PatchStatus
}

export type PatchRuntimeEvidence = {
  mode: "real" | "scaffold"
  success: boolean
  emptyPatch: boolean
  eventCount: number
  commandCount: number
  latestCommand: string | null
  latestCommandExitCode: number | null
  message: string
}

export type PatchPromotionEvidence = {
  promotedAt: string
  repoRoot: string
  committed: boolean
  commitHash: string | null
  changedFiles: string[]
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
        runtimeMode: input.runtimeMode ?? input.runtimeEvidence?.mode ?? "scaffold",
        runtimeEvidenceJson: input.runtimeEvidence ? JSON.stringify(input.runtimeEvidence) : null,
        agentRunId: input.agentRunId ?? null,
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
    const existingPatch = this.db.select().from(patchesTable).where(eq(patchesTable.id, patchId)).get()
    const existingEvidence = existingPatch?.runtimeEvidenceJson
      ? (JSON.parse(existingPatch.runtimeEvidenceJson) as PatchRuntimeEvidence)
      : null
    const runtimeEvidenceJson = existingEvidence
      ? JSON.stringify({
          ...existingEvidence,
          emptyPatch: input.changedFiles.length === 0,
          message:
            input.changedFiles.length === 0
              ? existingEvidence.mode === "real"
                ? "Runtime launched successfully but produced no captured edits."
                : "Scaffold runtime completed without captured edits."
              : `Runtime produced ${input.changedFiles.length} changed file${input.changedFiles.length === 1 ? "" : "s"}.`
        } satisfies PatchRuntimeEvidence)
      : undefined

    this.db
      .update(patchesTable)
      .set({
        changedFilesJson: JSON.stringify(input.changedFiles),
        diff: input.diff,
        ...(runtimeEvidenceJson ? { runtimeEvidenceJson } : {}),
        updatedAt: nowIso()
      })
      .where(eq(patchesTable.id, patchId))
      .run()
  }

  updatePatchAgentRun(patchId: string, agentRunId: string) {
    this.db
      .update(patchesTable)
      .set({
        agentRunId,
        updatedAt: nowIso()
      })
      .where(eq(patchesTable.id, patchId))
      .run()
  }

  updatePatchPromotion(patchId: string, evidence: PatchPromotionEvidence) {
    this.db
      .update(patchesTable)
      .set({
        status: "promoted",
        promotionJson: JSON.stringify(evidence),
        promotedAt: evidence.promotedAt,
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
      runtimeEvidence: patch.runtimeEvidenceJson ? (JSON.parse(patch.runtimeEvidenceJson) as PatchRuntimeEvidence) : null,
      promotion: patch.promotionJson ? (JSON.parse(patch.promotionJson) as PatchPromotionEvidence) : null,
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
        changedFiles: JSON.parse(patch.changedFilesJson) as string[],
        runtimeEvidence: patch.runtimeEvidenceJson ? (JSON.parse(patch.runtimeEvidenceJson) as PatchRuntimeEvidence) : null
      }))
  }
}
