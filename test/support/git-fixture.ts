import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { execa } from "execa"

export async function createTempGitRepo(prefix: string) {
  const cwd = await mkdtemp(path.join(tmpdir(), prefix))

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
