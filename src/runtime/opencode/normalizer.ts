import { createRuntimeEvent } from "../shared/events.js"
import type { RuntimeEvent } from "../shared/contracts.js"

export type OpencodeRawEvent =
  | { type: "assistant"; content: string }
  | { type: "tool"; toolName: string; input?: unknown }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "error"; message: string }
  | { type: "complete"; success: boolean }

export function normalizeOpencodeEvent(rawEvent: OpencodeRawEvent): RuntimeEvent {
  switch (rawEvent.type) {
    case "assistant":
      return createRuntimeEvent<Extract<RuntimeEvent, { type: "message" }>>({
        type: "message",
        role: "assistant",
        content: rawEvent.content
      })
    case "tool":
      return createRuntimeEvent<Extract<RuntimeEvent, { type: "tool_call" }>>({
        type: "tool_call",
        toolName: rawEvent.toolName,
        input: rawEvent.input
      })
    case "usage":
      return createRuntimeEvent<Extract<RuntimeEvent, { type: "usage" }>>({
        type: "usage",
        inputTokens: rawEvent.inputTokens,
        outputTokens: rawEvent.outputTokens
      })
    case "error":
      return createRuntimeEvent<Extract<RuntimeEvent, { type: "error" }>>({
        type: "error",
        message: rawEvent.message
      })
    case "complete":
      return createRuntimeEvent<Extract<RuntimeEvent, { type: "complete" }>>({
        type: "complete",
        success: rawEvent.success
      })
  }
}
