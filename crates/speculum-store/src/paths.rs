//! Paths for the hidden history directory next to a `.speculum` file.

use std::path::{Path, PathBuf};

/// `.X.speculum-history/` next to `X.speculum`.
pub fn history_dir_for(doc_path: &Path) -> PathBuf {
    let parent = doc_path.parent().unwrap_or_else(|| Path::new("."));
    let file = doc_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file.speculum".to_string());
    parent.join(format!(".{file}-history"))
}

pub fn snapshots_dir_for(doc_path: &Path) -> PathBuf {
    history_dir_for(doc_path).join("snapshots")
}

pub fn journal_path_for(doc_path: &Path) -> PathBuf {
    history_dir_for(doc_path).join("journal.log")
}

pub fn last_good_path_for(doc_path: &Path) -> PathBuf {
    history_dir_for(doc_path).join("last-good.speculum")
}

pub fn lock_path_for(doc_path: &Path) -> PathBuf {
    history_dir_for(doc_path).join("session.lock")
}

pub fn versions_dir_for(doc_path: &Path) -> PathBuf {
    history_dir_for(doc_path).join("versions")
}

pub fn versions_index_for(doc_path: &Path) -> PathBuf {
    versions_dir_for(doc_path).join("index.json")
}

/// Create the history dir layout (idempotent).
pub fn ensure_history_dirs(doc_path: &Path) -> Result<(), crate::error::StoreError> {
    for dir in [
        history_dir_for(doc_path),
        snapshots_dir_for(doc_path),
        versions_dir_for(doc_path),
    ] {
        std::fs::create_dir_all(&dir).map_err(|e| crate::error::StoreError::io(&dir, e))?;
    }
    Ok(())
}
