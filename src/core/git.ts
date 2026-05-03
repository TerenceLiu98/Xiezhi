import { execa } from "execa"

import { XieZhiError } from "./errors.js"

export async function runGit(args: string[], cwd: string) {
  try {
    return await execa("git", args, { cwd })
  } catch (error) {
    throw new XieZhiError("GIT_ERROR", `Git command failed: git ${args.join(" ")}`, {
      cause: error,
      hint: "Make sure this directory is a valid git repository and git is installed."
    })
  }
}
