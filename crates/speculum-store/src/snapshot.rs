//! Rolling snapshots kept next to the file.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::StoreError;
use crate::paths::snapshots_dir_for;
use crate::time::snapshot_stamp;

pub const MAX_SNAPSHOTS: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotInfo {
    pub name: String,
    pub reason: String,
    pub created_ms: u64,
    pub bytes: u64,
}

/// Sanitize a reason for use in a filename.
pub fn sanitize_reason(reason: &str) -> String {
    let mut out = String::new();
    for ch in reason.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if ch == ' ' {
            out.push('-');
        }
    }
    if out.is_empty() {
        out.push_str("snapshot");
    }
    if out.len() > 48 {
        out.truncate(48);
    }
    out
}

/// Write `snapshots/<stamp>-<reason>.speculum`, enforce retention, and
/// return the file name. Collisions append `-<n>`.
pub fn take_snapshot(
    doc_path: &Path,
    bytes: &[u8],
    reason: &str,
    now_ms: u64,
) -> Result<String, StoreError> {
    let dir = snapshots_dir_for(doc_path);
    fs::create_dir_all(&dir).map_err(|e| StoreError::io(&dir, e))?;
    let stamp = snapshot_stamp(now_ms);
    let safe = sanitize_reason(reason);
    let mut name = format!("{stamp}-{safe}.speculum");
    let mut counter = 1u32;
    while dir.join(&name).exists() {
        counter += 1;
        name = format!("{stamp}-{safe}-{counter}.speculum");
    }
    let target = dir.join(&name);
    crate::atomic::atomic_write(&target, bytes)?;
    enforce_retention(doc_path)?;
    Ok(name)
}

/// Keep the 100 newest snapshots; never delete `-pinned` files.
pub fn enforce_retention(doc_path: &Path) -> Result<(), StoreError> {
    let dir = snapshots_dir_for(doc_path);
    let entries = match fs::read_dir(&dir) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(StoreError::io(&dir, e)),
    };
    let mut names: Vec<String> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| StoreError::io(&dir, e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".speculum") {
            names.push(name);
        }
    }
    names.sort();
    let deletable: Vec<String> = names
        .iter()
        .filter(|n| !n.contains("-pinned"))
        .cloned()
        .collect();
    if deletable.len() <= MAX_SNAPSHOTS {
        return Ok(());
    }
    let overflow = deletable.len() - MAX_SNAPSHOTS;
    for name in deletable.into_iter().take(overflow) {
        let p = dir.join(&name);
        match fs::remove_file(&p) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(StoreError::io(&p, e)),
        }
    }
    Ok(())
}

/// Newest-first listing.
pub fn list_snapshots(doc_path: &Path) -> Result<Vec<SnapshotInfo>, StoreError> {
    let dir = snapshots_dir_for(doc_path);
    let entries = match fs::read_dir(&dir) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(StoreError::io(&dir, e)),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| StoreError::io(&dir, e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".speculum") {
            continue;
        }
        // Reason is everything after the stamp prefix.
        let reason = reason_after_stamp(&name);
        let meta = entry.metadata().map_err(|e| {
            StoreError::io(&entry.path(), e)
        })?;
        out.push(SnapshotInfo {
            name: name.clone(),
            reason,
            created_ms: 0,
            bytes: meta.len(),
        });
    }
    out.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(out)
}

fn reason_after_stamp(name: &str) -> String {
    // `<YYYYMMDD-HHMMSS-mmm>-<reason>.speculum`
    let base = name.strip_suffix(".speculum").unwrap_or(name);
    // stamp is 8 + 1 + 6 + 1 + 3 = 19 chars
    if base.len() > 20 && base.as_bytes()[8] == b'-' {
        base[20..].to_string()
    } else {
        base.to_string()
    }
}

/// Mark a snapshot as pinned so retention never deletes it.
/// Renames `<name>` to `<stem>-pinned.speculum` (no-op if already pinned).
pub fn pin_snapshot(doc_path: &Path, name: &str) -> Result<String, StoreError> {
    let dir = snapshots_dir_for(doc_path);
    if name.contains("-pinned") {
        return Ok(name.to_string());
    }
    let src = dir.join(name);
    if !src.exists() {
        // Still return a pinned-style name error? Treat missing as IO.
        return Err(StoreError::Io {
            path: src,
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "snapshot not found"),
        });
    }
    let stem = name.strip_suffix(".speculum").unwrap_or(name);
    let new_name = format!("{stem}-pinned.speculum");
    let dst = dir.join(&new_name);
    fs::rename(&src, &dst).map_err(|e| StoreError::io(&src, e))?;
    Ok(new_name)
}
