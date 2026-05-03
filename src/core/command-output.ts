import pc from "picocolors"
import path from "node:path"

export function printSection(title: string, lines: string[]) {
  console.log(pc.bold(title))
  for (const line of lines) {
    console.log(line)
  }
  console.log("")
}

export function printKeyValue(label: string, value: string) {
  console.log(`${pc.cyan(label)} ${value}`)
}

export function formatStatus(status: string) {
  switch (status) {
    case "done":
    case "verified":
    case "loaded":
    case "captured":
    case "indexed":
    case "planned":
    case "ready":
    case "accepted":
    case "reviewed":
    case "passed":
    case "success":
      return pc.green(status)
    case "running":
    case "pending":
    case "draft":
    case "warning":
    case "missing":
      return pc.yellow(status)
    case "rejected":
    case "blocked":
    case "error":
    case "failed":
    case "discarded":
      return pc.red(status)
    default:
      return pc.cyan(status)
  }
}

export function printList(title: string, items: string[], options?: { emptyText?: string }) {
  console.log(pc.bold(title))
  if (items.length === 0) {
    console.log(`  - ${options?.emptyText ?? "none"}`)
    console.log("")
    return
  }

  for (const item of items) {
    console.log(`  - ${item}`)
  }
  console.log("")
}

export function printCard(title: string, lines: string[]) {
  console.log(pc.bold(title))
  for (const line of lines) {
    console.log(`  ${line}`)
  }
  console.log("")
}

export function renderPathTree(basePath: string, targetPath: string) {
  const relativePath = path.relative(basePath, targetPath) || "."
  const segments = relativePath.split(path.sep).filter(Boolean)

  if (segments.length === 0) {
    return [". (repo root)"]
  }

  return segments.map((segment, index) => {
    const prefix = index === segments.length - 1 ? "`- " : "|- "
    return `${"  ".repeat(index)}${prefix}${segment}`
  })
}

export function formatInlineList(items: string[], options?: { emptyText?: string; max?: number }) {
  if (items.length === 0) {
    return options?.emptyText ?? "none"
  }

  const max = options?.max ?? items.length
  const visible = items.slice(0, max)
  const suffix = items.length > max ? ` (+${items.length - max} more)` : ""
  return `${visible.join(", ")}${suffix}`
}

export function shortenId(value: string, length = 8) {
  return value.slice(0, length)
}

export function printIndentedList(title: string, items: string[], options?: { emptyText?: string }) {
  console.log(`  ${pc.bold(title)}`)
  if (items.length === 0) {
    console.log(`    - ${options?.emptyText ?? "none"}`)
    return
  }

  for (const item of items) {
    console.log(`    - ${item}`)
  }
}
