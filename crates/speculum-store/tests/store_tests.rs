use speculum_core::{Command, Diagram, Document, Flow, FlowPath, FlowStep, Object, Rect};
use speculum_store::{OpenOutcome, Session, from_bytes, to_bytes};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

fn tmp_file(name: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join(name);
    (dir, path)
}

fn make_object(id: &str, name: &str) -> Object {
    Object {
        id: id.to_string(),
        name: name.to_string(),
        ..Default::default()
    }
}

fn dispatch_create(session: &mut Session, id: &str, name: &str, at: u64) {
    session
        .dispatch(
            Command::CreateObject {
                object: make_object(id, name),
            },
            at,
        )
        .expect("dispatch");
}

// 1. byte-identical save -> load -> save ------------------------------------

#[test]
fn byte_identical_save_load_save() {
    let (_dir, path) = tmp_file("doc.speculum");
    let mut s = Session::create(&path, "Byte Doc").expect("create");
    dispatch_create(&mut s, "obj-1", "Harbor Box", 1000);
    dispatch_create(&mut s, "obj-2", "Quarry Box", 1001);
    s.save_now().expect("save");
    let first = fs::read(&path).expect("read");
    drop(s);
    // Reopen clean and save again without changes.
    let outcome = Session::open(&path).expect("open");
    let mut s2 = match outcome {
        OpenOutcome::Clean(s) => s,
        OpenOutcome::NeedsRecovery(_, _) => panic!("expected clean open"),
    };
    s2.save_now().expect("save2");
    let second = fs::read(&path).expect("read2");
    assert_eq!(first, second, "save->load->save must be byte-identical");
    s2.close().expect("close");
}

// 2. sorted keys ------------------------------------------------------------

#[test]
fn map_keys_are_sorted() {
    let mut doc = Document::new("Sort Doc".to_string());
    for id in ["zebra-1", "apple-2", "mango-3"] {
        doc.model
            .objects
            .insert(id.to_string(), make_object(id, "n"));
    }
    let bytes = to_bytes(&doc);
    let text = String::from_utf8(bytes).expect("utf8");
    let pa = text.find("apple-2").expect("apple");
    let pm = text.find("mango-3").expect("mango");
    let pz = text.find("zebra-1").expect("zebra");
    assert!(pa < pm && pm < pz, "object keys must be sorted");
}

// 3. LF endings + trailing newline ------------------------------------------

#[test]
fn format_uses_lf_and_trailing_newline() {
    let doc = Document::new("LF Doc".to_string());
    let bytes = to_bytes(&doc);
    assert!(bytes.ends_with(b"\n"), "must end with newline");
    assert!(
        !bytes.windows(2).any(|w| w == b"\r\n"),
        "no CRLF allowed"
    );
    assert!(
        !String::from_utf8_lossy(&bytes).contains('\r'),
        "no CR allowed"
    );
    // Pretty (multi-line, 2-space indent).
    let text = String::from_utf8(bytes).unwrap();
    assert!(text.contains('\n'));
    assert!(text.contains("  \"meta\"") || text.contains("  \"schema\""));
}

// 4. atomic write failure leaves old file intact -----------------------------

#[test]
fn atomic_write_failure_keeps_old_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("keep.speculum");
    fs::write(&target, b"OLD-CONTENT").expect("write old");
    // Block the temp path by creating a directory where the tmp file goes.
    let pid = std::process::id();
    let tmp_path = dir.path().join(format!("keep.speculum.tmp-{pid}"));
    fs::create_dir(&tmp_path).expect("block tmp with dir");
    let res = speculum_store::atomic_write(&target, b"NEW-CONTENT");
    assert!(res.is_err(), "blocked tmp write must fail");
    let kept = fs::read(&target).expect("read target");
    assert_eq!(kept, b"OLD-CONTENT");
    fs::remove_dir(&tmp_path).expect("cleanup blocker");
}

// 5. torn journal line ignored -----------------------------------------------

#[test]
fn torn_journal_line_is_ignored() {
    let (_dir, path) = tmp_file("torn.speculum");
    let mut s = Session::create(&path, "Torn Doc").expect("create");
    dispatch_create(&mut s, "obj-1", "First Box", 1000);
    // Append a torn (truncated, no newline) line directly.
    let journal = speculum_store::session::history_dir(&path).join("journal.log");
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&journal)
            .expect("open journal");
        f.write_all(b"{\"seq\":999,\"atMs\":1001,\"cmd\":{\"op\":\"crea")
            .expect("torn write");
        f.sync_data().expect("sync");
    }
    // Drop without close => crash.
    drop(s);
    let outcome = Session::open(&path).expect("reopen");
    match outcome {
        OpenOutcome::NeedsRecovery(info, pending) => {
            assert_eq!(info.pending_commands, 1, "torn line must be ignored");
            let doc = pending.preview();
            assert!(doc.model.objects.contains_key("obj-1"));
            let live = pending.restore().expect("restore");
            assert!(live.doc().model.objects.contains_key("obj-1"));
            live.close().expect("close");
        }
        OpenOutcome::Clean(_) => panic!("expected recovery"),
    }
}

// 6. crash simulation: 5 edits, restore --------------------------------------

#[test]
fn crash_restore_replays_five_edits() {
    let (_dir, path) = tmp_file("crash.speculum");
    let mut s = Session::create(&path, "Crash Doc").expect("create");
    for i in 1..=5 {
        dispatch_create(
            &mut s,
            &format!("obj-{i}"),
            &format!("Made Box {i}"),
            1000 + i as u64,
        );
    }
    drop(s); // crash: no close, no save
    let outcome = Session::open(&path).expect("reopen");
    match outcome {
        OpenOutcome::NeedsRecovery(info, pending) => {
            assert_eq!(info.pending_commands, 5);
            let live = pending.restore().expect("restore");
            assert_eq!(live.doc().model.objects.len(), 5);
            live.close().expect("close");
        }
        OpenOutcome::Clean(_) => panic!("expected NeedsRecovery"),
    }
}

// 7. crash simulation: discard keeps saved state + snapshot ------------------

#[test]
fn crash_discard_keeps_saved_state_and_snapshots() {
    let (_dir, path) = tmp_file("discard.speculum");
    let mut s = Session::create(&path, "Discard Doc").expect("create");
    for i in 1..=5 {
        dispatch_create(&mut s, &format!("obj-{i}"), &format!("Made Box {i}"), 2000 + i as u64);
    }
    drop(s);
    let outcome = Session::open(&path).expect("reopen");
    match outcome {
        OpenOutcome::NeedsRecovery(_, pending) => {
            let live = pending.discard().expect("discard");
            assert_eq!(
                live.doc().model.objects.len(),
                0,
                "discard returns the saved (empty) state"
            );
            let snaps = live.list_snapshots().expect("snaps");
            assert!(
                snaps.iter().any(|sn| sn.name.contains("discarded-recovery")),
                "a discarded-recovery snapshot must exist, got: {:?}",
                snaps.iter().map(|sn| &sn.name).collect::<Vec<_>>()
            );
            live.close().expect("close");
        }
        OpenOutcome::Clean(_) => panic!("expected NeedsRecovery"),
    }
}

// 8. restore snapshots pre-recovery ------------------------------------------

#[test]
fn restore_takes_pre_recovery_snapshot() {
    let (_dir, path) = tmp_file("prerec.speculum");
    let mut s = Session::create(&path, "PreRec").expect("create");
    dispatch_create(&mut s, "obj-1", "Box One", 1000);
    drop(s);
    let outcome = Session::open(&path).expect("reopen");
    match outcome {
        OpenOutcome::NeedsRecovery(_, pending) => {
            let live = pending.restore().expect("restore");
            let snaps = live.list_snapshots().expect("snaps");
            assert!(
                snaps.iter().any(|sn| sn.name.contains("pre-recovery")),
                "pre-recovery snapshot must exist"
            );
            live.close().expect("close");
        }
        OpenOutcome::Clean(_) => panic!("expected recovery"),
    }
}

// 9. corrupted main falls back to last-good -----------------------------------

#[test]
fn corrupted_main_falls_back_to_last_good() {
    let (_dir, path) = tmp_file("fallback.speculum");
    let mut s = Session::create(&path, "Fallback").expect("create");
    dispatch_create(&mut s, "obj-1", "Good Box", 1000);
    s.save_now().expect("save");
    s.close().expect("close");
    // Corrupt the main file only.
    fs::write(&path, b"{{{{ not json").expect("corrupt");
    let outcome = Session::open(&path).expect("open with corrupt main");
    match outcome {
        OpenOutcome::Clean(live) => {
            assert!(
                live.doc().model.objects.contains_key("obj-1"),
                "must fall back to last-good copy"
            );
            live.close().expect("close");
        }
        OpenOutcome::NeedsRecovery(info, pending) => {
            assert!(!info.file_ok, "file_ok must be false on fallback");
            let doc = pending.preview();
            assert!(doc.model.objects.contains_key("obj-1"));
            let live = pending.restore().expect("restore");
            live.close().expect("close");
        }
    }
}

#[test]
fn corrupted_main_with_pending_journal_reports_file_not_ok() {
    let (_dir, path) = tmp_file("fallback2.speculum");
    let mut s = Session::create(&path, "Fallback2").expect("create");
    s.save_now().expect("save");
    dispatch_create(&mut s, "obj-9", "Pending Box", 5000);
    drop(s); // crash with 1 pending
    fs::write(&path, b"garbage{{{").expect("corrupt");
    let outcome = Session::open(&path).expect("open");
    match outcome {
        OpenOutcome::NeedsRecovery(info, pending) => {
            assert!(!info.file_ok);
            assert_eq!(info.pending_commands, 1);
            let doc = pending.preview();
            assert!(doc.model.objects.contains_key("obj-9"));
            let live = pending.restore().expect("restore");
            live.close().expect("close");
        }
        OpenOutcome::Clean(_) => panic!("expected NeedsRecovery"),
    }
}

// 10. autosave timing --------------------------------------------------------

#[test]
fn autosave_timing_499_vs_500() {
    let (_dir, path) = tmp_file("auto.speculum");
    let mut s = Session::create(&path, "Auto").expect("create");
    dispatch_create(&mut s, "obj-1", "Timed Box", 1000);
    let r1 = s.tick(1499).expect("tick1");
    assert!(r1.is_none(), "499ms must not save");
    assert!(s.is_dirty());
    let r2 = s.tick(1500).expect("tick2");
    assert!(r2.is_some(), "500ms must save");
    assert!(!s.is_dirty());
    // File now contains the object.
    let bytes = fs::read(&path).expect("read");
    let doc = from_bytes(&bytes).expect("parse");
    assert!(doc.model.objects.contains_key("obj-1"));
    s.close().expect("close");
}

// 11. snapshot retention with pinned ------------------------------------------

#[test]
fn snapshot_retention_keeps_100_and_pinned() {
    let (_dir, path) = tmp_file("retain.speculum");
    let s = Session::create(&path, "Retain").expect("create");
    let base_ms: u64 = 1_700_000_000_000;
    let mut oldest: Option<String> = None;
    for i in 0..50u64 {
        let name = s
            .snapshot_at("auto", base_ms + i * 1000)
            .expect("snapshot");
        if i == 0 {
            oldest = Some(name);
        }
    }
    let oldest = oldest.unwrap();
    let pinned = s.pin_snapshot(&oldest).expect("pin");
    assert!(pinned.contains("-pinned"));
    for i in 50..115u64 {
        s.snapshot_at("auto", base_ms + i * 1000).expect("snapshot");
    }
    let snaps = s.list_snapshots().expect("list");
    assert!(
        snaps.iter().any(|sn| sn.name == pinned),
        "pinned snapshot must survive retention"
    );
    let unpinned = snaps.iter().filter(|sn| !sn.name.contains("-pinned")).count();
    assert!(
        unpinned <= 100,
        "at most 100 unpinned snapshots, got {unpinned}"
    );
    s.close().expect("close");
}

// 12. flows + diagrams survive save/load/recovery -----------------------------

fn rich_doc() -> Document {
    let mut doc = Document::new("Rich".to_string());
    doc.model
        .objects
        .insert("sys-1".to_string(), make_object("sys-1", "Harbor System"));
    let mut child = make_object("app-1", "Quarry App");
    child.parent_id = Some("sys-1".to_string());
    doc.model.objects.insert("app-1".to_string(), child);
    // Diagram with boxes.
    let mut boxes = BTreeMap::new();
    boxes.insert(
        "sys-1".to_string(),
        Rect {
            x: 10.0,
            y: 20.0,
            w: 100.0,
            h: 80.0,
        },
    );
    boxes.insert(
        "app-1".to_string(),
        Rect {
            x: 30.0,
            y: 40.0,
            w: 60.0,
            h: 40.0,
        },
    );
    let mut diagrams = BTreeMap::new();
    diagrams.insert(
        "dia-1".to_string(),
        Diagram {
            id: "dia-1".to_string(),
            name: "Main Page".to_string(),
            boxes,
            ..Default::default()
        },
    );
    doc.diagrams = diagrams;
    // Flow with nested paths.
    let nested = FlowStep {
        id: "step-2".to_string(),
        title: "Nested".to_string(),
        ..Default::default()
    };
    let top = FlowStep {
        id: "step-1".to_string(),
        title: "Top".to_string(),
        paths: vec![FlowPath {
            id: "path-1".to_string(),
            name: "Branch".to_string(),
            steps: vec![nested],
            ..Default::default()
        }],
        ..Default::default()
    };
    let mut flows = BTreeMap::new();
    flows.insert(
        "flow-1".to_string(),
        Flow {
            id: "flow-1".to_string(),
            name: "Checkout Story".to_string(),
            steps: vec![top],
            ..Default::default()
        },
    );
    doc.model.flows = flows;
    doc
}

#[test]
fn flows_and_diagrams_survive_save_load() {
    let (_dir, path) = tmp_file("rich.speculum");
    let doc = rich_doc();
    fs::write(&path, to_bytes(&doc)).expect("seed");
    // Seed last-good + lock via open-after-create dance: use create then overwrite.
    let s = Session::create(&path, "x").expect("create");
    s.close().expect("close");
    fs::write(&path, to_bytes(&doc)).expect("seed2");
    // Ensure last-good matches too by opening/saving.
    let outcome = Session::open(&path).expect("open");
    let mut live = match outcome {
        OpenOutcome::Clean(s) => s,
        OpenOutcome::NeedsRecovery(_, p) => p.restore().expect("restore"),
    };
    live.save_now().expect("save");
    let reloaded = from_bytes(&fs::read(&path).expect("read")).expect("parse");
    assert_eq!(reloaded, doc);
    live.close().expect("close");
    // Second save must be byte-identical.
    let a = fs::read(&path).expect("a");
    let outcome = Session::open(&path).expect("open2");
    let mut s2 = match outcome {
        OpenOutcome::Clean(s) => s,
        OpenOutcome::NeedsRecovery(_, _) => panic!("clean expected"),
    };
    s2.save_now().expect("save2");
    let b = fs::read(&path).expect("b");
    assert_eq!(a, b);
    s2.close().expect("close");
}

#[test]
fn flows_and_diagrams_survive_recovery_exactly() {
    let (_dir, path) = tmp_file("richrec.speculum");
    let mut s = Session::create(&path, "RichRec").expect("create");
    // Build richness through commands so the journal holds them.
    s.dispatch(
        Command::CreateObject {
            object: make_object("sys-1", "Harbor System"),
        },
        1000,
    )
    .expect("d1");
    let mut child = make_object("app-1", "Quarry App");
    child.parent_id = Some("sys-1".to_string());
    s.dispatch(Command::CreateObject { object: child }, 1001)
        .expect("d2");
    let mut boxes = BTreeMap::new();
    boxes.insert(
        "sys-1".to_string(),
        Rect {
            x: 1.0,
            y: 2.0,
            w: 3.0,
            h: 4.0,
        },
    );
    s.dispatch(
        Command::CreateDiagram {
            diagram: Diagram {
                id: "dia-1".to_string(),
                name: "Main".to_string(),
                boxes,
                ..Default::default()
            },
        },
        1002,
    )
    .expect("d3");
    s.dispatch(
        Command::CreateFlow {
            flow: Flow {
                id: "flow-1".to_string(),
                name: "Story".to_string(),
                steps: vec![FlowStep {
                    id: "step-1".to_string(),
                    title: "Top".to_string(),
                    paths: vec![FlowPath {
                        id: "path-1".to_string(),
                        name: "Branch".to_string(),
                        steps: vec![FlowStep {
                            id: "step-2".to_string(),
                            title: "Nested".to_string(),
                            ..Default::default()
                        }],
                        ..Default::default()
                    }],
                    ..Default::default()
                }],
                ..Default::default()
            },
        },
        1003,
    )
    .expect("d4");
    let expected = s.doc().clone();
    drop(s); // crash before save
    let outcome = Session::open(&path).expect("reopen");
    match outcome {
        OpenOutcome::NeedsRecovery(_, pending) => {
            let recovered = pending.preview();
            assert_eq!(recovered, expected, "preview must equal pre-crash doc");
            // Nested path step survived.
            let flow = recovered.model.flows.get("flow-1").expect("flow");
            assert_eq!(flow.steps.len(), 1);
            assert_eq!(flow.steps[0].paths.len(), 1);
            assert_eq!(flow.steps[0].paths[0].steps.len(), 1);
            let live = pending.restore().expect("restore");
            assert_eq!(live.doc(), &expected);
            live.close().expect("close");
        }
        OpenOutcome::Clean(_) => panic!("expected recovery"),
    }
}

// 13. undo/redo journaled and replayed -----------------------------------------

#[test]
fn undo_redo_markers_replay_correctly() {
    let (_dir, path) = tmp_file("undoredo.speculum");
    let mut s = Session::create(&path, "UndoRedo").expect("create");
    // Use far-apart timestamps to avoid History typing-merge.
    dispatch_create(&mut s, "obj-1", "Box One", 1000);
    dispatch_create(&mut s, "obj-2", "Box Two", 5000);
    assert!(s.undo(9000).expect("undo"));
    assert!(!s.doc().model.objects.contains_key("obj-2"));
    assert!(s.redo(13000).expect("redo"));
    assert!(s.doc().model.objects.contains_key("obj-2"));
    let expected = s.doc().clone();
    drop(s); // crash with cmd,cmd,undo,redo in journal
    let outcome = Session::open(&path).expect("reopen");
    match outcome {
        OpenOutcome::NeedsRecovery(info, pending) => {
            assert_eq!(info.pending_commands, 4);
            let recovered = pending.preview();
            assert_eq!(recovered, expected);
            let live = pending.restore().expect("restore");
            assert_eq!(live.doc(), &expected);
            live.close().expect("close");
        }
        OpenOutcome::Clean(_) => panic!("expected recovery"),
    }
}

#[test]
fn undo_only_replays_to_one_object() {
    let (_dir, path) = tmp_file("undoonly.speculum");
    let mut s = Session::create(&path, "UndoOnly").expect("create");
    dispatch_create(&mut s, "obj-1", "Box One", 1000);
    dispatch_create(&mut s, "obj-2", "Box Two", 5000);
    assert!(s.undo(9000).expect("undo"));
    drop(s);
    let outcome = Session::open(&path).expect("reopen");
    match outcome {
        OpenOutcome::NeedsRecovery(_, pending) => {
            let recovered = pending.preview();
            assert!(recovered.model.objects.contains_key("obj-1"));
            assert!(!recovered.model.objects.contains_key("obj-2"));
            let live = pending.restore().expect("restore");
            live.close().expect("close");
        }
        OpenOutcome::Clean(_) => panic!("expected recovery"),
    }
}

// 14. unsupported schema --------------------------------------------------------

#[test]
fn unsupported_schema_errors() {
    let doc = Document::new("Schema".to_string());
    let mut value = serde_json::to_value(&doc).expect("value");
    value["schema"] = serde_json::json!(999);
    let bytes = serde_json::to_vec_pretty(&value).expect("vec");
    match from_bytes(&bytes) {
        Err(speculum_store::StoreError::UnsupportedSchema { found }) => {
            assert_eq!(found, 999);
        }
        other => panic!("expected UnsupportedSchema, got {:?}", other.is_ok()),
    }
}

// 15. versions round-trip --------------------------------------------------------

#[test]
fn version_create_list_open_revert_round_trip() {
    let (_dir, path) = tmp_file("versions.speculum");
    let mut s = Session::create(&path, "Versions").expect("create");
    dispatch_create(&mut s, "obj-1", "Box One", 1000);
    s.save_now().expect("save");
    let v1 = s
        .create_version_at("First draft", "Initial notes", 2000)
        .expect("v1");
    assert_eq!(v1.name, "First draft");
    dispatch_create(&mut s, "obj-2", "Box Two", 3000);
    s.save_now().expect("save2");
    let v2 = s
        .create_version_at("Second draft", "More notes", 4000)
        .expect("v2");
    let list = s.list_versions().expect("list");
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, v1.id);
    assert_eq!(list[1].id, v2.id);
    assert_eq!(list[0].objects, 1);
    assert_eq!(list[1].objects, 2);
    // Open is a read-only copy.
    let opened = s.open_version(&v1.id).expect("open v1");
    assert_eq!(opened.model.objects.len(), 1);
    // Revert to v1.
    s.revert_to_version_at(&v1.id, "going back", 5000)
        .expect("revert");
    assert_eq!(s.doc().model.objects.len(), 1);
    assert!(s.is_dirty());
    let list2 = s.list_versions().expect("list2");
    assert_eq!(list2.len(), 3);
    assert_eq!(list2[2].name, "Revert to First draft");
    // Crash-safe: drop without saving, reopen, restore keeps reverted state.
    drop(s);
    let outcome = Session::open(&path).expect("reopen");
    match outcome {
        OpenOutcome::NeedsRecovery(_, pending) => {
            let recovered = pending.preview();
            assert_eq!(recovered.model.objects.len(), 1);
            assert!(recovered.model.objects.contains_key("obj-1"));
            let live = pending.restore().expect("restore");
            assert_eq!(live.doc().model.objects.len(), 1);
            live.close().expect("close");
        }
        OpenOutcome::Clean(_) => panic!("expected recovery after revert crash"),
    }
}

#[test]
fn version_requires_name_and_notes() {
    let (_dir, path) = tmp_file("vervalid.speculum");
    let s = Session::create(&path, "VerValid").expect("create");
    assert!(s.create_version_at("", "notes", 1000).is_err());
    assert!(s.create_version_at("name", "", 1000).is_err());
    assert!(s.create_version_at("  ", "notes", 1000).is_err());
    s.close().expect("close");
}

// 16. snapshots list + close removes lock ---------------------------------------

#[test]
fn close_removes_lock_and_reopens_clean() {
    let (_dir, path) = tmp_file("locklife.speculum");
    let mut s = Session::create(&path, "LockLife").expect("create");
    dispatch_create(&mut s, "obj-1", "Box", 1000);
    s.save_now().expect("save");
    s.close().expect("close");
    let lock = speculum_store::session::history_dir(&path).join("session.lock");
    assert!(!lock.exists(), "close must remove session.lock");
    match Session::open(&path).expect("reopen") {
        OpenOutcome::Clean(live) => {
            assert!(live.doc().model.objects.contains_key("obj-1"));
            live.close().expect("close2");
        }
        OpenOutcome::NeedsRecovery(_, _) => panic!("expected clean after close"),
    }
}

#[test]
fn create_saves_immediately_with_last_good() {
    let (_dir, path) = tmp_file("created.speculum");
    let s = Session::create(&path, "Created Now").expect("create");
    assert!(!s.is_dirty());
    assert!(path.exists());
    let last_good =
        speculum_store::session::history_dir(&path).join("last-good.speculum");
    assert!(last_good.exists());
    let a = fs::read(&path).expect("a");
    let b = fs::read(&last_good).expect("b");
    assert_eq!(a, b);
    s.close().expect("close");
}

// 17. weekly auto-version --------------------------------------------------------

#[test]
fn weekly_auto_version_once_per_iso_week() {
    let (_dir, path) = tmp_file("autover.speculum");
    let s = Session::create(&path, "AutoVer").expect("create");
    s.set_auto_version(true).expect("enable");
    // A Friday in January 2026: 2026-01-02 is a Friday.
    // 2026-01-01T00:00:00Z = 1767225600; +1 day => Friday.
    let friday_ms: u64 = 1_767_225_600_000 + 86_400_000;
    assert_eq!(speculum_store::time::weekday_mon0(friday_ms), 4);
    let v1 = s
        .maybe_auto_version(friday_ms, true)
        .expect("auto1");
    assert!(v1.is_some(), "first Friday auto-version should create");
    let v2 = s
        .maybe_auto_version(friday_ms + 3_600_000, true)
        .expect("auto2");
    assert!(v2.is_none(), "same ISO week must not duplicate");
    // Next week creates again.
    let v3 = s
        .maybe_auto_version(friday_ms + 7 * 86_400_000, true)
        .expect("auto3");
    assert!(v3.is_some(), "new ISO week should create");
    // friday_only blocks non-Fridays.
    let monday_ms = friday_ms + 3 * 86_400_000;
    let v4 = s.maybe_auto_version(monday_ms, true).expect("auto4");
    assert!(v4.is_none(), "friday_only must skip Monday");
    // Disabled flag blocks everything.
    s.set_auto_version(false).expect("disable");
    let v5 = s
        .maybe_auto_version(friday_ms + 14 * 86_400_000, false)
        .expect("auto5");
    assert!(v5.is_none());
    s.close().expect("close");
}

// 18. pending_count helper + no-crash clean open ----------------------------------

#[test]
fn clean_open_after_close_has_no_pending() {
    let (_dir, path) = tmp_file("cleanopen.speculum");
    let mut s = Session::create(&path, "CleanOpen").expect("create");
    dispatch_create(&mut s, "obj-1", "Box", 1000);
    s.save_now().expect("save");
    s.close().expect("close");
    assert_eq!(speculum_store::pending_count(&path), 0);
    match Session::open(&path).expect("open") {
        OpenOutcome::Clean(live) => {
            assert_eq!(live.doc().model.objects.len(), 1);
            live.close().expect("close");
        }
        OpenOutcome::NeedsRecovery(_, _) => panic!("expected clean"),
    }
}

fn _path_helper(_p: &Path) {
    let _ = PathBuf::new();
}

#[test]
fn relative_bare_filename_create_and_open() {
    let dir = tempfile::tempdir().unwrap();
    let prev = std::env::current_dir().unwrap();
    std::env::set_current_dir(dir.path()).unwrap();
    let res = speculum_store::Session::create(std::path::Path::new("bare.speculum"), "Bare");
    let reopened = speculum_store::Session::open(std::path::Path::new("bare.speculum"));
    std::env::set_current_dir(prev).unwrap();
    assert!(res.is_ok(), "create with bare relative filename failed: {:?}", res.err());
    assert!(reopened.is_ok());
}

#[test]
fn nonstop_editing_still_saves_every_5s() {
    use speculum_core::Command;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("busy.speculum");
    let mut s = speculum_store::Session::create(&path, "Busy").unwrap();
    let t0 = s.last_save_ms();
    let mut saved = false;
    // an edit every 100 ms for 6 s: the 500 ms debounce never elapses
    for i in 0..60u64 {
        let now = t0 + 100 * (i + 1);
        let obj: speculum_core::Object = serde_json::from_value(serde_json::json!({
            "id": format!("busy-{i}"), "name": format!("Busy Box {i}"), "type": "app"
        })).unwrap();
        s.dispatch(Command::CreateObject { object: obj }, now).unwrap();
        if let Some(r) = s.tick(now).unwrap() { if r.saved { saved = true; } }
    }
    assert!(saved, "autosave never fired during continuous editing");
}
