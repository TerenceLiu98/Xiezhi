CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL UNIQUE,
  git_dir TEXT NOT NULL,
  current_branch TEXT,
  head_commit TEXT NOT NULL,
  is_dirty INTEGER NOT NULL,
  package_manager TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE patches ADD COLUMN runtime_name TEXT NOT NULL DEFAULT 'opencode';
ALTER TABLE patches ADD COLUMN changed_files_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE patches ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

UPDATE patches
SET updated_at = created_at
WHERE updated_at = '';

CREATE TABLE IF NOT EXISTS command_logs (
  id TEXT PRIMARY KEY,
  patch_id TEXT NOT NULL,
  command TEXT NOT NULL,
  exit_code INTEGER NOT NULL,
  output TEXT NOT NULL,
  created_at TEXT NOT NULL
);
