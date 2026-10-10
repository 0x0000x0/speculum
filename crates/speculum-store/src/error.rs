use std::path::PathBuf;
use thiserror::Error;

/// Errors from the store layer.
#[derive(Debug, Error)]
pub enum StoreError {
    /// Underlying I/O failure.
    #[error("io error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    /// JSON (de)serialization failure.
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    /// File declares an unsupported schema version.
    #[error("unsupported schema {found}, expected 1")]
    UnsupportedSchema { found: u32 },
    /// Target file is locked / sharing violation after retries.
    #[error("file is locked: {0}")]
    Locked(PathBuf),
    /// A core command failed to apply.
    #[error("command failed: {0}")]
    Core(#[from] speculum_core::CoreError),
    /// Named versions require a non-empty name and notes.
    #[error("version name and notes must both be non-empty")]
    EmptyVersionField,
    /// No usable copy exists (main file and last-good both unreadable).
    #[error("no readable document at {0}")]
    NoReadableCopy(PathBuf),
    /// Unknown version id.
    #[error("unknown version: {0}")]
    UnknownVersion(String),
}

impl StoreError {
    pub(crate) fn io(path: &std::path::Path, source: std::io::Error) -> Self {
        StoreError::Io {
            path: path.to_path_buf(),
            source,
        }
    }
}
