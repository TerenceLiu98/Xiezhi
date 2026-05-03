import { z } from "zod"

export const runtimeNameSchema = z.enum(["opencode", "claude", "codex"])

export const projectConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    language: z.literal("typescript")
  }),
  runtime: z.object({
    default: runtimeNameSchema
  }),
  commands: z.object({
    test: z.string().min(1),
    typecheck: z.string().min(1),
    lint: z.string().min(1)
  }),
  policy: z.object({
    defaultWriteMode: z.enum(["task_scope_only"]),
    denyCommands: z.array(z.string().min(1)).min(1)
  })
})

export type ProjectConfig = z.infer<typeof projectConfigSchema>
