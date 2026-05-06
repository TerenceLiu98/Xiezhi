use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkflowError {
    #[error("workflow file could not be read: {0}")]
    Read(#[from] std::io::Error),
    #[error("workflow file is missing YAML front matter")]
    MissingFrontMatter,
    #[error("workflow YAML front matter is invalid: {0}")]
    InvalidYaml(#[from] serde_yaml::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Workflow {
    pub work: WorkConfig,
    pub workspace: WorkspaceConfig,
    pub agent_runtime: AgentRuntimeConfig,
    pub limits: LimitsConfig,
    pub proof: ProofConfig,
    pub hooks: HooksConfig,
    pub instructions: String,
}

impl Default for Workflow {
    fn default() -> Self {
        Self {
            work: WorkConfig::default(),
            workspace: WorkspaceConfig::default(),
            agent_runtime: AgentRuntimeConfig::default(),
            limits: LimitsConfig::default(),
            proof: ProofConfig::default(),
            hooks: HooksConfig::default(),
            instructions: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkConfig {
    pub source: WorkSourceConfig,
}

impl Default for WorkConfig {
    fn default() -> Self {
        Self {
            source: WorkSourceConfig::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkSourceConfig {
    pub kind: WorkSourceKind,
}

impl Default for WorkSourceConfig {
    fn default() -> Self {
        Self {
            kind: WorkSourceKind::Local,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkSourceKind {
    Local,
    Markdown,
    GitHub,
    Linear,
    Jira,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkspaceConfig {
    pub root: String,
    pub cleanup: CleanupConfig,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            root: "~/.xiezhi/workspaces".to_string(),
            cleanup: CleanupConfig::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CleanupConfig {
    pub completed: CleanupPolicy,
    pub failed: CleanupPolicy,
}

impl Default for CleanupConfig {
    fn default() -> Self {
        Self {
            completed: CleanupPolicy::Archive,
            failed: CleanupPolicy::Retain,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CleanupPolicy {
    Retain,
    Archive,
    Remove,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct AgentRuntimeConfig {
    pub kind: AgentRuntimeKind,
    pub command: String,
    pub model: Option<String>,
}

impl Default for AgentRuntimeConfig {
    fn default() -> Self {
        Self {
            kind: AgentRuntimeKind::OpenCode,
            command: "opencode serve".to_string(),
            model: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentRuntimeKind {
    #[serde(alias = "open_code", rename = "opencode")]
    OpenCode,
    #[serde(rename = "codex")]
    Codex,
    #[serde(alias = "claudecode", rename = "claude_code")]
    ClaudeCode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct LimitsConfig {
    pub max_concurrent_agent_runs: usize,
    pub max_recovery_attempts: usize,
    pub command_timeout_ms: u64,
}

impl Default for LimitsConfig {
    fn default() -> Self {
        Self {
            max_concurrent_agent_runs: 2,
            max_recovery_attempts: 5,
            command_timeout_ms: 120_000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ProofConfig {
    pub required: Vec<ProofRequirementConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProofRequirementConfig {
    #[serde(rename = "type")]
    pub proof_type: String,
    pub command: Option<String>,
    pub target: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct HooksConfig {
    pub after_workspace_create: Option<String>,
    pub before_supervisor_start: Option<String>,
    pub before_agent_run: Option<String>,
    pub after_agent_run: Option<String>,
    pub after_patch_capture: Option<String>,
    pub after_proof: Option<String>,
    pub before_promote: Option<String>,
    pub after_complete: Option<String>,
    pub before_workspace_remove: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(default)]
struct WorkflowFrontMatter {
    work: WorkConfig,
    workspace: WorkspaceConfig,
    agent_runtime: AgentRuntimeConfig,
    limits: LimitsConfig,
    proof: ProofConfig,
    hooks: HooksConfig,
}

impl Default for WorkflowFrontMatter {
    fn default() -> Self {
        Self {
            work: WorkConfig::default(),
            workspace: WorkspaceConfig::default(),
            agent_runtime: AgentRuntimeConfig::default(),
            limits: LimitsConfig::default(),
            proof: ProofConfig::default(),
            hooks: HooksConfig::default(),
        }
    }
}

pub fn load_workflow(path: impl AsRef<Path>) -> Result<Workflow, WorkflowError> {
    parse_workflow(&fs::read_to_string(path)?)
}

pub fn parse_workflow(source: &str) -> Result<Workflow, WorkflowError> {
    let trimmed = source.trim_start();
    if !trimmed.starts_with("---") {
        return Err(WorkflowError::MissingFrontMatter);
    }

    let rest = &trimmed[3..];
    let Some(end) = rest.find("\n---") else {
        return Err(WorkflowError::MissingFrontMatter);
    };
    let yaml = &rest[..end];
    let instructions = rest[end + 4..].trim_start_matches(['\r', '\n']).to_string();
    let front_matter: WorkflowFrontMatter = serde_yaml::from_str(yaml)?;

    Ok(Workflow {
        work: front_matter.work,
        workspace: front_matter.workspace,
        agent_runtime: front_matter.agent_runtime,
        limits: front_matter.limits,
        proof: front_matter.proof,
        hooks: front_matter.hooks,
        instructions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_front_matter_and_instructions() {
        let workflow = parse_workflow(
            r#"---
workspace:
  root: /tmp/xiezhi
agent_runtime:
  kind: opencode
  command: opencode serve
  model: xiaomi/mimo
limits:
  max_concurrent_agent_runs: 4
proof:
  required:
    - type: command
      command: cargo test
---
You are the supervisor.
"#,
        )
        .unwrap();

        assert_eq!(workflow.workspace.root, "/tmp/xiezhi");
        assert_eq!(workflow.agent_runtime.kind, AgentRuntimeKind::OpenCode);
        assert_eq!(workflow.agent_runtime.model.as_deref(), Some("xiaomi/mimo"));
        assert_eq!(workflow.limits.max_concurrent_agent_runs, 4);
        assert_eq!(
            workflow.proof.required[0].command.as_deref(),
            Some("cargo test")
        );
        assert_eq!(workflow.instructions.trim(), "You are the supervisor.");
    }

    #[test]
    fn applies_defaults() {
        let workflow = parse_workflow("---\n---\nInstructions\n").unwrap();
        assert_eq!(workflow.workspace.root, "~/.xiezhi/workspaces");
        assert_eq!(workflow.agent_runtime.command, "opencode serve");
        assert_eq!(workflow.limits.max_recovery_attempts, 5);
    }
}
