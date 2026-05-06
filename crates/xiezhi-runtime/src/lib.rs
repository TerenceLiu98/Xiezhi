use std::{fs, path::Path};

use thiserror::Error;
use xiezhi_workflow::Workflow;

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
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
}
