//! Append-only JSON Lines journal of forward commands.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use speculum_core::{Command, Document, History};

use crate::error::StoreError;

/// One journal line. Forward edits carry `cmd`; undo/redo are markers
/// replayed through a [`History`]; full-document snapshots cover revert.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalLine {
    pub seq: u64,
    #[serde(rename = "atMs")]
    pub at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cmd: Option<Command>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redo: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_doc: Option<Document>,
}

impl JournalLine {
    pub fn cmd(seq: u64, at_ms: u64, cmd: Command) -> Self {
        Self {
            seq,
            at_ms,
            cmd: Some(cmd),
            undo: None,
            redo: None,
            full_doc: None,
        }
    }

    pub fn undo_marker(seq: u64, at_ms: u64) -> Self {
        Self {
            seq,
            at_ms,
            cmd: None,
            undo: Some(true),
            redo: None,
            full_doc: None,
        }
    }

    pub fn redo_marker(seq: u64, at_ms: u64) -> Self {
        Self {
            seq,
            at_ms,
            cmd: None,
            undo: None,
            redo: Some(true),
            full_doc: None,
        }
    }

    pub fn full_doc(seq: u64, at_ms: u64, doc: Document) -> Self {
        Self {
            seq,
            at_ms,
            cmd: None,
            undo: None,
            redo: None,
            full_doc: Some(doc),
        }
    }
}

/// Read all valid journal lines. A torn final line (crash mid-append:
/// invalid UTF-8 or truncated JSON) is ignored. Any other unparseable
/// line is also skipped so one bad line can never block recovery.
pub fn read_journal(path: &Path) -> Vec<JournalLine> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let reader = BufReader::new(file);
    let mut lines: Vec<Vec<u8>> = Vec::new();
    for chunk in reader.split(b'\n') {
        match chunk {
            Ok(bytes) => {
                // Strip a trailing \r for CRLF safety.
                let mut b = bytes;
                if b.last() == Some(&b'\r') {
                    b.pop();
                }
                if b.is_empty() {
                    continue;
                }
                lines.push(b);
            }
            Err(_) => break, // torn read -> stop, ignore tail
        }
    }
    let mut out = Vec::new();
    for raw in &lines {
        let s = match std::str::from_utf8(raw) {
            Ok(s) => s,
            Err(_) => continue, // torn bytes are ignored
        };
        match serde_json::from_str::<JournalLine>(s) {
            Ok(line) => out.push(line),
            Err(_) => {
                // Ignore torn/invalid lines (crash mid-append).
                continue;
            }
        }
    }
    out.sort_by_key(|l| l.seq);
    out
}

/// Append one line, flush, and `sync_data` so it survives a crash.
pub fn append_journal(path: &Path, line: &JournalLine) -> Result<(), StoreError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| StoreError::io(parent, e))?;
    }
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| StoreError::io(path, e))?;
    let mut s = serde_json::to_string(line)?;
    s.push('\n');
    f.write_all(s.as_bytes())
        .map_err(|e| StoreError::io(path, e))?;
    f.flush().map_err(|e| StoreError::io(path, e))?;
    f.sync_data().map_err(|e| StoreError::io(path, e))?;
    Ok(())
}

/// Atomically replace the journal with empty content.
pub fn truncate_journal(path: &Path) -> Result<(), StoreError> {
    crate::atomic::atomic_write(path, b"")
}

/// Replay journal lines on top of `base`, returning the recovered
/// document and the rebuilt history.
pub fn replay(base: Document, lines: &[JournalLine]) -> (Document, History) {
    let mut doc = base;
    let mut history = History::new();
    // Track highest seen seq implicitly by ordering; History merges may
    // collapse entries but the document result is identical.
    for line in lines {
        if let Some(full) = &line.full_doc {
            doc = full.clone();
            history = History::new();
            continue;
        }
        if line.undo == Some(true) {
            let _ = history.undo(&mut doc);
            continue;
        }
        if line.redo == Some(true) {
            let _ = history.redo(&mut doc);
            continue;
        }
        if let Some(cmd) = &line.cmd {
            // A command that no longer applies (e.g. merged typing state
            // vs. schema drift) is skipped rather than aborting recovery.
            let _ = history.dispatch(&mut doc, cmd.clone(), line.at_ms);
        }
    }
    (doc, history)
}

/// Max seq in the journal, for resuming the sequence counter.
pub fn max_seq(lines: &[JournalLine]) -> u64 {
    lines.iter().map(|l| l.seq).max().unwrap_or(0)
}

#[allow(dead_code)]
pub fn journal_path_buf(p: &Path) -> PathBuf {
    p.to_path_buf()
}
