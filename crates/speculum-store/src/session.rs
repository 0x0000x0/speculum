//! `Session`: open/create, dispatch, journal, autosave, recovery, versions.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use speculum_core::{Command, Document, History};

use crate::error::StoreError;
use crate::format::{from_bytes, to_bytes};
use crate::journal::{self, JournalLine};
use crate::paths::{
    ensure_history_dirs, history_dir_for, journal_path_for, last_good_path_for, lock_path_for,
};
use crate::time::now_ms;

pub const AUTOSAVE_DELAY_MS: u64 = 500;
pub const AUTOSAVE_MAX_WAIT_MS: u64 = 5_000;
pub const SNAPSHOT_INTERVAL_MS: u64 = 10 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveResult {
    pub saved: bool,
    pub snapshotted: bool,
    #[serde(default, rename = "savedMs")]
    pub saved_ms: u64,
}

#[derive(Debug, Clone)]
pub struct Counts {
    pub objects: usize,
    pub connections: usize,
    pub tags: usize,
    pub diagrams: usize,
    pub flows: usize,
}

pub fn counts_of(doc: &Document) -> Counts {
    Counts {
        objects: doc.model.objects.len(),
        connections: doc.model.connections.len(),
        tags: doc.model.tags.len(),
        diagrams: doc.diagrams.len(),
        flows: doc.model.flows.len(),
    }
}

/// Live editing session. The `session.lock` file exists while a session
/// is open; dropping without [`Session::close`] simulates a crash and
/// leaves the journal behind for recovery.
pub struct Session {
    path: PathBuf,
    doc: Document,
    history: History,
    dirty: bool,
    last_change_ms: u64,
    last_save_ms: u64,
    last_snapshot_ms: u64,
    next_seq: u64,
    rev: u64,
}

impl Session {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn doc(&self) -> &Document {
        &self.doc
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn last_change_ms(&self) -> u64 {
        self.last_change_ms
    }

    pub fn last_save_ms(&self) -> u64 {
        self.last_save_ms
    }

    pub fn counts(&self) -> Counts {
        counts_of(&self.doc)
    }

    /// Revision counter: increments on every applied change (dispatch,
    /// undo, redo, revert) so UI clients know when to refetch.
    pub fn rev(&self) -> u64 {
        self.rev
    }

    /// Create a new empty document and save it immediately.
    pub fn create(path: &Path, name: &str) -> Result<Session, StoreError> {
        let abs = absolute_path(path);
        let path = abs.as_path();
        ensure_history_dirs(path)?;
        let now = now_ms();
        let doc = Document::new(name.to_string());
        let bytes = to_bytes(&doc);
        crate::atomic::atomic_write(path, &bytes)?;
        let last_good = last_good_path_for(path);
        crate::atomic::atomic_write(&last_good, &bytes)?;
        crate::journal::truncate_journal(&journal_path_for(path))?;
        write_lock(path)?;
        Ok(Session {
            path: path.to_path_buf(),
            doc,
            history: History::new(),
            dirty: false,
            last_change_ms: now,
            last_save_ms: now,
            last_snapshot_ms: now,
            next_seq: 1,
            rev: 0,
        })
    }

    /// Open an existing file. Returns `NeedsRecovery` when a crash is
    /// detected (lock file exists AND the journal has >= 1 valid entry).
    /// If the main file fails to parse, falls back to `last-good.speculum`.
    pub fn open(path: &Path) -> Result<OpenOutcome, StoreError> {
        let abs = absolute_path(path);
        let path = abs.as_path();
        ensure_history_dirs(path)?;
        // Load base document with last-good fallback.
        let raw_main = fs::read(path);
        let main_missing = raw_main.is_err();
        let main_err = raw_main.as_ref().err().map(|e| e.kind());
        let mut file_ok = true;
        let mut base: Option<Document> = None;
        if let Ok(bytes) = raw_main.as_ref() {
            match from_bytes(bytes) {
                Ok(doc) => base = Some(doc),
                Err(StoreError::UnsupportedSchema { .. }) => {
                    return Err(StoreError::UnsupportedSchema {
                        found: schema_guess(bytes),
                    });
                }
                Err(_) => {
                    file_ok = false;
                }
            }
        } else {
            // Missing main file: try last-good before erroring.
            file_ok = false;
        }
        if base.is_none() {
            let last_good = last_good_path_for(path);
            match fs::read(&last_good) {
                Ok(bytes) if !bytes.is_empty() => match from_bytes(&bytes) {
                    Ok(doc) => {
                        base = Some(doc);
                    }
                    Err(StoreError::UnsupportedSchema { .. }) => {
                        return Err(StoreError::UnsupportedSchema {
                            found: schema_guess(&bytes),
                        });
                    }
                    Err(e) => {
                        if main_missing {
                            return Err(StoreError::NoReadableCopy(path.to_path_buf()));
                        }
                        return Err(e);
                    }
                },
                _ => {
                    if main_missing {
                        let kind = main_err.unwrap_or(std::io::ErrorKind::NotFound);
                        return Err(StoreError::io(
                            path,
                            std::io::Error::new(kind, "not found"),
                        ));
                    }
                    // Main exists but is corrupt and no last-good: no copy.
                    return Err(StoreError::NoReadableCopy(path.to_path_buf()));
                }
            }
        }
        let base = base.expect("base resolved");
        let journal_path = journal_path_for(path);
        let lines = journal::read_journal(&journal_path);
        let pending = lines.len();
        let lock_path = lock_path_for(path);
        let lock_exists = lock_path.exists();
        let lock_was_stale = if lock_exists {
            match read_lock(&lock_path) {
                Some((pid, _)) => !pid_alive(pid),
                None => true,
            }
        } else {
            false
        };

        if lock_exists && pending >= 1 {
            let info = RecoveryInfo {
                pending_commands: pending,
                lock_was_stale,
                file_ok,
            };
            let pending_session = PendingSession {
                path: path.to_path_buf(),
                base,
                lines,
                file_ok,
                lock_was_stale,
            };
            return Ok(OpenOutcome::NeedsRecovery(info, pending_session));
        }

        // Clean open: truncate any stray empty/corrupt journal tail, take
        // ownership with a fresh lock.
        if pending > 0 {
            // Stray journal without a lock (e.g. killed between save and
            // truncate): replay it silently so no edit is lost? The spec ties
            // recovery to lock+journal, but silently dropping edits is worse.
            // Since there is no lock, a previous close() must have removed it,
            // which only happens after a successful save+truncate — so any
            // lines here are from a torn save. Truncate and continue clean.
            let _ = journal::truncate_journal(&journal_path);
        }
        write_lock(path)?;
        let next_seq = journal::max_seq(&lines) + 1;
        let now = now_ms();
        let mut session = Session {
            path: path.to_path_buf(),
            doc: base,
            history: History::new(),
            dirty: false,
            last_change_ms: now,
            last_save_ms: now,
            last_snapshot_ms: now,
            next_seq: if next_seq == 0 { 1 } else { next_seq },
            rev: 0,
        };
        // One-off M5 migration: old files may box a diagram's own scope
        // object. Remove such boxes as a normal undoable (journaled)
        // command so nothing is silently lost.
        repair_scope_boxes(&mut session, now);
        Ok(OpenOutcome::Clean(session))
    }

    fn append_line(&mut self, line: &JournalLine) -> Result<(), StoreError> {
        journal::append_journal(&journal_path_for(&self.path), line)?;
        self.next_seq = self.next_seq.max(line.seq + 1);
        Ok(())
    }

    /// Apply a command, append it to the journal, mark dirty.
    pub fn dispatch(&mut self, cmd: Command, now_ms_value: u64) -> Result<(), StoreError> {
        let snapshot = cmd.clone();
        self.history.dispatch(&mut self.doc, cmd, now_ms_value)?;
        let line = JournalLine::cmd(self.next_seq, now_ms_value, snapshot);
        self.append_line(&line)?;
        self.dirty = true;
        self.last_change_ms = now_ms_value;
        self.rev += 1;
        Ok(())
    }

    /// Undo through history and journal the marker so replay matches.
    pub fn undo(&mut self, now_ms_value: u64) -> Result<bool, StoreError> {
        if self.history.undo(&mut self.doc)? {
            let line = JournalLine::undo_marker(self.next_seq, now_ms_value);
            self.append_line(&line)?;
            self.dirty = true;
            self.last_change_ms = now_ms_value;
            self.rev += 1;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Redo through history and journal the marker.
    pub fn redo(&mut self, now_ms_value: u64) -> Result<bool, StoreError> {
        if self.history.redo(&mut self.doc)? {
            let line = JournalLine::redo_marker(self.next_seq, now_ms_value);
            self.append_line(&line)?;
            self.dirty = true;
            self.last_change_ms = now_ms_value;
            self.rev += 1;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Autosave when dirty and `now - last_change >= 500ms`; rolling
    /// snapshot every 10 minutes while changed.
    pub fn tick(&mut self, now_ms_value: u64) -> Result<Option<SaveResult>, StoreError> {
        let mut snapshotted = false;
        if now_ms_value.saturating_sub(self.last_snapshot_ms) >= SNAPSHOT_INTERVAL_MS
            && (self.dirty || now_ms_value.saturating_sub(self.last_change_ms) < SNAPSHOT_INTERVAL_MS)
            && self.dirty
        {
            let bytes = to_bytes(&self.doc);
            crate::snapshot::take_snapshot(&self.path, &bytes, "auto", now_ms_value)?;
            self.last_snapshot_ms = now_ms_value;
            snapshotted = true;
        }
        // Debounced save 500 ms after the last change, but never let nonstop
        // editing starve the save: force one at least every AUTOSAVE_MAX_WAIT_MS.
        if self.dirty
            && (now_ms_value.saturating_sub(self.last_change_ms) >= AUTOSAVE_DELAY_MS
                || now_ms_value.saturating_sub(self.last_save_ms) >= AUTOSAVE_MAX_WAIT_MS)
        {
            let mut r = self.save_now_at(now_ms_value)?;
            r.snapshotted = snapshotted;
            Ok(Some(r))
        } else if snapshotted {
            Ok(Some(SaveResult {
                saved: false,
                snapshotted: true,
                saved_ms: self.last_save_ms,
            }))
        } else {
            Ok(None)
        }
    }

    /// Write the file now: atomic replace, truncate journal, update last-good.
    pub fn save_now(&mut self) -> Result<SaveResult, StoreError> {
        let now = now_ms();
        self.save_now_at(now)
    }

    fn save_now_at(&mut self, now_ms_value: u64) -> Result<SaveResult, StoreError> {
        let bytes = to_bytes(&self.doc);
        crate::atomic::atomic_write(&self.path, &bytes)?;
        let last_good = last_good_path_for(&self.path);
        crate::atomic::atomic_write(&last_good, &bytes)?;
        journal::truncate_journal(&journal_path_for(&self.path))?;
        self.next_seq = 1;
        self.dirty = false;
        self.last_save_ms = now_ms_value;
        Ok(SaveResult {
            saved: true,
            snapshotted: false,
            saved_ms: now_ms_value,
        })
    }

    /// Save, snapshot for the record, and remove the lock. Consumes the
    /// session so a second close cannot happen.
    pub fn close(mut self) -> Result<(), StoreError> {
        if self.dirty {
            let bytes = to_bytes(&self.doc);
            let _ =
                crate::snapshot::take_snapshot(&self.path, &bytes, "close", now_ms());
            self.save_now()?;
        } else {
            // Still snapshot on close per spec ("and on close")? Only when
            // there is something worth keeping: snapshot if the file changed
            // since the last snapshot. To keep close cheap and retention
            // bounded, snapshot on close only when dirty. Clean closes just
            // remove the lock.
        }
        let lock = lock_path_for(&self.path);
        match fs::remove_file(&lock) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(StoreError::io(&lock, e)),
        }
    }

    /// Write a rolling snapshot of the current state.
    pub fn snapshot(&self, reason: &str) -> Result<String, StoreError> {
        crate::snapshot::take_snapshot(&self.path, &to_bytes(&self.doc), reason, now_ms())
    }

    pub fn snapshot_at(&self, reason: &str, now_ms_value: u64) -> Result<String, StoreError> {
        crate::snapshot::take_snapshot(&self.path, &to_bytes(&self.doc), reason, now_ms_value)
    }

    pub fn list_snapshots(&self) -> Result<Vec<crate::snapshot::SnapshotInfo>, StoreError> {
        crate::snapshot::list_snapshots(&self.path)
    }

    pub fn pin_snapshot(&self, name: &str) -> Result<String, StoreError> {
        crate::snapshot::pin_snapshot(&self.path, name)
    }

    // -- named versions ----------------------------------------------------

    pub fn create_version(
        &self,
        name: &str,
        notes: &str,
    ) -> Result<crate::versions::VersionInfo, StoreError> {
        crate::versions::create_version(&self.path, &self.doc, name, notes, now_ms())
    }

    pub fn create_version_at(
        &self,
        name: &str,
        notes: &str,
        now_ms_value: u64,
    ) -> Result<crate::versions::VersionInfo, StoreError> {
        crate::versions::create_version(&self.path, &self.doc, name, notes, now_ms_value)
    }

    pub fn list_versions(&self) -> Result<Vec<crate::versions::VersionInfo>, StoreError> {
        crate::versions::list_versions(&self.path)
    }

    pub fn open_version(&self, id: &str) -> Result<Document, StoreError> {
        crate::versions::open_version(&self.path, id)
    }

    /// Replace the working doc with a named version. Snapshots the current
    /// state first (`pre-revert`), records the revert as a new version
    /// `Revert to <name>`, and journals the full doc so a crash right after
    /// still recovers to the reverted state.
    pub fn revert_to_version(&mut self, id: &str, note: &str) -> Result<(), StoreError> {
        let now = now_ms();
        self.revert_to_version_at(id, note, now)
    }

    pub fn revert_to_version_at(
        &mut self,
        id: &str,
        note: &str,
        now_ms_value: u64,
    ) -> Result<(), StoreError> {
        let versions = crate::versions::list_versions(&self.path)?;
        let target = versions
            .iter()
            .find(|v| v.id == id)
            .cloned()
            .ok_or_else(|| StoreError::UnknownVersion(id.to_string()))?;
        // Snapshot current state first.
        let bytes = to_bytes(&self.doc);
        crate::snapshot::take_snapshot(&self.path, &bytes, "pre-revert", now_ms_value)?;
        // Load the version (read-only copy).
        let doc = crate::versions::open_version(&self.path, id)?;
        self.doc = doc.clone();
        self.history = History::new();
        // Journal the full doc so it survives a crash before the next save.
        let line = JournalLine::full_doc(self.next_seq, now_ms_value, doc.clone());
        self.append_line(&line)?;
        self.dirty = true;
        self.last_change_ms = now_ms_value;
        self.rev += 1;
        // Record the revert as a new named version.
        let revert_name = format!("Revert to {}", target.name);
        let notes = if note.trim().is_empty() {
            format!("Reverted to {}", target.name)
        } else {
            note.to_string()
        };
        crate::versions::create_version(&self.path, &self.doc, &revert_name, &notes, now_ms_value)?;
        Ok(())
    }

    /// Weekly auto-version hook. See `versions::maybe_auto_version`.
    pub fn maybe_auto_version(
        &self,
        now_ms_value: u64,
        friday_only: bool,
    ) -> Result<Option<crate::versions::VersionInfo>, StoreError> {
        crate::versions::maybe_auto_version(&self.path, &self.doc, now_ms_value, friday_only)
    }

    pub fn set_auto_version(&self, enabled: bool) -> Result<(), StoreError> {
        crate::versions::set_auto_version(&self.path, enabled)
    }
}

/// Outcome of [`Session::open`].
pub enum OpenOutcome {
    Clean(Session),
    NeedsRecovery(RecoveryInfo, PendingSession),
}

#[derive(Debug, Clone)]
pub struct RecoveryInfo {
    pub pending_commands: usize,
    pub lock_was_stale: bool,
    pub file_ok: bool,
}

/// Unresolved crash state. Holds the on-disk base plus journal lines until
/// the user picks restore or discard.
pub struct PendingSession {
    path: PathBuf,
    base: Document,
    lines: Vec<JournalLine>,
    file_ok: bool,
    lock_was_stale: bool,
}

impl PendingSession {
    pub fn pending_commands(&self) -> usize {
        self.lines.len()
    }

    pub fn file_ok(&self) -> bool {
        self.file_ok
    }

    pub fn lock_was_stale(&self) -> bool {
        self.lock_was_stale
    }

    /// The recovered document (journal replayed on top of the file).
    pub fn preview(&self) -> Document {
        journal::replay(self.base.clone(), &self.lines).0
    }

    fn next_seq(&self) -> u64 {
        journal::max_seq(&self.lines) + 1
    }

    fn write_session_lock(&self) -> Result<(), StoreError> {
        write_lock(&self.path)
    }

    /// Replay the journal, snapshot the pre-recovery base, save, and
    /// return a live session.
    pub fn restore(self) -> Result<Session, StoreError> {
        let now = now_ms();
        // Snapshot the pre-recovery file state first.
        let base_bytes = to_bytes(&self.base);
        crate::snapshot::take_snapshot(&self.path, &base_bytes, "pre-recovery", now)?;
        let (doc, history) = journal::replay(self.base.clone(), &self.lines);
        self.write_session_lock()?;
        let mut session = Session {
            path: self.path.clone(),
            doc,
            history,
            dirty: true,
            last_change_ms: now,
            last_save_ms: now,
            last_snapshot_ms: now,
            next_seq: self.next_seq(),
            rev: 0,
        };
        // Same one-off M5 migration as a clean open (undoable, journaled).
        repair_scope_boxes(&mut session, now);
        session.save_now_at(now)?;
        Ok(session)
    }

    /// Keep the saved (on-disk) state, but snapshot the journal-applied
    /// document first as `discarded-recovery` so nothing is ever lost.
    pub fn discard(self) -> Result<Session, StoreError> {
        let now = now_ms();
        let (recovered, _) = journal::replay(self.base.clone(), &self.lines);
        let rec_bytes = to_bytes(&recovered);
        crate::snapshot::take_snapshot(&self.path, &rec_bytes, "discarded-recovery", now)?;
        self.write_session_lock()?;
        let next_seq = self.next_seq();
        let mut session = Session {
            path: self.path.clone(),
            doc: self.base,
            history: History::new(),
            dirty: false,
            last_change_ms: now,
            last_save_ms: now,
            last_snapshot_ms: now,
            next_seq,
            rev: 0,
        };
        // Truncate the journal: the user chose the saved state.
        journal::truncate_journal(&journal_path_for(&session.path))?;
        session.next_seq = 1;
        // Persist (no-op if already clean, but refreshes last-good).
        session.save_now_at(now)?;
        Ok(session)
    }
}

// -- locks -----------------------------------------------------------------

/// One-off M5 migration shared by `open` and `restore`: drop scope objects
/// boxed on their own diagram via a normal undoable (journaled) Batch, and
/// log what was removed to stderr.
fn repair_scope_boxes(session: &mut Session, now_ms_value: u64) {
    let cmds = speculum_core::scope_box_removal_commands(session.doc());
    if cmds.is_empty() {
        return;
    }
    // RemoveFromDiagram validates the box is present; re-check under the
    // live doc to avoid a spurious failure.
    let present: Vec<Command> = cmds
        .into_iter()
        .filter(|c| match c {
            Command::RemoveFromDiagram {
                diagram_id,
                object_id,
            } => session
                .doc()
                .diagrams
                .get(diagram_id)
                .map(|d| d.boxes.contains_key(object_id))
                .unwrap_or(false),
            _ => true,
        })
        .collect();
    if present.is_empty() {
        return;
    }
    let n = present.len();
    match session.dispatch(Command::Batch { commands: present }, now_ms_value) {
        Ok(()) => {
            eprintln!("speculum: removed {n} scope object box(es) from their own diagram(s) (M5 migration, undoable)");
        }
        Err(e) => {
            eprintln!("speculum: scope-box migration failed: {e}");
        }
    }
}

fn write_lock(doc_path: &Path) -> Result<(), StoreError> {
    let lock = lock_path_for(doc_path);
    if let Some(parent) = lock.parent() {
        fs::create_dir_all(parent).map_err(|e| StoreError::io(parent, e))?;
    }
    let pid = std::process::id();
    let content = format!("{pid} {}\n", now_ms());
    crate::atomic::atomic_write(&lock, content.as_bytes())
}

fn read_lock(lock: &Path) -> Option<(u32, u64)> {
    let s = fs::read_to_string(lock).ok()?;
    let mut parts = s.split_whitespace();
    let pid: u32 = parts.next()?.parse().ok()?;
    let started: u64 = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Some((pid, started))
}

#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    if pid == std::process::id() {
        return true;
    }
    // `kill(pid, 0)` probes existence without signalling.
    unsafe { libc_kill_probe(pid) }
}

#[cfg(unix)]
unsafe fn libc_kill_probe(pid: u32) -> bool {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    let r = kill(pid as i32, 0);
    if r == 0 {
        return true;
    }
    // Read errno portably (glibc's `__errno_location` does not exist on macOS).
    // EPERM (1 on Linux and macOS) means the process exists but we cannot signal it.
    std::io::Error::last_os_error().raw_os_error() == Some(1)
}

#[cfg(not(unix))]
fn pid_alive(pid: u32) -> bool {
    // Without a portable probe, treat our own pid as alive and any other
    // lock as stale so recovery can always proceed.
    pid == std::process::id()
}

fn schema_guess(bytes: &[u8]) -> u32 {
    #[derive(Deserialize)]
    struct JustSchema {
        #[serde(default)]
        schema: u32,
    }
    serde_json::from_slice::<JustSchema>(bytes)
        .map(|j| j.schema)
        .unwrap_or(0)
}

/// History directory for a document path (public helper for CLI/UI).
pub fn history_dir(path: &Path) -> PathBuf {
    history_dir_for(path)
}

/// Pending journal entry count without opening a session.
pub fn pending_count(path: &Path) -> usize {
    journal::read_journal(&journal_path_for(path)).len()
}

/// Make a path absolute so its parent directory is never empty (a bare
/// `file.speculum` has parent "" which cannot be fsynced).
fn absolute_path(path: &Path) -> std::path::PathBuf {
    std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
}
