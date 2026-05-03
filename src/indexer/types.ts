export type CodeNodeKind =
  | "file"
  | "module"
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "route"
  | "component"
  | "hook"
  | "test"
  | "migration"

export type CodeEdgeKind = "imports" | "exports" | "declares"

export type IndexedCodeNode = {
  id: string
  repoId: string
  kind: CodeNodeKind
  path: string
  symbol?: string
  startLine: number
  endLine: number
  hash: string
  metadataJson?: string
}

export type IndexedCodeEdge = {
  id: string
  repoId: string
  fromCodeNodeId: string
  toCodeNodeId: string
  edgeType: CodeEdgeKind
}

export type IndexExtraction = {
  nodes: IndexedCodeNode[]
  edges: IndexedCodeEdge[]
  indexedPaths: string[]
}

export type IndexSummary = {
  files: number
  functions: number
  classes: number
  interfaces: number
  types: number
  routes: number
  components: number
  tests: number
  edges: number
}
