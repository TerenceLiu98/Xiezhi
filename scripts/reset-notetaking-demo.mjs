#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { rm, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const demoRoot = path.join(root, "demo", "notetaking")

function git(args) {
  execFileSync("git", args, {
    cwd: demoRoot,
    stdio: "inherit"
  })
}

await rm(demoRoot, { recursive: true, force: true })
await mkdir(demoRoot, { recursive: true })

await writeFile(
  path.join(demoRoot, "README.md"),
  [
    "# XieZhi Note-taking Demo",
    "",
    "This local repository is intentionally empty of app source after reset.",
    "Build the Electron note-taking app through XieZhi + OpenCode:",
    "",
    "```sh",
    "node ../../dist/cli.js init",
    "node ../../dist/cli.js agent plan \"build a usable Electron note-taking app\" --runtime opencode",
    "node ../../dist/cli.js agent run <task-id> --runtime opencode",
    "```",
    ""
  ].join("\n")
)

await writeFile(
  path.join(demoRoot, ".gitignore"),
  ["node_modules/", "dist/", "coverage/", ".xiezhi/", "*.log", ""].join("\n")
)

git(["init", "-b", "main"])
git(["config", "user.name", "XieZhi Demo"])
git(["config", "user.email", "xiezhi-demo@example.local"])
git(["add", "README.md", ".gitignore"])
git(["commit", "-m", "Initialize note-taking demo repo"])

console.log(`Reset local note-taking demo at ${demoRoot}`)
