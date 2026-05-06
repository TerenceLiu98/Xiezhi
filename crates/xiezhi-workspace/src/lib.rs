use std::fs;
use std::path::{Path, PathBuf};

use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use xiezhi_core::{WorkRun, Workspace, WorkspaceKind, WorkspaceStatus};
use xiezhi_workflow::WorkspaceConfig;

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("home directory is unavailable, so workspace path {0} cannot be expanded")]
    MissingHome(String),
    #[error("workspace path is empty")]
    EmptyPath,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub struct WorkspaceManager {
    root: PathBuf,
}

impl WorkspaceManager {
    pub fn from_config(config: &WorkspaceConfig) -> Result<Self, WorkspaceError> {
        Ok(Self {
            root: expand_path(&config.root)?,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn create_run_workspace(&self, run: &WorkRun) -> Result<Workspace, WorkspaceError> {
        let path = self.root.join(format!("run-{}", run.id));
        fs::create_dir_all(&path)?;

        let now = OffsetDateTime::now_utc();
        let workspace = Workspace {
            id: Uuid::now_v7(),
            work_run_id: run.id,
            kind: WorkspaceKind::Run,
            path: path.to_string_lossy().to_string(),
            base_ref: None,
            status: WorkspaceStatus::Ready,
            created_at: now,
            updated_at: now,
        };

        let manifest = serde_json::json!({
            "version": "v1",
            "workspaceId": workspace.id,
            "workRunId": workspace.work_run_id,
            "kind": workspace.kind,
            "status": workspace.status,
            "createdAt": workspace.created_at,
        });
        fs::write(
            path.join("xiezhi-workspace.json"),
            serde_json::to_string_pretty(&manifest)?,
        )?;

        Ok(workspace)
    }

    pub fn create_agent_workspace(
        &self,
        run: &WorkRun,
        task_node_id: Uuid,
    ) -> Result<Workspace, WorkspaceError> {
        let path = self.root.join(format!("agent-{}-{}", run.id, task_node_id));
        fs::create_dir_all(&path)?;

        let now = OffsetDateTime::now_utc();
        let workspace = Workspace {
            id: Uuid::now_v7(),
            work_run_id: run.id,
            kind: WorkspaceKind::Agent,
            path: path.to_string_lossy().to_string(),
            base_ref: None,
            status: WorkspaceStatus::Ready,
            created_at: now,
            updated_at: now,
        };

        let manifest = serde_json::json!({
            "version": "v1",
            "workspaceId": workspace.id,
            "workRunId": workspace.work_run_id,
            "executionGraphNodeId": task_node_id,
            "kind": workspace.kind,
            "status": workspace.status,
            "createdAt": workspace.created_at,
        });
        fs::write(
            path.join("xiezhi-workspace.json"),
            serde_json::to_string_pretty(&manifest)?,
        )?;

        Ok(workspace)
    }
}

pub fn expand_path(raw: &str) -> Result<PathBuf, WorkspaceError> {
    if raw.trim().is_empty() {
        return Err(WorkspaceError::EmptyPath);
    }
    if raw == "~" {
        return dirs::home_dir().ok_or_else(|| WorkspaceError::MissingHome(raw.to_string()));
    }
    if let Some(stripped) = raw.strip_prefix("~/") {
        let home = dirs::home_dir().ok_or_else(|| WorkspaceError::MissingHome(raw.to_string()))?;
        return Ok(home.join(stripped));
    }
    Ok(PathBuf::from(raw))
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiezhi_core::{WorkItem, WorkRun};

    #[test]
    fn creates_run_workspace_with_manifest() {
        let root = std::env::temp_dir().join(format!("xiezhi-workspace-test-{}", Uuid::now_v7()));
        let manager = WorkspaceManager { root: root.clone() };
        let item = WorkItem::local_goal("build a pomodoro app");
        let run = WorkRun::new(item.id, item.title);

        let workspace = manager.create_run_workspace(&run).unwrap();

        assert_eq!(workspace.work_run_id, run.id);
        assert!(
            Path::new(&workspace.path)
                .join("xiezhi-workspace.json")
                .exists()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creates_agent_workspace_with_task_manifest() {
        let root = std::env::temp_dir().join(format!("xiezhi-workspace-test-{}", Uuid::now_v7()));
        let manager = WorkspaceManager { root: root.clone() };
        let item = WorkItem::local_goal("build a pomodoro app");
        let run = WorkRun::new(item.id, item.title);
        let task_node_id = Uuid::now_v7();

        let workspace = manager.create_agent_workspace(&run, task_node_id).unwrap();
        let manifest_path = Path::new(&workspace.path).join("xiezhi-workspace.json");
        let manifest = fs::read_to_string(manifest_path).unwrap();

        assert_eq!(workspace.work_run_id, run.id);
        assert_eq!(workspace.kind, WorkspaceKind::Agent);
        assert!(workspace.path.contains(&format!("agent-{}-", run.id)));
        assert!(manifest.contains(&task_node_id.to_string()));
        fs::remove_dir_all(root).unwrap();
    }
}
