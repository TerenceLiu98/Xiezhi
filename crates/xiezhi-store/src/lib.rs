use std::{fs, path::Path};

use rusqlite::{Connection, params};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use xiezhi_core::{
    AgentRole, AgentRun, AgentRunStatus, ChangeSet, ChangeSetStatus, DecisionPoint, Event,
    EventActor, ExecutionGraph, Proof, ProofStatus, ProofType, RuntimeKind, SupervisorSession,
    SupervisorSessionStatus, WorkItem, WorkItemSource, WorkItemStatus, WorkRun, WorkRunStatus,
    Workspace, WorkspaceKind, WorkspaceStatus,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkRunSummary {
    pub run: WorkRun,
    pub item: WorkItem,
    pub event_count: usize,
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

            CREATE TABLE IF NOT EXISTS workspaces (
              id TEXT PRIMARY KEY,
              work_run_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              path TEXT NOT NULL,
              base_ref TEXT,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(work_run_id) REFERENCES work_runs(id)
            );

            CREATE TABLE IF NOT EXISTS supervisor_sessions (
              id TEXT PRIMARY KEY,
              work_run_id TEXT NOT NULL,
              runtime TEXT NOT NULL,
              model TEXT,
              status TEXT NOT NULL,
              started_at TEXT NOT NULL,
              ended_at TEXT,
              last_event_id TEXT,
              FOREIGN KEY(work_run_id) REFERENCES work_runs(id)
            );

            CREATE TABLE IF NOT EXISTS decision_points (
              id TEXT PRIMARY KEY,
              work_run_id TEXT NOT NULL,
              status TEXT NOT NULL,
              problem TEXT NOT NULL,
              impact TEXT NOT NULL,
              recommended_option_id TEXT NOT NULL,
              options_json TEXT NOT NULL,
              selected_option_id TEXT,
              created_at TEXT NOT NULL,
              resolved_at TEXT,
              FOREIGN KEY(work_run_id) REFERENCES work_runs(id)
            );

            CREATE TABLE IF NOT EXISTS execution_graphs (
              id TEXT PRIMARY KEY,
              work_run_id TEXT NOT NULL,
              version TEXT NOT NULL,
              status TEXT NOT NULL,
              nodes_json TEXT NOT NULL,
              edges_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY(work_run_id) REFERENCES work_runs(id)
            );

            CREATE TABLE IF NOT EXISTS agent_runs (
              id TEXT PRIMARY KEY,
              work_run_id TEXT NOT NULL,
              execution_graph_node_id TEXT,
              workspace_id TEXT NOT NULL,
              runtime TEXT NOT NULL,
              model TEXT,
              role TEXT NOT NULL,
              status TEXT NOT NULL,
              started_at TEXT NOT NULL,
              ended_at TEXT,
              FOREIGN KEY(work_run_id) REFERENCES work_runs(id),
              FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
            );

            CREATE TABLE IF NOT EXISTS changesets (
              id TEXT PRIMARY KEY,
              work_run_id TEXT NOT NULL,
              agent_run_id TEXT NOT NULL,
              workspace_id TEXT NOT NULL,
              status TEXT NOT NULL,
              changed_files_json TEXT NOT NULL,
              diff_ref TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(work_run_id) REFERENCES work_runs(id),
              FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id),
              FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
            );

            CREATE TABLE IF NOT EXISTS proofs (
              id TEXT PRIMARY KEY,
              work_run_id TEXT NOT NULL,
              changeset_id TEXT,
              proof_type TEXT NOT NULL,
              status TEXT NOT NULL,
              summary TEXT NOT NULL,
              metadata_json TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(work_run_id) REFERENCES work_runs(id),
              FOREIGN KEY(changeset_id) REFERENCES changesets(id)
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

    pub fn update_work_run(&self, run: &WorkRun) -> Result<(), StoreError> {
        self.connection.execute(
            r#"
            UPDATE work_runs
            SET status = ?2,
                goal = ?3,
                workspace_id = ?4,
                active_supervisor_session_id = ?5,
                updated_at = ?6,
                completed_at = ?7
            WHERE id = ?1
            "#,
            params![
                run.id.to_string(),
                encode_work_run_status(run.status),
                run.goal,
                run.workspace_id.map(|id| id.to_string()),
                run.active_supervisor_session_id.map(|id| id.to_string()),
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

    pub fn insert_workspace(&self, workspace: &Workspace) -> Result<(), StoreError> {
        self.connection.execute(
            r#"
            INSERT INTO workspaces
              (id, work_run_id, kind, path, base_ref, status, created_at, updated_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                workspace.id.to_string(),
                workspace.work_run_id.to_string(),
                encode_workspace_kind(workspace.kind),
                workspace.path,
                workspace.base_ref,
                encode_workspace_status(workspace.status),
                encode_time(workspace.created_at),
                encode_time(workspace.updated_at),
            ],
        )?;
        Ok(())
    }

    pub fn insert_supervisor_session(&self, session: &SupervisorSession) -> Result<(), StoreError> {
        self.connection.execute(
            r#"
            INSERT INTO supervisor_sessions
              (id, work_run_id, runtime, model, status, started_at, ended_at, last_event_id)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                session.id.to_string(),
                session.work_run_id.to_string(),
                encode_runtime_kind(session.runtime),
                session.model,
                encode_supervisor_session_status(session.status),
                encode_time(session.started_at),
                session.ended_at.map(encode_time),
                session.last_event_id.map(|id| id.to_string()),
            ],
        )?;
        Ok(())
    }

    pub fn list_supervisor_sessions_for_work_run(
        &self,
        work_run_id: Uuid,
    ) -> Result<Vec<SupervisorSession>, StoreError> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, work_run_id, runtime, model, status, started_at, ended_at, last_event_id
            FROM supervisor_sessions
            WHERE work_run_id = ?1
            ORDER BY started_at ASC
            "#,
        )?;
        let rows = statement.query_map(params![work_run_id.to_string()], |row| {
            let ended_at: Option<String> = row.get(6)?;
            let last_event_id: Option<String> = row.get(7)?;
            Ok(SupervisorSession {
                id: parse_uuid(row.get::<_, String>(0)?).map_err(to_sql_error)?,
                work_run_id: parse_uuid(row.get::<_, String>(1)?).map_err(to_sql_error)?,
                runtime: decode_runtime_kind(&row.get::<_, String>(2)?),
                model: row.get(3)?,
                status: decode_supervisor_session_status(&row.get::<_, String>(4)?),
                started_at: decode_time(&row.get::<_, String>(5)?).map_err(to_sql_error)?,
                ended_at: ended_at
                    .as_deref()
                    .map(decode_time)
                    .transpose()
                    .map_err(to_sql_error)?,
                last_event_id: last_event_id
                    .map(parse_uuid)
                    .transpose()
                    .map_err(to_sql_error)?,
            })
        })?;
        rows.map(|row| Ok(row?)).collect()
    }

    pub fn insert_decision_point(&self, decision: &DecisionPoint) -> Result<(), StoreError> {
        self.connection.execute(
            r#"
            INSERT INTO decision_points
              (id, work_run_id, status, problem, impact, recommended_option_id, options_json, selected_option_id, created_at, resolved_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params![
                decision.id.to_string(),
                decision.work_run_id.to_string(),
                encode_decision_point_status(decision.status),
                decision.problem,
                decision.impact,
                decision.recommended_option_id,
                serde_json::to_string(&decision.options)?,
                decision.selected_option_id,
                encode_time(decision.created_at),
                decision.resolved_at.map(encode_time),
            ],
        )?;
        Ok(())
    }

    pub fn insert_execution_graph(&self, graph: &ExecutionGraph) -> Result<(), StoreError> {
        self.connection.execute(
            r#"
            INSERT INTO execution_graphs
              (id, work_run_id, version, status, nodes_json, edges_json, created_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                graph.id.to_string(),
                graph.work_run_id.to_string(),
                graph.version,
                graph.status,
                serde_json::to_string(&graph.nodes)?,
                serde_json::to_string(&graph.edges)?,
                encode_time(graph.created_at),
            ],
        )?;
        Ok(())
    }

    pub fn insert_agent_run(&self, run: &AgentRun) -> Result<(), StoreError> {
        self.connection.execute(
            r#"
            INSERT INTO agent_runs
              (id, work_run_id, execution_graph_node_id, workspace_id, runtime, model, role, status, started_at, ended_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params![
                run.id.to_string(),
                run.work_run_id.to_string(),
                run.execution_graph_node_id.map(|id| id.to_string()),
                run.workspace_id.to_string(),
                encode_runtime_kind(run.runtime),
                run.model,
                encode_agent_role(run.role),
                encode_agent_run_status(run.status),
                encode_time(run.started_at),
                run.ended_at.map(encode_time),
            ],
        )?;
        Ok(())
    }

    pub fn insert_changeset(&self, changeset: &ChangeSet) -> Result<(), StoreError> {
        self.connection.execute(
            r#"
            INSERT INTO changesets
              (id, work_run_id, agent_run_id, workspace_id, status, changed_files_json, diff_ref, created_at, updated_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            params![
                changeset.id.to_string(),
                changeset.work_run_id.to_string(),
                changeset.agent_run_id.to_string(),
                changeset.workspace_id.to_string(),
                encode_changeset_status(changeset.status),
                serde_json::to_string(&changeset.changed_files)?,
                changeset.diff_ref,
                encode_time(changeset.created_at),
                encode_time(changeset.updated_at),
            ],
        )?;
        Ok(())
    }

    pub fn insert_proof(&self, proof: &Proof) -> Result<(), StoreError> {
        self.connection.execute(
            r#"
            INSERT INTO proofs
              (id, work_run_id, changeset_id, proof_type, status, summary, metadata_json, created_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                proof.id.to_string(),
                proof.work_run_id.to_string(),
                proof.changeset_id.map(|id| id.to_string()),
                encode_proof_type(proof.proof_type),
                encode_proof_status(proof.status),
                proof.summary,
                proof.metadata_json,
                encode_time(proof.created_at),
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

    pub fn list_work_runs(&self) -> Result<Vec<WorkRunSummary>, StoreError> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT
              wr.id, wr.work_item_id, wr.status, wr.goal, wr.workspace_id, wr.active_supervisor_session_id,
              wr.created_at, wr.updated_at, wr.completed_at,
              wi.id, wi.source, wi.title, wi.description, wi.external_ref, wi.status, wi.created_at, wi.updated_at,
              COUNT(e.id) as event_count
            FROM work_runs wr
            JOIN work_items wi ON wi.id = wr.work_item_id
            LEFT JOIN events e ON e.work_run_id = wr.id
            GROUP BY wr.id
            ORDER BY wr.created_at DESC
            "#,
        )?;
        let rows = statement.query_map([], |row| {
            let workspace_id: Option<String> = row.get(4)?;
            let active_supervisor_session_id: Option<String> = row.get(5)?;
            let completed_at: Option<String> = row.get(8)?;
            Ok((
                WorkRun {
                    id: parse_uuid(row.get::<_, String>(0)?).map_err(to_sql_error)?,
                    work_item_id: parse_uuid(row.get::<_, String>(1)?).map_err(to_sql_error)?,
                    status: decode_work_run_status(&row.get::<_, String>(2)?),
                    goal: row.get(3)?,
                    workspace_id: workspace_id
                        .map(parse_uuid)
                        .transpose()
                        .map_err(to_sql_error)?,
                    active_supervisor_session_id: active_supervisor_session_id
                        .map(parse_uuid)
                        .transpose()
                        .map_err(to_sql_error)?,
                    created_at: decode_time(&row.get::<_, String>(6)?).map_err(to_sql_error)?,
                    updated_at: decode_time(&row.get::<_, String>(7)?).map_err(to_sql_error)?,
                    completed_at: completed_at
                        .as_deref()
                        .map(decode_time)
                        .transpose()
                        .map_err(to_sql_error)?,
                },
                WorkItem {
                    id: parse_uuid(row.get::<_, String>(9)?).map_err(to_sql_error)?,
                    source: decode_work_item_source(&row.get::<_, String>(10)?),
                    title: row.get(11)?,
                    description: row.get(12)?,
                    external_ref: row.get(13)?,
                    status: decode_work_item_status(&row.get::<_, String>(14)?),
                    created_at: decode_time(&row.get::<_, String>(15)?).map_err(to_sql_error)?,
                    updated_at: decode_time(&row.get::<_, String>(16)?).map_err(to_sql_error)?,
                },
                row.get::<_, i64>(17)? as usize,
            ))
        })?;

        rows.map(|row| {
            let (run, item, event_count) = row?;
            Ok(WorkRunSummary {
                run,
                item,
                event_count,
            })
        })
        .collect()
    }

    pub fn list_events_for_work_run(&self, work_run_id: Uuid) -> Result<Vec<Event>, StoreError> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, work_run_id, actor, event_type, summary, payload_json, created_at
            FROM events
            WHERE work_run_id = ?1
            ORDER BY created_at ASC
            "#,
        )?;
        let rows = statement.query_map(params![work_run_id.to_string()], |row| {
            Ok(Event {
                id: parse_uuid(row.get::<_, String>(0)?).map_err(to_sql_error)?,
                work_run_id: parse_uuid(row.get::<_, String>(1)?).map_err(to_sql_error)?,
                actor: decode_event_actor(&row.get::<_, String>(2)?),
                event_type: row.get(3)?,
                summary: row.get(4)?,
                payload_json: row.get(5)?,
                created_at: decode_time(&row.get::<_, String>(6)?).map_err(to_sql_error)?,
            })
        })?;
        rows.map(|row| Ok(row?)).collect()
    }
}

fn to_sql_error<E>(error: E) -> rusqlite::Error
where
    E: std::error::Error + Send + Sync + 'static,
{
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
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

fn decode_event_actor(value: &str) -> EventActor {
    match value {
        "supervisor_agent" => EventActor::SupervisorAgent,
        "subagent" => EventActor::Subagent,
        "runtime" => EventActor::Runtime,
        "user" => EventActor::User,
        "tracker" => EventActor::Tracker,
        _ => EventActor::XieZhi,
    }
}

fn encode_workspace_kind(value: WorkspaceKind) -> &'static str {
    match value {
        WorkspaceKind::Run => "run",
        WorkspaceKind::Agent => "agent",
        WorkspaceKind::Proof => "proof",
    }
}

fn encode_workspace_status(value: WorkspaceStatus) -> &'static str {
    match value {
        WorkspaceStatus::Creating => "creating",
        WorkspaceStatus::Ready => "ready",
        WorkspaceStatus::Dirty => "dirty",
        WorkspaceStatus::Archived => "archived",
        WorkspaceStatus::Removed => "removed",
        WorkspaceStatus::Failed => "failed",
    }
}

fn encode_runtime_kind(value: RuntimeKind) -> &'static str {
    match value {
        RuntimeKind::OpenCode => "opencode",
        RuntimeKind::Codex => "codex",
        RuntimeKind::ClaudeCode => "claude_code",
    }
}

fn decode_runtime_kind(value: &str) -> RuntimeKind {
    match value {
        "codex" => RuntimeKind::Codex,
        "claude_code" => RuntimeKind::ClaudeCode,
        _ => RuntimeKind::OpenCode,
    }
}

fn encode_supervisor_session_status(value: SupervisorSessionStatus) -> &'static str {
    match value {
        SupervisorSessionStatus::Starting => "starting",
        SupervisorSessionStatus::Running => "running",
        SupervisorSessionStatus::Waiting => "waiting",
        SupervisorSessionStatus::Stopped => "stopped",
        SupervisorSessionStatus::Failed => "failed",
    }
}

fn decode_supervisor_session_status(value: &str) -> SupervisorSessionStatus {
    match value {
        "running" => SupervisorSessionStatus::Running,
        "waiting" => SupervisorSessionStatus::Waiting,
        "stopped" => SupervisorSessionStatus::Stopped,
        "failed" => SupervisorSessionStatus::Failed,
        _ => SupervisorSessionStatus::Starting,
    }
}

fn encode_decision_point_status(value: xiezhi_core::DecisionPointStatus) -> &'static str {
    match value {
        xiezhi_core::DecisionPointStatus::Pending => "pending",
        xiezhi_core::DecisionPointStatus::Resolved => "resolved",
        xiezhi_core::DecisionPointStatus::Cancelled => "cancelled",
    }
}

fn encode_agent_role(value: AgentRole) -> &'static str {
    match value {
        AgentRole::Supervisor => "supervisor",
        AgentRole::Implementation => "implementation",
        AgentRole::Test => "test",
        AgentRole::Design => "design",
        AgentRole::Review => "review",
        AgentRole::Integration => "integration",
    }
}

fn encode_agent_run_status(value: AgentRunStatus) -> &'static str {
    match value {
        AgentRunStatus::Planned => "planned",
        AgentRunStatus::Running => "running",
        AgentRunStatus::Completed => "completed",
        AgentRunStatus::Failed => "failed",
        AgentRunStatus::Cancelled => "cancelled",
    }
}

fn encode_changeset_status(value: ChangeSetStatus) -> &'static str {
    match value {
        ChangeSetStatus::Captured => "captured",
        ChangeSetStatus::Verified => "verified",
        ChangeSetStatus::Held => "held",
        ChangeSetStatus::Promoted => "promoted",
        ChangeSetStatus::Rejected => "rejected",
    }
}

fn encode_proof_type(value: ProofType) -> &'static str {
    match value {
        ProofType::Command => "command",
        ProofType::SemanticDiff => "semantic_diff",
        ProofType::ScopeVerdict => "scope_verdict",
        ProofType::Review => "review",
        ProofType::Screenshot => "screenshot",
        ProofType::AppLaunch => "app_launch",
        ProofType::ManualWalkthrough => "manual_walkthrough",
        ProofType::PromotionCommit => "promotion_commit",
        ProofType::TrackerUpdate => "tracker_update",
    }
}

fn encode_proof_status(value: ProofStatus) -> &'static str {
    match value {
        ProofStatus::Pending => "pending",
        ProofStatus::Passed => "passed",
        ProofStatus::Warning => "warning",
        ProofStatus::Failed => "failed",
        ProofStatus::Blocked => "blocked",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::OffsetDateTime;
    use xiezhi_core::{
        AgentRole, AgentRun, AgentRunStatus, ChangeSet, ChangeSetStatus, DecisionOption,
        DecisionPoint, DecisionPointStatus, Event, ExecutionGraph, Proof, ProofStatus, ProofType,
        RuntimeKind, SupervisorSession, SupervisorSessionStatus, WorkItem, WorkRun, Workspace,
        WorkspaceKind, WorkspaceStatus,
    };

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

    #[test]
    fn persists_orchestration_entities() {
        let store = Store::open_memory().unwrap();
        let item = WorkItem::local_goal("build a pomodoro app");
        let run = WorkRun::new(item.id, item.title.clone());
        store.insert_work_item(&item).unwrap();
        store.insert_work_run(&run).unwrap();

        let now = OffsetDateTime::now_utc();
        let workspace = Workspace {
            id: Uuid::now_v7(),
            work_run_id: run.id,
            kind: WorkspaceKind::Run,
            path: "/tmp/xiezhi/workspaces/run".to_string(),
            base_ref: Some("main".to_string()),
            status: WorkspaceStatus::Ready,
            created_at: now,
            updated_at: now,
        };
        store.insert_workspace(&workspace).unwrap();

        store
            .insert_supervisor_session(&SupervisorSession {
                id: Uuid::now_v7(),
                work_run_id: run.id,
                runtime: RuntimeKind::OpenCode,
                model: Some("provider/model".to_string()),
                status: SupervisorSessionStatus::Running,
                started_at: now,
                ended_at: None,
                last_event_id: None,
            })
            .unwrap();
        assert_eq!(
            store
                .list_supervisor_sessions_for_work_run(run.id)
                .unwrap()
                .len(),
            1
        );

        store
            .insert_decision_point(&DecisionPoint {
                id: Uuid::now_v7(),
                work_run_id: run.id,
                status: DecisionPointStatus::Pending,
                problem: "Choose UI style.".to_string(),
                impact: "Affects the app surface.".to_string(),
                recommended_option_id: "minimal".to_string(),
                options: vec![DecisionOption {
                    id: "minimal".to_string(),
                    label: "Minimal".to_string(),
                    tradeoff: "Fast and clean.".to_string(),
                    plan_delta: "Use a compact timer layout.".to_string(),
                }],
                selected_option_id: None,
                created_at: now,
                resolved_at: None,
            })
            .unwrap();

        store
            .insert_execution_graph(&ExecutionGraph {
                id: Uuid::now_v7(),
                work_run_id: run.id,
                version: "v1".to_string(),
                status: "draft".to_string(),
                nodes: vec![],
                edges: vec![],
                created_at: now,
            })
            .unwrap();

        let agent_run = AgentRun {
            id: Uuid::now_v7(),
            work_run_id: run.id,
            execution_graph_node_id: None,
            workspace_id: workspace.id,
            runtime: RuntimeKind::OpenCode,
            model: None,
            role: AgentRole::Implementation,
            status: AgentRunStatus::Completed,
            started_at: now,
            ended_at: Some(now),
        };
        store.insert_agent_run(&agent_run).unwrap();

        let changeset = ChangeSet {
            id: Uuid::now_v7(),
            work_run_id: run.id,
            agent_run_id: agent_run.id,
            workspace_id: workspace.id,
            status: ChangeSetStatus::Captured,
            changed_files: vec!["src/main.rs".to_string()],
            diff_ref: None,
            created_at: now,
            updated_at: now,
        };
        store.insert_changeset(&changeset).unwrap();

        store
            .insert_proof(&Proof {
                id: Uuid::now_v7(),
                work_run_id: run.id,
                changeset_id: Some(changeset.id),
                proof_type: ProofType::Command,
                status: ProofStatus::Passed,
                summary: "cargo test passed".to_string(),
                metadata_json: None,
                created_at: now,
            })
            .unwrap();
    }
}
