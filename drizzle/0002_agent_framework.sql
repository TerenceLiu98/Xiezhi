ALTER TABLE patches ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'scaffold';
ALTER TABLE patches ADD COLUMN runtime_evidence_json TEXT;
ALTER TABLE patches ADD COLUMN agent_run_id TEXT;

UPDATE tasks
SET status = 'patched'
WHERE status = 'running'
  AND id IN (SELECT task_id FROM patches WHERE status IN ('pending', 'verified', 'accepted'));

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  feature_id TEXT,
  planning_runtime_name TEXT NOT NULL,
  raw_agent_output TEXT,
  plan_summary_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  agent_session_id TEXT,
  task_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  contract_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_session_id TEXT,
  assignment_id TEXT,
  task_id TEXT NOT NULL,
  runtime_name TEXT NOT NULL,
  runtime_mode TEXT,
  patch_id TEXT,
  status TEXT NOT NULL,
  event_summary_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
