import { createHash } from "node:crypto"
import path from "node:path"

import {
  Node,
  Project,
  SyntaxKind,
  type CallExpression,
  type Expression,
  type Node as MorphNode,
  type SourceFile
} from "ts-morph"

import { stableId } from "../core/ids.js"
import type { IndexExtraction, IndexedCodeEdge, IndexedCodeNode } from "./types.js"

function dedupeById<T extends { id: string }>(items: T[]) {
  const map = new Map<string, T>()

  for (const item of items) {
    if (!map.has(item.id)) {
      map.set(item.id, item)
    }
  }

  return [...map.values()]
}

function relativePath(repoRoot: string, sourceFile: SourceFile) {
  return path.relative(repoRoot, sourceFile.getFilePath()) || sourceFile.getBaseName()
}

function lineRange(sourceFile: SourceFile, node: MorphNode) {
  return {
    startLine: sourceFile.getLineAndColumnAtPos(node.getStart()).line,
    endLine: sourceFile.getLineAndColumnAtPos(node.getEnd()).line
  }
}

function createNodeHash(parts: Array<string | number | undefined>) {
  const source = parts.filter(Boolean).join("|")
  return createHash("sha1").update(source).digest("hex")
}

function nodeId(repoId: string, kind: string, filePath: string, symbol?: string, startLine?: number, endLine?: number) {
  return stableId(kind, `${repoId}:${filePath}:${symbol ?? ""}:${startLine ?? 0}:${endLine ?? 0}`)
}

function edgeId(repoId: string, fromNodeId: string, toNodeId: string, edgeType: string) {
  return stableId("edge", `${repoId}:${edgeType}:${fromNodeId}:${toNodeId}`)
}

function isTestFile(filePath: string) {
  return /\.test\.(t|j)sx?$/.test(filePath) || /\.spec\.(t|j)sx?$/.test(filePath)
}

function isRouteMethod(expression: Expression) {
  return (
    Node.isPropertyAccessExpression(expression) &&
    ["get", "post", "put", "patch", "delete"].includes(expression.getName())
  )
}

function extractRouteSymbol(callExpression: CallExpression) {
  const expression = callExpression.getExpression()
  if (!Node.isPropertyAccessExpression(expression)) {
    return null
  }
  if (!["get", "post", "put", "patch", "delete"].includes(expression.getName())) {
    return null
  }

  const firstArg = callExpression.getArguments()[0]
  if (!firstArg || !Node.isStringLiteral(firstArg)) {
    return null
  }

  return `${expression.getNameNode().getText().toUpperCase()} ${firstArg.getLiteralText()}`
}

function isJsxReturningNode(node: MorphNode) {
  return node.getDescendants().some((descendant) =>
    [SyntaxKind.JsxElement, SyntaxKind.JsxSelfClosingElement, SyntaxKind.JsxFragment].includes(
      descendant.getKind()
    )
  )
}

function maybeComponentName(name: string | undefined) {
  return Boolean(name && /^[A-Z]/.test(name))
}

function maybeHookName(name: string | undefined) {
  return Boolean(name && /^use[A-Z0-9_]/.test(name))
}

export function extractCodeGraph(input: {
  repoId: string
  repoRoot: string
  project: Project
  sourceFiles: SourceFile[]
  existingFileNodeIds?: Map<string, string>
}): IndexExtraction {
  const nodes: IndexedCodeNode[] = []
  const edges: IndexedCodeEdge[] = []
  const indexedPaths: string[] = []
  const fileNodeIds = new Map<string, string>(input.existingFileNodeIds ?? [])
  const exportableNodeIds = new Map<string, string>()

  for (const sourceFile of input.sourceFiles) {
    const filePath = relativePath(input.repoRoot, sourceFile)
    indexedPaths.push(filePath)

    const fileNode: IndexedCodeNode = {
      id: nodeId(input.repoId, "file", filePath, filePath, 1, sourceFile.getEndLineNumber()),
      repoId: input.repoId,
      kind: "file",
      path: filePath,
      symbol: filePath,
      startLine: 1,
      endLine: sourceFile.getEndLineNumber(),
      hash: createNodeHash([input.repoId, "file", filePath, sourceFile.getFullText()])
    }

    nodes.push(fileNode)
    fileNodeIds.set(filePath, fileNode.id)

    const exportedDeclarations = sourceFile.getExportedDeclarations()

    const pushNode = (node: IndexedCodeNode) => {
      nodes.push(node)
      if (node.symbol) {
        exportableNodeIds.set(`${filePath}:${node.symbol}`, node.id)
      }
      edges.push({
        id: edgeId(input.repoId, fileNode.id, node.id, "declares"),
        repoId: input.repoId,
        fromCodeNodeId: fileNode.id,
        toCodeNodeId: node.id,
        edgeType: "declares"
      })
    }

    for (const fn of sourceFile.getFunctions()) {
      const symbol = fn.getName() ?? "<anonymous>"
      const range = lineRange(sourceFile, fn)
      pushNode({
        id: nodeId(input.repoId, "function", filePath, symbol, range.startLine, range.endLine),
        repoId: input.repoId,
        kind: maybeHookName(symbol) ? "hook" : "function",
        path: filePath,
        symbol,
        startLine: range.startLine,
        endLine: range.endLine,
        hash: createNodeHash([input.repoId, "function", filePath, symbol, fn.getText()])
      })

      if (maybeComponentName(symbol) && isJsxReturningNode(fn)) {
        pushNode({
          id: nodeId(input.repoId, "component", filePath, symbol, range.startLine, range.endLine),
          repoId: input.repoId,
          kind: "component",
          path: filePath,
          symbol,
          startLine: range.startLine,
          endLine: range.endLine,
          hash: createNodeHash([input.repoId, "component", filePath, symbol, fn.getText()])
        })
      }
    }

    for (const classDeclaration of sourceFile.getClasses()) {
      const symbol = classDeclaration.getName() ?? "<anonymous-class>"
      const range = lineRange(sourceFile, classDeclaration)
      pushNode({
        id: nodeId(input.repoId, "class", filePath, symbol, range.startLine, range.endLine),
        repoId: input.repoId,
        kind: "class",
        path: filePath,
        symbol,
        startLine: range.startLine,
        endLine: range.endLine,
        hash: createNodeHash([input.repoId, "class", filePath, symbol, classDeclaration.getText()])
      })
    }

    for (const iface of sourceFile.getInterfaces()) {
      const symbol = iface.getName()
      const range = lineRange(sourceFile, iface)
      pushNode({
        id: nodeId(input.repoId, "interface", filePath, symbol, range.startLine, range.endLine),
        repoId: input.repoId,
        kind: "interface",
        path: filePath,
        symbol,
        startLine: range.startLine,
        endLine: range.endLine,
        hash: createNodeHash([input.repoId, "interface", filePath, symbol, iface.getText()])
      })
    }

    for (const typeAlias of sourceFile.getTypeAliases()) {
      const symbol = typeAlias.getName()
      const range = lineRange(sourceFile, typeAlias)
      pushNode({
        id: nodeId(input.repoId, "type", filePath, symbol, range.startLine, range.endLine),
        repoId: input.repoId,
        kind: "type",
        path: filePath,
        symbol,
        startLine: range.startLine,
        endLine: range.endLine,
        hash: createNodeHash([input.repoId, "type", filePath, symbol, typeAlias.getText()])
      })
    }

    for (const variableStatement of sourceFile.getVariableStatements()) {
      for (const declaration of variableStatement.getDeclarations()) {
        const symbol = declaration.getName()
        const initializer = declaration.getInitializer()
        if (!initializer) {
          continue
        }
        const range = lineRange(sourceFile, declaration)

        if (
          maybeComponentName(symbol) &&
          (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) &&
          isJsxReturningNode(initializer)
        ) {
          pushNode({
            id: nodeId(input.repoId, "component", filePath, symbol, range.startLine, range.endLine),
            repoId: input.repoId,
            kind: "component",
            path: filePath,
            symbol,
            startLine: range.startLine,
            endLine: range.endLine,
            hash: createNodeHash([input.repoId, "component", filePath, symbol, initializer.getText()])
          })
        }

        if (
          maybeHookName(symbol) &&
          (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
        ) {
          pushNode({
            id: nodeId(input.repoId, "hook", filePath, symbol, range.startLine, range.endLine),
            repoId: input.repoId,
            kind: "hook",
            path: filePath,
            symbol,
            startLine: range.startLine,
            endLine: range.endLine,
            hash: createNodeHash([input.repoId, "hook", filePath, symbol, initializer.getText()])
          })
        }
      }
    }

    if (isTestFile(filePath)) {
      for (const callExpression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expression = callExpression.getExpression()
        if (!Node.isIdentifier(expression)) {
          continue
        }
        if (!["it", "test", "describe"].includes(expression.getText())) {
          continue
        }
        const firstArg = callExpression.getArguments()[0]
        if (!firstArg || !Node.isStringLiteral(firstArg)) {
          continue
        }
        const symbol = `${expression.getText()}: ${firstArg.getLiteralText()}`
        const range = lineRange(sourceFile, callExpression)
        pushNode({
          id: nodeId(input.repoId, "test", filePath, symbol, range.startLine, range.endLine),
          repoId: input.repoId,
          kind: "test",
          path: filePath,
          symbol,
          startLine: range.startLine,
          endLine: range.endLine,
          hash: createNodeHash([input.repoId, "test", filePath, symbol, callExpression.getText()])
        })
      }
    }

    for (const callExpression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const routeSymbol = extractRouteSymbol(callExpression)
      if (!routeSymbol) {
        continue
      }
      const range = lineRange(sourceFile, callExpression)
      pushNode({
        id: nodeId(input.repoId, "route", filePath, routeSymbol, range.startLine, range.endLine),
        repoId: input.repoId,
        kind: "route",
        path: filePath,
        symbol: routeSymbol,
        startLine: range.startLine,
        endLine: range.endLine,
        hash: createNodeHash([input.repoId, "route", filePath, routeSymbol, callExpression.getText()]),
        metadataJson: JSON.stringify({
          source: "route_heuristic"
        })
      })
    }

    for (const importDeclaration of sourceFile.getImportDeclarations()) {
      const target = importDeclaration.getModuleSpecifierSourceFile()
      if (!target) {
        continue
      }
      const targetPath = relativePath(input.repoRoot, target)
      const targetId =
        fileNodeIds.get(targetPath) ??
        nodeId(input.repoId, "file", targetPath, targetPath, 1, target.getEndLineNumber())

      edges.push({
        id: edgeId(input.repoId, fileNode.id, targetId, "imports"),
        repoId: input.repoId,
        fromCodeNodeId: fileNode.id,
        toCodeNodeId: targetId,
        edgeType: "imports"
      })
    }

    for (const [exportName, declarations] of exportedDeclarations.entries()) {
      for (const declaration of declarations) {
        const resolvedPath = relativePath(input.repoRoot, declaration.getSourceFile())
        const targetId =
          exportableNodeIds.get(`${resolvedPath}:${exportName}`) ??
          nodeId(input.repoId, "export", resolvedPath, exportName, 0, 0)

        edges.push({
          id: edgeId(input.repoId, fileNode.id, targetId, "exports"),
          repoId: input.repoId,
          fromCodeNodeId: fileNode.id,
          toCodeNodeId: targetId,
          edgeType: "exports"
        })
      }
    }
  }

  return {
    nodes: dedupeById(nodes),
    edges: dedupeById(edges),
    indexedPaths: [...new Set(indexedPaths)]
  }
}
