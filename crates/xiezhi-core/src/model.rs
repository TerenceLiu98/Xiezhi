use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

pub type EntityId = Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkItemSource {
    LocalGoal,
    Markdown,
    GitHubIssue,
    LinearIssue,
    JiraIssue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkItemStatus {
    Open,
    Active,
    Completed,
    Cancelled,
    Archived,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkItem {
    pub id: EntityId,
    pub source: WorkItemSource,
    pub title: String,
    pub description: Option<String>,
    pub external_ref: Option<String>,
    pub status: WorkItemStatus,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

impl WorkItem {
    pub fn local_goal(title: impl Into<String>) -> Self {
        let now = OffsetDateTime::now_utc();
        Self {
            id: Uuid::now_v7(),
            source: WorkItemSource::LocalGoal,
            title: title.into(),
            description: None,
            external_ref: None,
            status: WorkItemStatus::Open,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkRunStatus {
    Created,
    WorkspaceReady,
    SupervisorIntake,
    WaitingForDecision,
    Planning,
    Executing,
    Verifying,
    Recovering,
    HumanAcceptance,
    Completed,
    Cancelled,
    Failed,
    Archived,
}

impl WorkRunStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Cancelled | Self::Failed | Self::Archived
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkRun {
    pub id: EntityId,
    pub work_item_id: EntityId,
    pub status: WorkRunStatus,
    pub goal: String,
    pub workspace_id: Option<EntityId>,
    pub active_supervisor_session_id: Option<EntityId>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub completed_at: Option<OffsetDateTime>,
}

impl WorkRun {
    pub fn new(work_item_id: EntityId, goal: impl Into<String>) -> Self {
        let now = OffsetDateTime::now_utc();
        Self {
            id: Uuid::now_v7(),
            work_item_id,
            status: WorkRunStatus::Created,
            goal: goal.into(),
            workspace_id: None,
            active_supervisor_session_id: None,
            created_at: now,
            updated_at: now,
            completed_at: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceKind {
    Run,
    Agent,
    Proof,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceStatus {
    Creating,
    Ready,
    Dirty,
    Archived,
    Removed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: EntityId,
    pub work_run_id: EntityId,
    pub kind: WorkspaceKind,
    pub path: String,
    pub base_ref: Option<String>,
    pub status: WorkspaceStatus,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeKind {
    OpenCode,
    Codex,
    ClaudeCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupervisorSessionStatus {
    Starting,
    Running,
    Waiting,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SupervisorSession {
    pub id: EntityId,
    pub work_run_id: EntityId,
    pub runtime: RuntimeKind,
    pub model: Option<String>,
    pub status: SupervisorSessionStatus,
    pub started_at: OffsetDateTime,
    pub ended_at: Option<OffsetDateTime>,
    pub last_event_id: Option<EntityId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecisionOption {
    pub id: String,
    pub label: String,
    pub tradeoff: String,
    pub plan_delta: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionPointStatus {
    Pending,
    Resolved,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecisionPoint {
    pub id: EntityId,
    pub work_run_id: EntityId,
    pub status: DecisionPointStatus,
    pub problem: String,
    pub impact: String,
    pub recommended_option_id: String,
    pub options: Vec<DecisionOption>,
    pub selected_option_id: Option<String>,
    pub created_at: OffsetDateTime,
    pub resolved_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GraphNodeKind {
    Goal,
    Feature,
    Requirement,
    Task,
    ProofRequirement,
    Workspace,
    ChangeSet,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GraphEdgeKind {
    Contains,
    DependsOn,
    Satisfies,
    Produces,
    VerifiedBy,
    Blocks,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionGraph {
    pub id: EntityId,
    pub work_run_id: EntityId,
    pub version: String,
    pub status: String,
    pub nodes: Vec<ExecutionGraphNode>,
    pub edges: Vec<ExecutionGraphEdge>,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionGraphNode {
    pub id: EntityId,
    pub kind: GraphNodeKind,
    pub title: String,
    pub body: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionGraphEdge {
    pub from: EntityId,
    pub to: EntityId,
    pub kind: GraphEdgeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Supervisor,
    Implementation,
    Test,
    Design,
    Review,
    Integration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunStatus {
    Planned,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentRun {
    pub id: EntityId,
    pub work_run_id: EntityId,
    pub execution_graph_node_id: Option<EntityId>,
    pub workspace_id: EntityId,
    pub runtime: RuntimeKind,
    pub model: Option<String>,
    pub role: AgentRole,
    pub status: AgentRunStatus,
    pub started_at: OffsetDateTime,
    pub ended_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeSetStatus {
    Captured,
    Verified,
    Held,
    Promoted,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangeSet {
    pub id: EntityId,
    pub work_run_id: EntityId,
    pub agent_run_id: EntityId,
    pub workspace_id: EntityId,
    pub status: ChangeSetStatus,
    pub changed_files: Vec<String>,
    pub diff_ref: Option<String>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProofType {
    Command,
    SemanticDiff,
    ScopeVerdict,
    Review,
    Screenshot,
    AppLaunch,
    ManualWalkthrough,
    PromotionCommit,
    TrackerUpdate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProofStatus {
    Pending,
    Passed,
    Warning,
    Failed,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Proof {
    pub id: EntityId,
    pub work_run_id: EntityId,
    pub changeset_id: Option<EntityId>,
    pub proof_type: ProofType,
    pub status: ProofStatus,
    pub summary: String,
    pub metadata_json: Option<String>,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventActor {
    XieZhi,
    SupervisorAgent,
    Subagent,
    Runtime,
    User,
    Tracker,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    pub id: EntityId,
    pub work_run_id: EntityId,
    pub actor: EventActor,
    pub event_type: String,
    pub summary: String,
    pub payload_json: Option<String>,
    pub created_at: OffsetDateTime,
}

