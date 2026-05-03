export type SemanticNodeSummary = {
  path: string
  kind: string
  symbol: string | null
  hash?: string
}

export type SemanticDiffSummary = {
  changedFiles: string[]
  semanticCoverage: {
    mode: "ast" | "partial" | "file-only"
    analyzedFiles: string[]
    fileOnlyFiles: string[]
  }
  addedNodes: SemanticNodeSummary[]
  removedNodes: SemanticNodeSummary[]
  modifiedNodes: SemanticNodeSummary[]
  addedExports: Array<{ path: string; symbol: string }>
  removedExports: Array<{ path: string; symbol: string }>
}

export type VerificationCheckSummary = {
  type: string
  status: "passed" | "failed" | "missing" | "info"
  summary: string
  output?: string
}

export type VerificationViolationSummary = {
  severity: "blocking" | "warning"
  type: string
  message: string
}

export type VerifyPatchResult = {
  status: "accepted" | "warning" | "rejected"
  patchId: string
  taskId: string
  runtimeName: string
  patchStatus: string
  taskStatus: string
  goal: string
  changedFiles: string[]
  semanticDiff: SemanticDiffSummary
  checks: VerificationCheckSummary[]
  requiredCheckTypes: string[]
  blockingViolations: VerificationViolationSummary[]
  warnings: VerificationViolationSummary[]
  nextStep: string
}

export type ReviewPatchResult = {
  status: "reviewed"
  patchId: string
  taskId: string
  runtimeName: string
  goal: string
  summary: string
  changedFiles: string[]
  semanticDiff: SemanticDiffSummary
  checks: VerificationCheckSummary[]
  requiredCheckTypes: string[]
  warnings: VerificationViolationSummary[]
  blockingViolations: VerificationViolationSummary[]
  nextActions: string[]
}
