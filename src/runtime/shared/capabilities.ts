import { execa } from "execa"

import type { RuntimeName } from "./contracts.js"

export type RuntimeAvailability = {
  runtime: RuntimeName
  binary: string
  available: boolean
  reason?: string
}

const RUNTIME_BINARIES: Record<RuntimeName, string> = {
  opencode: "opencode",
  claude: "claude",
  codex: "codex"
}

const availabilityCache = new Map<RuntimeName, RuntimeAvailability>()

export async function detectRuntimeAvailability(runtime: RuntimeName): Promise<RuntimeAvailability> {
  if (process.env.XIEZHI_FORCE_SCAFFOLD_RUNTIMES === "1") {
    return {
      runtime,
      binary: RUNTIME_BINARIES[runtime],
      available: false,
      reason: "real runtimes disabled by XIEZHI_FORCE_SCAFFOLD_RUNTIMES"
    }
  }

  const cached = availabilityCache.get(runtime)
  if (cached) {
    return cached
  }

  const binary = RUNTIME_BINARIES[runtime]

  try {
    const result = await execa("which", [binary], { reject: true })
    const availability = {
      runtime,
      binary,
      available: true,
      reason: result.stdout.trim() || undefined
    } satisfies RuntimeAvailability
    availabilityCache.set(runtime, availability)
    return availability
  } catch {
    const availability = {
      runtime,
      binary,
      available: false,
      reason: `${binary} not found on PATH`
    } satisfies RuntimeAvailability
    availabilityCache.set(runtime, availability)
    return availability
  }
}

export function clearRuntimeAvailabilityCache() {
  availabilityCache.clear()
}
