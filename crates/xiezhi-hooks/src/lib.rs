use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use time::OffsetDateTime;

#[derive(Debug, Error)]
pub enum HookError {
    #[error("hook command could not be started: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HookOutput {
    pub name: String,
    pub command: String,
    pub cwd: PathBuf,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub started_at: OffsetDateTime,
    pub ended_at: OffsetDateTime,
}

impl HookOutput {
    pub fn success(&self) -> bool {
        self.exit_code == Some(0)
    }

    pub fn summary(&self) -> String {
        match self.exit_code {
            Some(0) => format!("Hook {} passed.", self.name),
            Some(code) => format!("Hook {} failed with exit code {}.", self.name, code),
            None => format!("Hook {} terminated without an exit code.", self.name),
        }
    }
}

pub struct HookRunner;

impl HookRunner {
    pub fn run(
        name: impl Into<String>,
        command: &str,
        cwd: impl AsRef<Path>,
    ) -> Result<HookOutput, HookError> {
        let name = name.into();
        let cwd = cwd.as_ref().to_path_buf();
        let started_at = OffsetDateTime::now_utc();
        let output = Command::new("sh")
            .arg("-c")
            .arg(command)
            .current_dir(&cwd)
            .output()?;
        let ended_at = OffsetDateTime::now_utc();

        Ok(HookOutput {
            name,
            command: command.to_string(),
            cwd,
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            started_at,
            ended_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_successful_hook() {
        let output = HookRunner::run("after_workspace_create", "printf hello", ".").unwrap();
        assert!(output.success());
        assert_eq!(output.stdout, "hello");
    }

    #[test]
    fn captures_failed_hook() {
        let output =
            HookRunner::run("after_workspace_create", "echo nope >&2; exit 7", ".").unwrap();
        assert!(!output.success());
        assert_eq!(output.exit_code, Some(7));
        assert!(output.stderr.contains("nope"));
    }
}
