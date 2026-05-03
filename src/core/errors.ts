export type XieZhiErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "PROJECT_NOT_INITIALIZED"
  | "DATABASE_ERROR"
  | "GIT_ERROR"
  | "CLI_USAGE_ERROR"
  | "NOT_IMPLEMENTED"

export class XieZhiError extends Error {
  readonly code: XieZhiErrorCode
  readonly hint?: string
  readonly causeValue?: unknown

  constructor(code: XieZhiErrorCode, message: string, options?: { hint?: string; cause?: unknown }) {
    super(message)
    this.name = "XieZhiError"
    this.code = code
    this.hint = options?.hint
    this.causeValue = options?.cause
  }
}

export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value
  }

  return new Error(typeof value === "string" ? value : "Unknown error")
}
