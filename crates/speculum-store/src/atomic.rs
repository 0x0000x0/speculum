//! Atomic file replacement with sharing-violation retries.

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::thread::sleep;
use std::time::Duration;

use crate::error::StoreError;

const BACKOFF_MS: [u64; 5] = [50, 100, 200, 400, 800];

fn is_lock_like(err: &std::io::Error) -> bool {
    err.kind() == std::io::ErrorKind::PermissionDenied
        // Windows sharing violations surface as PermissionDenied or
        // AlreadyExists/Uncategorized depending on the runtime; treat
        // WouldBlock/AlreadyExists on the rename path as lock-like too.
        || err.kind() == std::io::ErrorKind::AlreadyExists
        || err.kind() == std::io::ErrorKind::WouldBlock
}

/// Atomically replace `path` with `bytes`.
///
/// Writes `path.tmp-<pid>` in the SAME directory, `write_all`s, `sync_all`s,
/// renames over the target, then fsyncs the parent directory on unix.
/// The target is never opened with truncation, so a failed temp write
/// always leaves the old file intact.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let pid = std::process::id();
    let tmp_name = format!(
        "{}.tmp-{}",
        path.file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".to_string()),
        pid
    );
    let tmp_path = parent.join(tmp_name);

    // Retry the whole write+rename on lock-like errors.
    let mut attempt: usize = 0;
    loop {
        match write_once(&tmp_path, path, parent, bytes) {
            Ok(()) => return Ok(()),
            Err(e) => {
                let lock_like = match &e {
                    StoreError::Io { source, .. } => is_lock_like(source),
                    _ => false,
                };
                if lock_like && attempt < BACKOFF_MS.len() {
                    sleep(Duration::from_millis(BACKOFF_MS[attempt]));
                    attempt += 1;
                    continue;
                }
                if lock_like {
                    return Err(StoreError::Locked(path.to_path_buf()));
                }
                return Err(e);
            }
        }
    }
}

fn write_once(
    tmp_path: &Path,
    final_path: &Path,
    parent: &Path,
    bytes: &[u8],
) -> Result<(), StoreError> {
    // Create the temp file (truncate if a stale one from our pid exists).
    let mut f = File::create(tmp_path).map_err(|e| StoreError::io(tmp_path, e))?;
    if let Err(e) = f.write_all(bytes) {
        let _ = fs::remove_file(tmp_path);
        return Err(StoreError::io(tmp_path, e));
    }
    if let Err(e) = f.sync_all() {
        let _ = fs::remove_file(tmp_path);
        return Err(StoreError::io(tmp_path, e));
    }
    drop(f);
    // Rename over the target. On lock-like errors remove nothing (a stale
    // tmp file is harmless and retried); on other errors try to clean up.
    if let Err(e) = fs::rename(tmp_path, final_path) {
        if !is_lock_like(&e) {
            let _ = fs::remove_file(tmp_path);
        }
        return Err(StoreError::io(final_path, e));
    }
    // Fsync the parent directory so the rename itself is durable (unix).
    #[cfg(unix)]
    {
        match File::open(parent) {
            Ok(dir) => {
                let _ = dir.sync_all();
            }
            Err(e) => return Err(StoreError::io(parent, e)),
        }
    }
    Ok(())
}
