import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const repositoriesTable = sqliteTable("repositories", {
  id: text("id").primaryKey(),
  rootPath: text("root_path").notNull().unique(),
  gitDir: text("git_dir").notNull(),
  currentBranch: text("current_branch"),
  headCommit: text("head_commit").notNull(),
  isDirty: integer("is_dirty", { mode: "boolean" }).notNull(),
  packageManager: text("package_manager").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
})

export const featuresTable = sqliteTable("features", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
})

export const dagNodesTable = sqliteTable("dag_nodes", {
  id: text("id").primaryKey(),
  featureId: text("feature_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  status: text("status").notNull(),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
})

export const dagEdgesTable = sqliteTable("dag_edges", {
  id: text("id").primaryKey(),
  featureId: text("feature_id").notNull(),
  fromNodeId: text("from_node_id").notNull(),
  toNodeId: text("to_node_id").notNull(),
  edgeType: text("edge_type").notNull()
})

export const codeNodesTable = sqliteTable("code_nodes", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull(),
  kind: text("kind").notNull(),
  path: text("path").notNull(),
  symbol: text("symbol"),
  startLine: integer("start_line"),
  endLine: integer("end_line"),
  hash: text("hash").notNull(),
  metadataJson: text("metadata_json")
})

export const codeEdgesTable = sqliteTable("code_edges", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull(),
  fromCodeNodeId: text("from_code_node_id").notNull(),
  toCodeNodeId: text("to_code_node_id").notNull(),
  edgeType: text("edge_type").notNull()
})

export const tasksTable = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  featureId: text("feature_id").notNull(),
  dagNodeId: text("dag_node_id").notNull(),
  status: text("status").notNull(),
  intentIrJson: text("intent_ir_json"),
  policyJson: text("policy_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
})

export const patchesTable = sqliteTable("patches", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  baseCommit: text("base_commit").notNull(),
  worktreePath: text("worktree_path").notNull(),
  runtimeName: text("runtime_name").notNull(),
  runtimeMode: text("runtime_mode").notNull().default("scaffold"),
  runtimeEvidenceJson: text("runtime_evidence_json"),
  promotionJson: text("promotion_json"),
  promotedAt: text("promoted_at"),
  agentRunId: text("agent_run_id"),
  changedFilesJson: text("changed_files_json").notNull(),
  diff: text("diff"),
  semanticDiffJson: text("semantic_diff_json"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
})

export const checksTable = sqliteTable("checks", {
  id: text("id").primaryKey(),
  patchId: text("patch_id").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  output: text("output"),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").notNull()
})

export const violationsTable = sqliteTable("violations", {
  id: text("id").primaryKey(),
  patchId: text("patch_id").notNull(),
  severity: text("severity").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").notNull()
})

export const commandLogsTable = sqliteTable("command_logs", {
  id: text("id").primaryKey(),
  patchId: text("patch_id").notNull(),
  command: text("command").notNull(),
  exitCode: integer("exit_code").notNull(),
  output: text("output").notNull(),
  createdAt: text("created_at").notNull()
})

export const agentSessionsTable = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  goal: text("goal").notNull(),
  featureId: text("feature_id"),
  planningRuntimeName: text("planning_runtime_name").notNull(),
  rawAgentOutput: text("raw_agent_output"),
  planSummaryJson: text("plan_summary_json"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
})

export const assignmentsTable = sqliteTable("assignments", {
  id: text("id").primaryKey(),
  agentSessionId: text("agent_session_id"),
  taskId: text("task_id").notNull(),
  goal: text("goal").notNull(),
  contractJson: text("contract_json").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
})

export const agentRunsTable = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  agentSessionId: text("agent_session_id"),
  assignmentId: text("assignment_id"),
  taskId: text("task_id").notNull(),
  runtimeName: text("runtime_name").notNull(),
  runtimeMode: text("runtime_mode"),
  patchId: text("patch_id"),
  status: text("status").notNull(),
  eventSummaryJson: text("event_summary_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
})

export const agentEventsTable = sqliteTable("agent_events", {
  id: text("id").primaryKey(),
  agentRunId: text("agent_run_id").notNull(),
  type: text("type").notNull(),
  summary: text("summary").notNull(),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").notNull()
})
