import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { execa } from "execa"

export async function createTempDir(prefix: string) {
  return await mkdtemp(path.join(tmpdir(), prefix))
}

export async function createTempGitRepo(prefix: string) {
  const cwd = await createTempDir(prefix)

  await execa("git", ["init", "-b", "main"], { cwd })
  await execa("git", ["config", "user.name", "XieZhi Test"], { cwd })
  await execa("git", ["config", "user.email", "test@xiezhi.dev"], { cwd })
  await writeFile(path.join(cwd, "README.md"), "# Fixture\n", "utf8")
  await execa("git", ["add", "README.md"], { cwd })
  await execa("git", ["commit", "-m", "initial commit"], { cwd })

  return cwd
}

export async function createTempTsRepo(prefix: string) {
  const cwd = await createTempGitRepo(prefix)

  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "fixture-app",
        private: true,
        type: "module",
        scripts: {
          test: "vitest run",
          typecheck: "tsc --noEmit",
          lint: "eslint ."
        }
      },
      null,
      2
    ),
    "utf8"
  )

  await writeFile(
    path.join(cwd, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          jsx: "react-jsx",
          strict: true
        },
        include: ["src", "tests"]
      },
      null,
      2
    ),
    "utf8"
  )

  await mkdir(path.join(cwd, "src"), { recursive: true })
  await mkdir(path.join(cwd, "tests"), { recursive: true })

  await writeFile(
    path.join(cwd, "src", "helpers.ts"),
    [
      "export type HelperConfig = {",
      "  enabled: boolean",
      "}",
      "",
      "export const helper = () => true"
    ].join("\n"),
    "utf8"
  )

  await writeFile(
    path.join(cwd, "src", "router.tsx"),
    [
      "import { helper } from './helpers'",
      "import type { HelperConfig } from './helpers'",
      "",
      "export interface User {",
      "  id: string",
      "}",
      "",
      "export type UserRole = 'admin' | 'member'",
      "",
      "export function getUser(id: string) {",
      "  return { id }",
      "}",
      "",
      "export const App = () => <div>Hello</div>",
      "",
      "const config: HelperConfig = { enabled: helper() }",
      "void config",
      "",
      "router.get('/users', getUser)"
    ].join("\n"),
    "utf8"
  )

  await writeFile(
    path.join(cwd, "tests", "router.test.ts"),
    [
      "import { describe, it, expect } from 'vitest'",
      "import { getUser } from '../src/router'",
      "",
      "describe('router', () => {",
      "  it('returns a user', () => {",
      "    expect(getUser('1').id).toBe('1')",
      "  })",
      "})"
    ].join("\n"),
    "utf8"
  )

  await execa("git", ["add", "."], { cwd })
  await execa("git", ["commit", "-m", "add typescript fixture"], { cwd })

  return cwd
}

export async function createTempNoteTakingRepo(prefix: string) {
  const cwd = await createTempGitRepo(prefix)

  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "note-fixture",
        private: true,
        type: "module",
        scripts: {
          test: "vitest run",
          typecheck: "tsc --noEmit"
        }
      },
      null,
      2
    ),
    "utf8"
  )

  await writeFile(
    path.join(cwd, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          jsx: "react-jsx",
          strict: true
        },
        include: ["src", "tests"]
      },
      null,
      2
    ),
    "utf8"
  )

  await mkdir(path.join(cwd, "src"), { recursive: true })
  await mkdir(path.join(cwd, "tests"), { recursive: true })

  await writeFile(
    path.join(cwd, "src", "notes.ts"),
    [
      "export type Note = {",
      "  id: string",
      "  title: string",
      "  body: string",
      "  tags: string[]",
      "}",
      "",
      "export function listNotes(notes: Note[]) {",
      "  return notes",
      "}",
      "",
      "export function searchNotes(notes: Note[], query: string) {",
      "  const normalized = query.toLowerCase()",
      "  return notes.filter((note) => `${note.title} ${note.body}`.toLowerCase().includes(normalized))",
      "}",
      "",
      "export function notesByTag(notes: Note[], tag: string) {",
      "  return notes.filter((note) => note.tags.includes(tag))",
      "}"
    ].join("\n"),
    "utf8"
  )

  await writeFile(
    path.join(cwd, "src", "app.tsx"),
    [
      "import { listNotes, type Note } from './notes'",
      "",
      "const seedNotes: Note[] = [",
      "  { id: '1', title: 'First note', body: 'Remember this', tags: ['personal'] }",
      "]",
      "",
      "export const App = () => <main>{listNotes(seedNotes).length}</main>"
    ].join("\n"),
    "utf8"
  )

  await writeFile(
    path.join(cwd, "tests", "notes.test.ts"),
    [
      "import { describe, expect, it } from 'vitest'",
      "import { searchNotes, notesByTag, type Note } from '../src/notes'",
      "",
      "const notes: Note[] = [",
      "  { id: '1', title: 'Recipe', body: 'Apple pie', tags: ['food'] },",
      "  { id: '2', title: 'Trip', body: 'Dublin notes', tags: ['travel'] }",
      "]",
      "",
      "describe('notes', () => {",
      "  it('searches notes', () => {",
      "    expect(searchNotes(notes, 'apple')).toHaveLength(1)",
      "  })",
      "",
      "  it('filters by tag', () => {",
      "    expect(notesByTag(notes, 'travel')).toHaveLength(1)",
      "  })",
      "})"
    ].join("\n"),
    "utf8"
  )

  await execa("git", ["add", "."], { cwd })
  await execa("git", ["commit", "-m", "add note taking fixture"], { cwd })

  return cwd
}

export async function createTempPythonRepo(prefix: string) {
  const cwd = await createTempGitRepo(prefix)

  await mkdir(path.join(cwd, "src"), { recursive: true })
  await mkdir(path.join(cwd, "tests"), { recursive: true })
  await writeFile(
    path.join(cwd, "src", "math_utils.py"),
    [
      "class Calculator:",
      "    def multiply(self, left, right):",
      "        return left * right",
      "",
      "def add(left, right):",
      "    return left + right",
      "",
      "def subtract(left, right):",
      "    return left - right"
    ].join("\n"),
    "utf8"
  )
  await writeFile(
    path.join(cwd, "tests", "test_math_utils.py"),
    [
      "from src.math_utils import add",
      "",
      "def test_add():",
      "    assert add(1, 2) == 3"
    ].join("\n"),
    "utf8"
  )
  await execa("git", ["add", "."], { cwd })
  await execa("git", ["commit", "-m", "add python fixture"], { cwd })
  return cwd
}

export async function createTempJsRepo(prefix: string) {
  const cwd = await createTempGitRepo(prefix)

  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "js-fixture", type: "module" }, null, 2), "utf8")
  await mkdir(path.join(cwd, "src"), { recursive: true })
  await mkdir(path.join(cwd, "tests"), { recursive: true })
  await writeFile(
    path.join(cwd, "src", "app.jsx"),
    [
      "export function getUser(id) {",
      "  return { id }",
      "}",
      "",
      "export class Store {",
      "  save(value) {",
      "    return value",
      "  }",
      "}",
      "",
      "export const App = () => <main>Hello</main>",
      "router.get('/users', getUser)"
    ].join("\n"),
    "utf8"
  )
  await writeFile(
    path.join(cwd, "tests", "app.test.js"),
    ["test('loads', () => {", "  getUser('1')", "})"].join("\n"),
    "utf8"
  )
  await execa("git", ["add", "."], { cwd })
  await execa("git", ["commit", "-m", "add javascript fixture"], { cwd })
  return cwd
}
