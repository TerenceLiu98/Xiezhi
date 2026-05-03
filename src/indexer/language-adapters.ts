import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { stableId } from "../core/ids.js"
import type { IndexExtraction, IndexedCodeEdge, IndexedCodeNode } from "./types.js"

const require = createRequire(import.meta.url)
const Parser = require("tree-sitter")
const JavaScript = require("tree-sitter-javascript")
const Python = require("tree-sitter-python")
const TypeScript = require("tree-sitter-typescript")

type SyntaxNode = {
  type: string
  text: string
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  namedChildCount: number
  namedChild(index: number): SyntaxNode | null
  childForFieldName(name: string): SyntaxNode | null
  parent?: SyntaxNode | null
}

type LanguageId = "typescript" | "tsx" | "javascript" | "jsx" | "python"

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py"])
const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete"])
const TEST_CALLS = new Set(["it", "test"])

function createNodeHash(parts: Array<string | number | undefined>) {
  const source = parts.filter((part) => part !== undefined && part !== "").join("|")
  return createHash("sha1").update(source).digest("hex")
}

function nodeId(repoId: string, kind: string, filePath: string, symbol?: string, startLine?: number, endLine?: number) {
  return stableId(kind, `${repoId}:${filePath}:${symbol ?? ""}:${startLine ?? 0}:${endLine ?? 0}`)
}

function edgeId(repoId: string, fromNodeId: string, toNodeId: string, edgeType: string) {
  return stableId("edge", `${repoId}:${edgeType}:${fromNodeId}:${toNodeId}`)
}

function lineRange(node: SyntaxNode) {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1
  }
}

function childText(node: SyntaxNode, fieldName: string) {
  return node.childForFieldName(fieldName)?.text ?? null
}

function firstNamedChildOfType(node: SyntaxNode, type: string) {
  for (let index = 0; index < node.namedChildCount; index++) {
    const child = node.namedChild(index)
    if (child?.type === type) {
      return child
    }
  }
  return null
}

function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
  visit(node)
  for (let index = 0; index < node.namedChildCount; index++) {
    const child = node.namedChild(index)
    if (child) {
      walk(child, visit)
    }
  }
}

function containsNodeType(node: SyntaxNode, types: Set<string>) {
  let found = false
  walk(node, (current) => {
    if (types.has(current.type)) {
      found = true
    }
  })
  return found
}

function isTestFile(filePath: string) {
  return /(^|\/)(tests?|__tests__)\//.test(filePath) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath) || /test_.*\.py$/.test(filePath)
}

function maybeComponentName(name: string | null) {
  return Boolean(name && /^[A-Z]/.test(name))
}

function maybeHookName(name: string | null) {
  return Boolean(name && /^use[A-Z0-9_]/.test(name))
}

function languageForPath(filePath: string): LanguageId | null {
  if (filePath.endsWith(".tsx")) return "tsx"
  if (filePath.endsWith(".ts")) return "typescript"
  if (filePath.endsWith(".jsx")) return "jsx"
  if (filePath.endsWith(".js")) return "javascript"
  if (filePath.endsWith(".py")) return "python"
  return null
}

function grammarForLanguage(language: LanguageId) {
  if (language === "typescript") return TypeScript.typescript
  if (language === "tsx") return TypeScript.tsx
  if (language === "javascript" || language === "jsx") return JavaScript
  return Python
}

function normalizeTextSymbol(value: string | null) {
  if (!value) return null
  return value.replace(/^['"`]|['"`]$/g, "")
}

function getMemberPropertyName(node: SyntaxNode | null) {
  if (!node) return null
  if (node.type === "identifier" || node.type === "property_identifier") {
    return node.text
  }
  const property = node.childForFieldName("property")
  if (property) {
    return property.text
  }
  return null
}

function getCallName(node: SyntaxNode) {
  const fn = node.childForFieldName("function")
  if (!fn) return null
  if (fn.type === "identifier") return fn.text
  return getMemberPropertyName(fn)
}

function createFileNode(repoId: string, filePath: string, source: string, endLine: number): IndexedCodeNode {
  return {
    id: nodeId(repoId, "file", filePath, filePath, 1, endLine),
    repoId,
    kind: "file",
    path: filePath,
    symbol: filePath,
    startLine: 1,
    endLine,
    hash: createNodeHash([repoId, "file", filePath, source])
  }
}

function makeDeclaredNode(input: {
  repoId: string
  filePath: string
  kind: IndexedCodeNode["kind"]
  symbol: string
  node: SyntaxNode
  metadata?: Record<string, unknown>
}): IndexedCodeNode {
  const range = lineRange(input.node)
  return {
    id: nodeId(input.repoId, input.kind, input.filePath, input.symbol, range.startLine, range.endLine),
    repoId: input.repoId,
    kind: input.kind,
    path: input.filePath,
    symbol: input.symbol,
    startLine: range.startLine,
    endLine: range.endLine,
    hash: createNodeHash([input.repoId, input.kind, input.filePath, input.symbol, input.node.text]),
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined
  }
}

function extractJsLikeNodes(input: {
  repoId: string
  filePath: string
  fileNodeId: string
  root: SyntaxNode
  language: LanguageId
}) {
  const nodes: IndexedCodeNode[] = []
  const jsxTypes = new Set(["jsx_element", "jsx_self_closing_element", "jsx_fragment"])

  const push = (node: IndexedCodeNode) => {
    nodes.push(node)
  }

  walk(input.root, (node) => {
    if (node.type === "function_declaration" || node.type === "generator_function_declaration") {
      const symbol = childText(node, "name") ?? "<anonymous>"
      push(
        makeDeclaredNode({
          repoId: input.repoId,
          filePath: input.filePath,
          kind: maybeHookName(symbol) ? "hook" : "function",
          symbol,
          node,
          metadata: { language: input.language }
        })
      )
      if (maybeComponentName(symbol) && containsNodeType(node, jsxTypes)) {
        push(makeDeclaredNode({ repoId: input.repoId, filePath: input.filePath, kind: "component", symbol, node, metadata: { language: input.language } }))
      }
    }

    if (node.type === "class_declaration" || node.type === "class") {
      const symbol = childText(node, "name") ?? "<anonymous-class>"
      push(makeDeclaredNode({ repoId: input.repoId, filePath: input.filePath, kind: "class", symbol, node, metadata: { language: input.language } }))
    }

    if (node.type === "method_definition") {
      const symbol = childText(node, "name") ?? getMemberPropertyName(node.childForFieldName("name")) ?? "<anonymous-method>"
      push(makeDeclaredNode({ repoId: input.repoId, filePath: input.filePath, kind: "method", symbol, node, metadata: { language: input.language } }))
    }

    if (node.type === "interface_declaration") {
      const symbol = childText(node, "name") ?? "<anonymous-interface>"
      push(makeDeclaredNode({ repoId: input.repoId, filePath: input.filePath, kind: "interface", symbol, node, metadata: { language: input.language } }))
    }

    if (node.type === "type_alias_declaration") {
      const symbol = childText(node, "name") ?? "<anonymous-type>"
      push(makeDeclaredNode({ repoId: input.repoId, filePath: input.filePath, kind: "type", symbol, node, metadata: { language: input.language } }))
    }

    if (node.type === "variable_declarator") {
      const symbol = childText(node, "name")
      const value = node.childForFieldName("value")
      if (!symbol || !value) {
        return
      }
      const isFunctionValue = ["arrow_function", "function_expression"].includes(value.type)
      if (maybeComponentName(symbol) && containsNodeType(value, jsxTypes)) {
        push(makeDeclaredNode({ repoId: input.repoId, filePath: input.filePath, kind: "component", symbol, node, metadata: { language: input.language } }))
      } else if (maybeHookName(symbol) && isFunctionValue) {
        push(makeDeclaredNode({ repoId: input.repoId, filePath: input.filePath, kind: "hook", symbol, node, metadata: { language: input.language } }))
      } else if (isFunctionValue) {
        push(makeDeclaredNode({ repoId: input.repoId, filePath: input.filePath, kind: "function", symbol, node, metadata: { language: input.language } }))
      }
    }

    if (node.type === "call_expression") {
      const callName = getCallName(node)
      if (callName && TEST_CALLS.has(callName) && isTestFile(input.filePath)) {
        const args = node.childForFieldName("arguments")
        const firstArg = args ? firstNamedChildOfType(args, "string") : null
        push(
          makeDeclaredNode({
            repoId: input.repoId,
            filePath: input.filePath,
            kind: "test",
            symbol: normalizeTextSymbol(firstArg?.text ?? null) ?? callName,
            node,
            metadata: { language: input.language }
          })
        )
      }

      const fn = node.childForFieldName("function")
      const method = getMemberPropertyName(fn)
      if (method && ROUTE_METHODS.has(method)) {
        const args = node.childForFieldName("arguments")
        const firstArg = args ? firstNamedChildOfType(args, "string") : null
        if (firstArg) {
          push(
            makeDeclaredNode({
              repoId: input.repoId,
              filePath: input.filePath,
              kind: "route",
              symbol: `${method.toUpperCase()} ${normalizeTextSymbol(firstArg.text) ?? firstArg.text}`,
              node,
              metadata: { language: input.language }
            })
          )
        }
      }
    }
  })

  return nodes
}

function nearestClassName(node: SyntaxNode) {
  let current = node.parent ?? null
  while (current) {
    if (current.type === "class_definition") {
      return childText(current, "name")
    }
    current = current.parent ?? null
  }
  return null
}

function extractPythonNodes(input: { repoId: string; filePath: string; fileNodeId: string; root: SyntaxNode }) {
  const nodes: IndexedCodeNode[] = []

  walk(input.root, (node) => {
    if (node.type === "class_definition") {
      const symbol = childText(node, "name") ?? "<anonymous-class>"
      nodes.push(makeDeclaredNode({ repoId: input.repoId, filePath: input.filePath, kind: "class", symbol, node, metadata: { language: "python" } }))
    }

    if (node.type === "function_definition") {
      const name = childText(node, "name") ?? "<anonymous>"
      const className = nearestClassName(node)
      const symbol = className ? `${className}.${name}` : name
      const kind = className ? "method" : name.startsWith("test_") || isTestFile(input.filePath) ? "test" : "function"
      nodes.push(makeDeclaredNode({ repoId: input.repoId, filePath: input.filePath, kind, symbol, node, metadata: { language: "python" } }))
    }
  })

  return nodes
}

function attachDeclaresEdges(repoId: string, fileNodeId: string, nodes: IndexedCodeNode[]) {
  return nodes.map(
    (node): IndexedCodeEdge => ({
      id: edgeId(repoId, fileNodeId, node.id, "declares"),
      repoId,
      fromCodeNodeId: fileNodeId,
      toCodeNodeId: node.id,
      edgeType: "declares"
    })
  )
}

async function extractFile(repoId: string, repoRoot: string, filePath: string): Promise<IndexExtraction> {
  const language = languageForPath(filePath)
  if (!language) {
    return { nodes: [], edges: [], indexedPaths: [] }
  }

  const absolutePath = path.join(repoRoot, filePath)
  const source = await readFile(absolutePath, "utf8")
  const parser = new Parser()
  parser.setLanguage(grammarForLanguage(language))
  const tree = parser.parse(source)
  const endLine = source.split("\n").length
  const fileNode = createFileNode(repoId, filePath, source, endLine)
  const declaredNodes =
    language === "python"
      ? extractPythonNodes({ repoId, filePath, fileNodeId: fileNode.id, root: tree.rootNode })
      : extractJsLikeNodes({ repoId, filePath, fileNodeId: fileNode.id, root: tree.rootNode, language })

  return {
    nodes: [fileNode, ...declaredNodes],
    edges: attachDeclaresEdges(repoId, fileNode.id, declaredNodes),
    indexedPaths: [filePath]
  }
}

function shouldIgnoreDirectory(name: string) {
  return [".git", ".xiezhi", "node_modules", "dist", "build", "coverage", "docs"].includes(name)
}

export function isSupportedSourcePath(filePath: string) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath))
}

export async function discoverSourcePaths(repoRoot: string) {
  const results: string[] = []

  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!shouldIgnoreDirectory(entry.name)) {
          await visit(path.join(directory, entry.name))
        }
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      const relativePath = path.relative(repoRoot, path.join(directory, entry.name)).replace(/\\/g, "/")
      if (isSupportedSourcePath(relativePath)) {
        results.push(relativePath)
      }
    }
  }

  await visit(repoRoot)
  return results.sort()
}

export async function extractCodeGraph(input: { repoId: string; repoRoot: string; paths: string[] }): Promise<IndexExtraction> {
  const extractions = await Promise.all(input.paths.filter(isSupportedSourcePath).map((filePath) => extractFile(input.repoId, input.repoRoot, filePath)))
  return {
    nodes: extractions.flatMap((extraction) => extraction.nodes),
    edges: extractions.flatMap((extraction) => extraction.edges),
    indexedPaths: extractions.flatMap((extraction) => extraction.indexedPaths).sort()
  }
}
