use std::{
    fs,
    io::{ErrorKind, Write},
    path::Path,
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use xiezhi_core::{
    ExecutionGraph, ExecutionGraphEdge, ExecutionGraphNode, GraphEdgeKind, GraphNodeKind,
};
use xiezhi_workflow::Workflow;

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeCommandOutput {
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub structured_events: Vec<RuntimeStructuredEvent>,
}

impl RuntimeCommandOutput {
    pub fn success(&self) -> bool {
        self.exit_code == Some(0)
    }
}

pub fn run_supervisor_intake_command(
    command: &str,
    cwd: impl AsRef<Path>,
    prompt: &str,
    model: Option<&str>,
) -> Result<RuntimeCommandOutput, RuntimeError> {
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(command)
        .current_dir(cwd)
        .env("XIEZHI_SUPERVISOR_PROMPT", prompt)
        .env("XIEZHI_RUNTIME_MODEL", model.unwrap_or(""))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    if let Some(stdin) = child.stdin.as_mut() {
        match stdin.write_all(prompt.as_bytes()) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::BrokenPipe => {}
            Err(error) => return Err(error.into()),
        }
    }

    let output = child.wait_with_output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let structured_events = extract_structured_events(&format!("{stdout}\n{stderr}"));

    Ok(RuntimeCommandOutput {
        command: command.to_string(),
        exit_code: output.status.code(),
        stdout,
        stderr,
        structured_events,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupervisorIntakeInput {
    pub goal: String,
    pub work_run_id: String,
    pub workspace_path: String,
    pub workflow: Workflow,
}

pub fn build_supervisor_intake_prompt(input: &SupervisorIntakeInput) -> String {
    let model = input
        .workflow
        .agent_runtime
        .model
        .as_deref()
        .unwrap_or("<runtime default>");
    let proof_requirements = if input.workflow.proof.required.is_empty() {
        "- none declared yet".to_string()
    } else {
        input
            .workflow
            .proof
            .required
            .iter()
            .map(|requirement| {
                let command = requirement.command.as_deref().unwrap_or("<none>");
                let target = requirement.target.as_deref().unwrap_or("<none>");
                format!(
                    "- type: {}; command: {}; target: {}",
                    requirement.proof_type, command, target
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let instructions = if input.workflow.instructions.trim().is_empty() {
        "No additional workflow instructions were provided.".to_string()
    } else {
        input.workflow.instructions.trim().to_string()
    };

    format!(
        r#"# XieZhi Supervisor Intake

You are the supervisor agent for this XieZhi WorkRun.

## Goal

{goal}

## WorkRun

- work_run_id: {work_run_id}
- workspace_path: {workspace_path}
- runtime: {runtime:?}
- model: {model}
- max_concurrent_agent_runs: {max_concurrent_agent_runs}
- max_recovery_attempts: {max_recovery_attempts}

## Your Job

Explore the workspace, understand the goal, expose product/architecture/UX/acceptance decisions when user judgment is needed, plan subagent work, and report progress.

XieZhi is the orchestration harness. It records decisions, DAGs, AST/scope evidence, changesets, proofs, and promotion evidence. Do not treat XieZhi as the product planner.

## Decision Rule

Ask the user only for decisions that affect intent:

- product shape
- architecture or technology stack
- UX direction
- MVP scope tradeoffs
- acceptance policy

Do not ask the user to resolve ordinary build, verify, review, scope, or recovery errors. Report those as engineering problems with proposed solutions.

## Structured Outputs

During intake, free-form observations are allowed. When you need XieZhi to act, emit one supported JSON object:

- AgentDecisionPoint v1
- AgentProgressReport v1
- SupervisorHandoff v1

When ready to normalize into a DAG, emit SupervisorHandoff v1 with readyToNormalize=true.

## Proof Requirements

{proof_requirements}

## Workflow Instructions

{instructions}
"#,
        goal = input.goal,
        work_run_id = input.work_run_id,
        workspace_path = input.workspace_path,
        runtime = input.workflow.agent_runtime.kind,
        model = model,
        max_concurrent_agent_runs = input.workflow.limits.max_concurrent_agent_runs,
        max_recovery_attempts = input.workflow.limits.max_recovery_attempts,
        proof_requirements = proof_requirements,
        instructions = instructions,
    )
}

pub fn write_supervisor_intake_prompt(
    workspace_path: impl AsRef<Path>,
    prompt: &str,
) -> Result<String, RuntimeError> {
    let path = workspace_path.as_ref().join("xiezhi-supervisor-intake.md");
    fs::write(&path, prompt)?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RuntimeStructuredEvent {
    #[serde(rename = "decision_point")]
    AgentDecisionPoint(AgentDecisionPoint),
    #[serde(rename = "progress_report")]
    AgentProgressReport(AgentProgressReport),
    #[serde(rename = "supervisor_handoff")]
    SupervisorHandoff(SupervisorHandoff),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDecisionPoint {
    pub version: String,
    pub goal: String,
    pub problem: String,
    pub impact: String,
    pub recommended_option_id: String,
    pub options: Vec<AgentDecisionOption>,
    pub default_if_unanswered: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDecisionOption {
    pub id: String,
    pub label: String,
    pub tradeoff: String,
    pub plan_delta: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProgressReport {
    pub version: String,
    pub phase: String,
    pub summary: String,
    pub current_task_id: Option<String>,
    pub execution_group: Option<String>,
    pub subagents: Vec<AgentProgressSubagent>,
    pub risks: Vec<String>,
    pub next_action: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProgressSubagent {
    pub id: String,
    pub role: String,
    pub task_id: Option<String>,
    pub status: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorHandoff {
    pub version: String,
    pub goal: String,
    pub summary: String,
    pub assumptions: Vec<String>,
    pub resolved_decisions: Vec<String>,
    pub subagent_plan: Vec<SupervisorSubagentPlan>,
    pub normalization_instructions: Vec<String>,
    pub ready_to_normalize: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorSubagentPlan {
    pub id: String,
    pub role: String,
    pub summary: String,
    pub suggested_scope: Vec<String>,
}

pub fn parse_structured_event(source: &str) -> Result<RuntimeStructuredEvent, RuntimeError> {
    Ok(serde_json::from_str(source)?)
}

pub fn extract_structured_events(source: &str) -> Vec<RuntimeStructuredEvent> {
    if let Ok(event) = parse_structured_event(source.trim()) {
        return vec![event];
    }

    json_object_slices(source)
        .into_iter()
        .filter_map(|slice| parse_structured_event(slice).ok())
        .collect()
}

pub fn execution_graph_from_supervisor_handoff(
    work_run_id: Uuid,
    handoff: &SupervisorHandoff,
) -> ExecutionGraph {
    let goal_node = ExecutionGraphNode {
        id: Uuid::now_v7(),
        kind: GraphNodeKind::Goal,
        title: handoff.goal.clone(),
        body: Some(handoff.summary.clone()),
    };
    let feature_node = ExecutionGraphNode {
        id: Uuid::now_v7(),
        kind: GraphNodeKind::Feature,
        title: "Supervisor plan".to_string(),
        body: Some(format!(
            "Assumptions:\n{}\n\nResolved decisions:\n{}",
            bullet_lines(&handoff.assumptions),
            bullet_lines(&handoff.resolved_decisions),
        )),
    };
    let mut nodes = vec![goal_node.clone(), feature_node.clone()];
    let mut edges = vec![ExecutionGraphEdge {
        from: goal_node.id,
        to: feature_node.id,
        kind: GraphEdgeKind::Contains,
    }];

    for subagent in &handoff.subagent_plan {
        let task_node = ExecutionGraphNode {
            id: Uuid::now_v7(),
            kind: GraphNodeKind::Task,
            title: format!("{}: {}", subagent.role, subagent.id),
            body: Some(format!(
                "{}\n\nSuggested scope:\n{}",
                subagent.summary,
                bullet_lines(&subagent.suggested_scope),
            )),
        };
        edges.push(ExecutionGraphEdge {
            from: feature_node.id,
            to: task_node.id,
            kind: GraphEdgeKind::Contains,
        });
        nodes.push(task_node);
    }

    ExecutionGraph {
        id: Uuid::now_v7(),
        work_run_id,
        version: "v1".to_string(),
        status: "draft".to_string(),
        nodes,
        edges,
        created_at: OffsetDateTime::now_utc(),
    }
}

fn bullet_lines(values: &[String]) -> String {
    if values.is_empty() {
        "- none".to_string()
    } else {
        values
            .iter()
            .map(|value| format!("- {value}"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn json_object_slices(source: &str) -> Vec<&str> {
    let mut slices = Vec::new();
    let mut depth = 0usize;
    let mut start = None;
    let mut in_string = false;
    let mut escaped = false;

    for (index, character) in source.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match character {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match character {
            '"' => in_string = true,
            '{' => {
                if depth == 0 {
                    start = Some(index);
                }
                depth += 1;
            }
            '}' => {
                if depth == 0 {
                    continue;
                }
                depth -= 1;
                if depth == 0 {
                    if let Some(start_index) = start.take() {
                        slices.push(&source[start_index..index + character.len_utf8()]);
                    }
                }
            }
            _ => {}
        }
    }

    slices
}

#[cfg(test)]
mod tests {
    use super::*;
    use xiezhi_workflow::parse_workflow;

    #[test]
    fn builds_supervisor_intake_prompt() {
        let workflow = parse_workflow(
            r#"---
agent_runtime:
  kind: opencode
  model: xiaomi/mimo
limits:
  max_concurrent_agent_runs: 4
proof:
  required:
    - type: command
      command: cargo test
---
Prefer small, inspectable steps.
"#,
        )
        .unwrap();

        let prompt = build_supervisor_intake_prompt(&SupervisorIntakeInput {
            goal: "build a pomodoro app".to_string(),
            work_run_id: "run-1".to_string(),
            workspace_path: "/tmp/workspace".to_string(),
            workflow,
        });

        assert!(prompt.contains("build a pomodoro app"));
        assert!(prompt.contains("xiaomi/mimo"));
        assert!(prompt.contains("AgentDecisionPoint v1"));
        assert!(prompt.contains("SupervisorHandoff v1"));
        assert!(prompt.contains("cargo test"));
        assert!(prompt.contains("Prefer small, inspectable steps."));
    }

    #[test]
    fn extracts_decision_point_from_text() {
        let output = r#"
Observation: project is empty.
{"version":"v1","type":"decision_point","goal":"build a pomodoro app","problem":"Choose product surface.","impact":"This affects app architecture.","recommendedOptionId":"desktop","options":[{"id":"desktop","label":"Desktop app","tradeoff":"Best local app feel.","planDelta":"Use Tauri."}],"defaultIfUnanswered":"desktop"}
Continuing after decision.
"#;

        let events = extract_structured_events(output);

        assert_eq!(events.len(), 1);
        match &events[0] {
            RuntimeStructuredEvent::AgentDecisionPoint(decision) => {
                assert_eq!(decision.recommended_option_id, "desktop");
            }
            _ => panic!("expected decision point"),
        }
    }

    #[test]
    fn extracts_multiple_supported_events() {
        let output = r#"
{"version":"v1","type":"progress_report","phase":"planning","summary":"Planning subagents.","currentTaskId":null,"executionGroup":null,"subagents":[],"risks":[],"nextAction":"handoff"}
{"version":"v1","type":"supervisor_handoff","goal":"build","summary":"Ready.","assumptions":["local app"],"resolvedDecisions":[],"subagentPlan":[{"id":"impl","role":"implementation","summary":"Build app shell.","suggestedScope":["src/"]}],"normalizationInstructions":["Create DAG."],"readyToNormalize":true}
"#;

        let events = extract_structured_events(output);

        assert_eq!(events.len(), 2);
        assert!(matches!(
            events[0],
            RuntimeStructuredEvent::AgentProgressReport(_)
        ));
        assert!(matches!(
            events[1],
            RuntimeStructuredEvent::SupervisorHandoff(_)
        ));
    }

    #[test]
    fn ignores_unsupported_json_objects() {
        let output = r#"{"type":"unknown","version":"v1"}"#;

        assert!(extract_structured_events(output).is_empty());
    }

    #[test]
    fn runs_supervisor_intake_command_and_extracts_events() {
        let output = run_supervisor_intake_command(
            r#"printf '%s\n' '{"version":"v1","type":"progress_report","phase":"planning","summary":"Planning.","currentTaskId":null,"executionGroup":null,"subagents":[],"risks":[],"nextAction":"handoff"}'"#,
            ".",
            "hello supervisor",
            Some("provider/model"),
        )
        .unwrap();

        assert!(output.success());
        assert_eq!(output.structured_events.len(), 1);
        assert!(matches!(
            output.structured_events[0],
            RuntimeStructuredEvent::AgentProgressReport(_)
        ));
    }

    #[test]
    fn sends_prompt_to_runtime_stdin() {
        let output = run_supervisor_intake_command("cat", ".", "hello supervisor", None).unwrap();

        assert!(output.success());
        assert_eq!(output.stdout, "hello supervisor");
    }

    #[test]
    fn converts_handoff_to_execution_graph() {
        let handoff = SupervisorHandoff {
            version: "v1".to_string(),
            goal: "build".to_string(),
            summary: "Ready.".to_string(),
            assumptions: vec!["local app".to_string()],
            resolved_decisions: vec!["desktop".to_string()],
            subagent_plan: vec![SupervisorSubagentPlan {
                id: "impl".to_string(),
                role: "implementation".to_string(),
                summary: "Build the app shell.".to_string(),
                suggested_scope: vec!["src/".to_string()],
            }],
            normalization_instructions: vec!["Create DAG.".to_string()],
            ready_to_normalize: true,
        };

        let graph = execution_graph_from_supervisor_handoff(Uuid::now_v7(), &handoff);

        assert_eq!(graph.nodes.len(), 3);
        assert_eq!(graph.edges.len(), 2);
        assert!(graph.nodes.iter().any(|node| node.title == "build"));
        assert!(
            graph
                .nodes
                .iter()
                .any(|node| node.title == "implementation: impl")
        );
    }
}
