CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dag_nodes (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dag_edges (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS code_nodes (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  symbol TEXT,
  start_line INTEGER,
  end_line INTEGER,
  hash TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS code_edges (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  from_code_node_id TEXT NOT NULL,
  to_code_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  dag_node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  intent_ir_json TEXT,
  policy_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patches (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  diff TEXT,
  semantic_diff_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY,
  patch_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS violations (
  id TEXT PRIMARY KEY,
  patch_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
