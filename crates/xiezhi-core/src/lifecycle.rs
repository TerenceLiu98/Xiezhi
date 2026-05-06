use crate::model::{WorkRun, WorkRunStatus};
use thiserror::Error;
use time::OffsetDateTime;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkRunTransition {
    pub from: WorkRunStatus,
    pub to: WorkRunStatus,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LifecycleError {
    #[error("cannot transition from terminal state {0:?}")]
    TerminalState(WorkRunStatus),
    #[error("invalid work run transition from {from:?} to {to:?}")]
    InvalidTransition {
        from: WorkRunStatus,
        to: WorkRunStatus,
    },
}

pub fn can_transition(from: WorkRunStatus, to: WorkRunStatus) -> bool {
    use WorkRunStatus::*;

    if from.is_terminal() {
        return false;
    }

    matches!(
        (from, to),
        (Created, WorkspaceReady)
            | (Created, Cancelled)
            | (WorkspaceReady, SupervisorIntake)
            | (WorkspaceReady, Failed)
            | (SupervisorIntake, WaitingForDecision)
            | (SupervisorIntake, Planning)
            | (SupervisorIntake, Failed)
            | (WaitingForDecision, Planning)
            | (WaitingForDecision, Cancelled)
            | (Planning, Executing)
            | (Planning, WaitingForDecision)
            | (Planning, Failed)
            | (Executing, Verifying)
            | (Executing, Recovering)
            | (Executing, Failed)
            | (Verifying, HumanAcceptance)
            | (Verifying, Recovering)
            | (Verifying, Failed)
            | (Recovering, Planning)
            | (Recovering, Executing)
            | (Recovering, WaitingForDecision)
            | (Recovering, Failed)
            | (HumanAcceptance, Completed)
            | (HumanAcceptance, Recovering)
            | (HumanAcceptance, Cancelled)
            | (Completed, Archived)
    )
}

pub fn transition_work_run(
    run: &mut WorkRun,
    to: WorkRunStatus,
) -> Result<WorkRunTransition, LifecycleError> {
    let from = run.status;
    if from.is_terminal() {
        return Err(LifecycleError::TerminalState(from));
    }
    if !can_transition(from, to) {
        return Err(LifecycleError::InvalidTransition { from, to });
    }

    run.status = to;
    run.updated_at = OffsetDateTime::now_utc();
    if matches!(
        to,
        WorkRunStatus::Completed | WorkRunStatus::Cancelled | WorkRunStatus::Failed
    ) {
        run.completed_at = Some(run.updated_at);
    }

    Ok(WorkRunTransition { from, to })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::WorkItem;

    #[test]
    fn follows_the_happy_path() {
        let item = WorkItem::local_goal("build a pomodoro app");
        let mut run = WorkRun::new(item.id, item.title);

        for status in [
            WorkRunStatus::WorkspaceReady,
            WorkRunStatus::SupervisorIntake,
            WorkRunStatus::Planning,
            WorkRunStatus::Executing,
            WorkRunStatus::Verifying,
            WorkRunStatus::HumanAcceptance,
            WorkRunStatus::Completed,
        ] {
            transition_work_run(&mut run, status).unwrap();
        }

        assert_eq!(run.status, WorkRunStatus::Completed);
        assert!(run.completed_at.is_some());
    }

    #[test]
    fn rejects_invalid_ordering() {
        let item = WorkItem::local_goal("build a pomodoro app");
        let mut run = WorkRun::new(item.id, item.title);

        let error = transition_work_run(&mut run, WorkRunStatus::Executing).unwrap_err();
        assert_eq!(
            error,
            LifecycleError::InvalidTransition {
                from: WorkRunStatus::Created,
                to: WorkRunStatus::Executing
            }
        );
    }

    #[test]
    fn terminal_runs_do_not_resume() {
        let item = WorkItem::local_goal("build a pomodoro app");
        let mut run = WorkRun::new(item.id, item.title);
        transition_work_run(&mut run, WorkRunStatus::Cancelled).unwrap();

        let error = transition_work_run(&mut run, WorkRunStatus::WorkspaceReady).unwrap_err();
        assert_eq!(
            error,
            LifecycleError::TerminalState(WorkRunStatus::Cancelled)
        );
    }
}
