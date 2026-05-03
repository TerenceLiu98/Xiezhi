import { existsSync } from "node:fs"
import path from "node:path"

import { Project, type SourceFile } from "ts-morph"

const DEFAULT_GLOBS = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "app/**/*.ts",
  "app/**/*.tsx",
  "tests/**/*.ts",
  "tests/**/*.tsx",
  "*.ts",
  "*.tsx"
]

function shouldIgnoreFile(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/")
  return (
    normalized.includes("/node_modules/") ||
    normalized.includes("/dist/") ||
    normalized.includes("/docs/")
  )
}

export function loadProject(repoRoot: string) {
  const tsconfigPath = path.join(repoRoot, "tsconfig.json")
  const project = existsSync(tsconfigPath)
    ? new Project({
        tsConfigFilePath: tsconfigPath,
        skipAddingFilesFromTsConfig: false
      })
    : new Project({
        skipAddingFilesFromTsConfig: true
      })

  if (!existsSync(tsconfigPath)) {
    project.addSourceFilesAtPaths(DEFAULT_GLOBS.map((glob) => path.join(repoRoot, glob)))
  }

  const sourceFiles = project
    .getSourceFiles()
    .filter((sourceFile) => !sourceFile.isDeclarationFile())
    .filter((sourceFile) => {
      const relativePath = path.relative(repoRoot, sourceFile.getFilePath()).replace(/\\/g, "/")
      return !relativePath.startsWith(".xiezhi/") && !shouldIgnoreFile(relativePath)
    })

  return { project, sourceFiles }
}

export function getSourceFilesByRelativePath(
  repoRoot: string,
  sourceFiles: SourceFile[],
  relativePaths: string[]
) {
  const wanted = new Set(relativePaths.map((relativePath) => path.resolve(repoRoot, relativePath)))
  return sourceFiles.filter((sourceFile) => wanted.has(sourceFile.getFilePath()))
}
