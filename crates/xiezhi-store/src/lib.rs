use std::{fs, path::Path};

use rusqlite::{Connection, params};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use xiezhi_core::{
    Event, EventActor, WorkItem, WorkItemSource, WorkItemStatus, WorkRun, WorkRunStatus,
};

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("time parse error: {0}")]
    Time(#[from] time::error::Parse),
    #[error("uuid parse error: {0}")]
    Uuid(#[from] uuid::Error),
}

pub struct Store {
    connection: Connection,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        let store = Self { connection };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_memory() -> Result<Self, StoreError> {
        let connection = Connection::open_in_memory()?;
        let store = Self { connection };
        store.migrate()?;
        Ok(store)
    }

    pub fn migrate(&self) -> Result<(), StoreError> {
        self.connection.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS work_items (
              id TEXT PRIMARY KEY,
              source TEXT NOT NULL,
              title TEXT NOT NULL,
              description TEXT,
              external_ref TEXT,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS work_runs (
              id TEXT PRIMARY KEY,
              work_item_id TEXT NOT NULL,
              status TEXT NOT NULL,
              goal TEXT NOT NULL,
              workspace_id TEXT,
              active_supervisor_session_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              completed_at TEXT,
              FOREIGN KEY(work_item_id) REFERENCES work_items(id)
            );

            CREATE TABLE IF NOT EXISTS events (
              id TEXT PRIMARY KEY,
              work_run_id TEXT NOT NULL,
              actor TEXT NOT NULL,
              event_type TEXT NOT NULL,
              summary TEXT NOT NULL,
              payload_json TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(work_run_id) REFERENCES work_runs(id)
            );
            "#,
        )?;
        Ok(())
    }

    pub fn insert_work_item(&self, item: &WorkItem) -> Result<(), StoreError> {
        self.connection.execute(
            r#"
            INSERT INTO work_items
              (id, source, title, description, external_ref, status, created_at, updated_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                item.id.to_string(),
                encode_work_item_source(item.source),
                item.title,
                item.description,
                item.external_ref,
                encode_work_item_status(item.status),
                encode_time(item.created_at),
                encode_time(item.updated_at),
            ],
        )?;
        Ok(())
    }

    pub fn insert_work_run(&self, run: &WorkRun) -> Result<(), StoreError> {
        self.connection.execute(
            r#"
            INSERT INTO work_runs
              (id, work_item_id, status, goal, workspace_id, active_supervisor_session_id, created_at, updated_at, completed_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            params![
                run.id.to_string(),
                run.work_item_id.to_string(),
                encode_work_run_status(run.status),
                run.goal,
                run.workspace_id.map(|id| id.to_string()),
                run.active_supervisor_session_id.map(|id| id.to_string()),
                encode_time(run.created_at),
                encode_time(run.updated_at),
                run.completed_at.map(encode_time),
            ],
        )?;
        Ok(())
    }

    pub fn insert_event(&self, event: &Event) -> Result<(), StoreError> {
        self.connection.execute(
            r#"
            INSERT INTO events
              (id, work_run_id, actor, event_type, summary, payload_json, created_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                event.id.to_string(),
                event.work_run_id.to_string(),
                encode_event_actor(event.actor),
                event.event_type,
                event.summary,
                event.payload_json,
                encode_time(event.created_at),
            ],
        )?;
        Ok(())
    }

    pub fn get_work_item(&self, id: Uuid) -> Result<Option<WorkItem>, StoreError> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, source, title, description, external_ref, status, created_at, updated_at
            FROM work_items
            WHERE id = ?1
            "#,
        )?;
        let mut rows = statement.query(params![id.to_string()])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(WorkItem {
            id: parse_uuid(row.get::<_, String>(0)?)?,
            source: decode_work_item_source(&row.get::<_, String>(1)?),
            title: row.get(2)?,
            description: row.get(3)?,
            external_ref: row.get(4)?,
            status: decode_work_item_status(&row.get::<_, String>(5)?),
            created_at: decode_time(&row.get::<_, String>(6)?)?,
            updated_at: decode_time(&row.get::<_, String>(7)?)?,
        }))
    }

    pub fn get_work_run(&self, id: Uuid) -> Result<Option<WorkRun>, StoreError> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, work_item_id, status, goal, workspace_id, active_supervisor_session_id, created_at, updated_at, completed_at
            FROM work_runs
            WHERE id = ?1
            "#,
        )?;
        let mut rows = statement.query(params![id.to_string()])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        let workspace_id: Option<String> = row.get(4)?;
        let active_supervisor_session_id: Option<String> = row.get(5)?;
        let completed_at: Option<String> = row.get(8)?;
        Ok(Some(WorkRun {
            id: parse_uuid(row.get::<_, String>(0)?)?,
            work_item_id: parse_uuid(row.get::<_, String>(1)?)?,
            status: decode_work_run_status(&row.get::<_, String>(2)?),
            goal: row.get(3)?,
            workspace_id: workspace_id.map(parse_uuid).transpose()?,
            active_supervisor_session_id: active_supervisor_session_id
                .map(parse_uuid)
                .transpose()?,
            created_at: decode_time(&row.get::<_, String>(6)?)?,
            updated_at: decode_time(&row.get::<_, String>(7)?)?,
            completed_at: completed_at.as_deref().map(decode_time).transpose()?,
        }))
    }
}

fn encode_time(value: OffsetDateTime) -> String {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .expect("OffsetDateTime should format as RFC3339")
}

fn decode_time(value: &str) -> Result<OffsetDateTime, time::error::Parse> {
    OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
}

fn parse_uuid(value: String) -> Result<Uuid, uuid::Error> {
    Uuid::parse_str(&value)
}

fn encode_work_item_source(value: WorkItemSource) -> &'static str {
    match value {
        WorkItemSource::LocalGoal => "local_goal",
        WorkItemSource::Markdown => "markdown",
        WorkItemSource::GitHubIssue => "github_issue",
        WorkItemSource::LinearIssue => "linear_issue",
        WorkItemSource::JiraIssue => "jira_issue",
    }
}

fn decode_work_item_source(value: &str) -> WorkItemSource {
    match value {
        "markdown" => WorkItemSource::Markdown,
        "github_issue" => WorkItemSource::GitHubIssue,
        "linear_issue" => WorkItemSource::LinearIssue,
        "jira_issue" => WorkItemSource::JiraIssue,
        _ => WorkItemSource::LocalGoal,
    }
}

fn encode_work_item_status(value: WorkItemStatus) -> &'static str {
    match value {
        WorkItemStatus::Open => "open",
        WorkItemStatus::Active => "active",
        WorkItemStatus::Completed => "completed",
        WorkItemStatus::Cancelled => "cancelled",
        WorkItemStatus::Archived => "archived",
    }
}

fn decode_work_item_status(value: &str) -> WorkItemStatus {
    match value {
        "active" => WorkItemStatus::Active,
        "completed" => WorkItemStatus::Completed,
        "cancelled" => WorkItemStatus::Cancelled,
        "archived" => WorkItemStatus::Archived,
        _ => WorkItemStatus::Open,
    }
}

fn encode_work_run_status(value: WorkRunStatus) -> &'static str {
    match value {
        WorkRunStatus::Created => "created",
        WorkRunStatus::WorkspaceReady => "workspace_ready",
        WorkRunStatus::SupervisorIntake => "supervisor_intake",
        WorkRunStatus::WaitingForDecision => "waiting_for_decision",
        WorkRunStatus::Planning => "planning",
        WorkRunStatus::Executing => "executing",
        WorkRunStatus::Verifying => "verifying",
        WorkRunStatus::Recovering => "recovering",
        WorkRunStatus::HumanAcceptance => "human_acceptance",
        WorkRunStatus::Completed => "completed",
        WorkRunStatus::Cancelled => "cancelled",
        WorkRunStatus::Failed => "failed",
        WorkRunStatus::Archived => "archived",
    }
}

fn decode_work_run_status(value: &str) -> WorkRunStatus {
    match value {
        "workspace_ready" => WorkRunStatus::WorkspaceReady,
        "supervisor_intake" => WorkRunStatus::SupervisorIntake,
        "waiting_for_decision" => WorkRunStatus::WaitingForDecision,
        "planning" => WorkRunStatus::Planning,
        "executing" => WorkRunStatus::Executing,
        "verifying" => WorkRunStatus::Verifying,
        "recovering" => WorkRunStatus::Recovering,
        "human_acceptance" => WorkRunStatus::HumanAcceptance,
        "completed" => WorkRunStatus::Completed,
        "cancelled" => WorkRunStatus::Cancelled,
        "failed" => WorkRunStatus::Failed,
        "archived" => WorkRunStatus::Archived,
        _ => WorkRunStatus::Created,
    }
}

fn encode_event_actor(value: EventActor) -> &'static str {
    match value {
        EventActor::XieZhi => "xiezhi",
        EventActor::SupervisorAgent => "supervisor_agent",
        EventActor::Subagent => "subagent",
        EventActor::Runtime => "runtime",
        EventActor::User => "user",
        EventActor::Tracker => "tracker",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::OffsetDateTime;
    use xiezhi_core::{Event, WorkItem, WorkRun};

    #[test]
    fn persists_work_item_and_run() {
        let store = Store::open_memory().unwrap();
        let item = WorkItem::local_goal("build a pomodoro app");
        let run = WorkRun::new(item.id, item.title.clone());

        store.insert_work_item(&item).unwrap();
        store.insert_work_run(&run).unwrap();

        assert_eq!(
            store.get_work_item(item.id).unwrap().unwrap().title,
            "build a pomodoro app"
        );
        assert_eq!(
            store.get_work_run(run.id).unwrap().unwrap().status,
            WorkRunStatus::Created
        );
    }

    #[test]
    fn persists_events() {
        let store = Store::open_memory().unwrap();
        let item = WorkItem::local_goal("build a pomodoro app");
        let run = WorkRun::new(item.id, item.title.clone());
        store.insert_work_item(&item).unwrap();
        store.insert_work_run(&run).unwrap();

        store
            .insert_event(&Event {
                id: Uuid::now_v7(),
                work_run_id: run.id,
                actor: EventActor::XieZhi,
                event_type: "work_run_created".to_string(),
                summary: "Created work run.".to_string(),
                payload_json: None,
                created_at: OffsetDateTime::now_utc(),
            })
            .unwrap();
    }
}
