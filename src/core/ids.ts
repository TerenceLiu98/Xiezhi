import { createHash, randomUUID } from "node:crypto"

export function createId() {
  return randomUUID()
}

export function stableId(prefix: string, source: string) {
  const hash = createHash("sha1").update(source).digest("hex")
  return `${prefix}_${hash}`
}
