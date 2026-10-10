//! Named (pinned) versions, separate from rolling snapshots.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use speculum_core::Document;

use crate::error::StoreError;
use crate::format::{from_bytes, to_bytes};
use crate::paths::{versions_dir_for, versions_index_for};
use crate::time::date_str;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub seq: u64,
    pub id: String,
    pub name: String,
    pub notes: String,
    #[serde(rename = "createdMs")]
    pub created_ms: u64,
    pub objects: usize,
    pub connections: usize,
    pub flows: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct IndexSettings {
    #[serde(default)]
    auto_version: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Index {
    #[serde(default)]
    versions: Vec<VersionInfo>,
    #[serde(default)]
    settings: IndexSettings,
    #[serde(default, rename = "lastAutoWeek")]
    last_auto_week: Option<String>,
    #[serde(default, rename = "nextSeq")]
    next_seq: u64,
}

impl Default for Index {
    fn default() -> Self {
        Self {
            versions: Vec::new(),
            settings: IndexSettings::default(),
            last_auto_week: None,
            next_seq: 1,
        }
    }
}

fn read_index(doc_path: &Path) -> Result<Index, StoreError> {
    let idx_path = versions_index_for(doc_path);
    match fs::read(&idx_path) {
        Ok(bytes) => {
            if bytes.is_empty() {
                return Ok(Index::default());
            }
            let idx: Index = serde_json::from_slice(&bytes)?;
            Ok(idx)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Index::default()),
        Err(e) => Err(StoreError::io(&idx_path, e)),
    }
}

fn write_index(doc_path: &Path, idx: &Index) -> Result<(), StoreError> {
    let idx_path = versions_index_for(doc_path);
    if let Some(parent) = idx_path.parent() {
        fs::create_dir_all(parent).map_err(|e| StoreError::io(parent, e))?;
    }
    let mut s = serde_json::to_string_pretty(idx)?;
    s.push('\n');
    crate::atomic::atomic_write(&idx_path, s.as_bytes())
}

pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    let mut s = trimmed;
    if s.is_empty() {
        s.push_str("version");
    }
    if s.len() > 48 {
        s.truncate(48);
        while s.ends_with('-') {
            s.pop();
        }
    }
    s
}

fn version_filename(seq: u64, name: &str) -> String {
    format!("{}-{}.speculum", seq, slugify(name))
}

fn counts(doc: &Document) -> (usize, usize, usize) {
    (
        doc.model.objects.len(),
        doc.model.connections.len(),
        doc.model.flows.len(),
    )
}

/// Create a named version of `doc`. Name and notes must be non-empty.
pub fn create_version(
    doc_path: &Path,
    doc: &Document,
    name: &str,
    notes: &str,
    now_ms: u64,
) -> Result<VersionInfo, StoreError> {
    if name.trim().is_empty() || notes.trim().is_empty() {
        return Err(StoreError::EmptyVersionField);
    }
    let dir = versions_dir_for(doc_path);
    fs::create_dir_all(&dir).map_err(|e| StoreError::io(&dir, e))?;
    let mut idx = read_index(doc_path)?;
    if idx.next_seq == 0 {
        idx.next_seq = 1;
    }
    let seq = idx.next_seq;
    idx.next_seq += 1;
    let (objects, connections, flows) = counts(doc);
    let info = VersionInfo {
        seq,
        id: format!("v{seq}"),
        name: name.to_string(),
        notes: notes.to_string(),
        created_ms: now_ms,
        objects,
        connections,
        flows,
    };
    let target = dir.join(version_filename(seq, name));
    crate::atomic::atomic_write(&target, &to_bytes(doc))?;
    idx.versions.push(info.clone());
    write_index(doc_path, &idx)?;
    Ok(info)
}

pub fn list_versions(doc_path: &Path) -> Result<Vec<VersionInfo>, StoreError> {
    let idx = read_index(doc_path)?;
    let mut v = idx.versions;
    v.sort_by_key(|e| e.seq);
    Ok(v)
}

fn find_version(doc_path: &Path, id: &str) -> Result<(Index, VersionInfo), StoreError> {
    let idx = read_index(doc_path)?;
    let found = idx.versions.iter().find(|v| v.id == id).cloned();
    match found {
        Some(v) => Ok((idx, v)),
        None => Err(StoreError::UnknownVersion(id.to_string())),
    }
}

/// Read-only copy of a named version.
pub fn open_version(doc_path: &Path, id: &str) -> Result<Document, StoreError> {
    let (_idx, info) = find_version(doc_path, id)?;
    let dir = versions_dir_for(doc_path);
    let target = dir.join(version_filename(info.seq, &info.name));
    let bytes = fs::read(&target).map_err(|e| StoreError::io(&target, e))?;
    from_bytes(&bytes)
}

/// Is weekly auto-versioning enabled?
pub fn auto_version_enabled(doc_path: &Path) -> Result<bool, StoreError> {
    Ok(read_index(doc_path)?.settings.auto_version)
}

/// Enable/disable weekly auto-versioning (stored in `versions/index.json`).
pub fn set_auto_version(doc_path: &Path, enabled: bool) -> Result<(), StoreError> {
    let mut idx = read_index(doc_path)?;
    idx.settings.auto_version = enabled;
    write_index(doc_path, &idx)
}

/// Create an `Auto <date>` version once per ISO week when enabled.
/// If `friday_only` is true, only create when the UTC weekday is Friday.
pub fn maybe_auto_version(
    doc_path: &Path,
    doc: &Document,
    now_ms: u64,
    friday_only: bool,
) -> Result<Option<VersionInfo>, StoreError> {
    let mut idx = read_index(doc_path)?;
    if !idx.settings.auto_version {
        return Ok(None);
    }
    if friday_only && crate::time::weekday_mon0(now_ms) != 4 {
        return Ok(None);
    }
    let week = crate::time::iso_week_key(now_ms);
    if idx.last_auto_week.as_deref() == Some(week.as_str()) {
        return Ok(None);
    }
    // Create the version inline so we can also stamp last_auto_week atomically.
    if idx.next_seq == 0 {
        idx.next_seq = 1;
    }
    let seq = idx.next_seq;
    idx.next_seq += 1;
    let name = format!("Auto {}", date_str(now_ms));
    let (objects, connections, flows) = counts(doc);
    let info = VersionInfo {
        seq,
        id: format!("v{seq}"),
        name: name.clone(),
        notes: "Weekly auto version".to_string(),
        created_ms: now_ms,
        objects,
        connections,
        flows,
    };
    let dir = versions_dir_for(doc_path);
    fs::create_dir_all(&dir).map_err(|e| StoreError::io(&dir, e))?;
    let target = dir.join(version_filename(seq, &name));
    crate::atomic::atomic_write(&target, &to_bytes(doc))?;
    idx.versions.push(info.clone());
    idx.last_auto_week = Some(week);
    write_index(doc_path, &idx)?;
    Ok(Some(info))
}

/// Record an already-written revert as a new version entry.
pub fn record_version_entry(
    doc_path: &Path,
    name: &str,
    notes: &str,
    doc: &Document,
    now_ms: u64,
) -> Result<VersionInfo, StoreError> {
    create_version(doc_path, doc, name, notes, now_ms)
}
