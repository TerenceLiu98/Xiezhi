import { z } from "zod"

export const runtimeNameSchema = z.enum(["opencode", "claude", "codex"])

export const projectConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    language: z.string().optional(),
    languages: z.array(z.enum(["typescript", "javascript", "python"])).optional()
  }).transform((project) => ({
    name: project.name,
    languages:
      project.languages && project.languages.length > 0
        ? project.languages
        : project.language === "javascript"
          ? ["javascript" as const]
          : project.language === "python"
            ? ["python" as const]
            : ["typescript" as const, "javascript" as const, "python" as const]
  })),
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
