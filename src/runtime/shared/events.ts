import { createId } from "../../core/ids.js"
import { nowIso } from "../../core/time.js"

import type { RuntimeEvent } from "./contracts.js"

export function createRuntimeEvent<TEvent extends RuntimeEvent>(
  event: Omit<TEvent, "id" | "timestamp">
): TEvent {
  return {
    id: createId(),
    timestamp: nowIso(),
    ...event
  } as TEvent
}
