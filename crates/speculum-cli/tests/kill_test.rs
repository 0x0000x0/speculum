//! SIGKILL crash-safety test: kill `speculum stress-edit` mid-run and
//! verify the file always parses, validates, and recovers forward.

#![cfg(unix)]

use speculum_core::validate::Severity;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread::sleep;
use std::time::Duration;

fn speculum_bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_speculum"))
}

fn saved_object_count(file: &std::path::Path) -> usize {
    let bytes = std::fs::read(file).expect("read .speculum");
    let doc: speculum_core::Document =
        serde_json::from_slice(&bytes).expect("saved file must parse");
    doc.model.objects.len()
}

#[test]
fn kill_mid_edit_recovers_without_corruption() {
    let bin = speculum_bin();
    // Deterministic "random-ish" delays, 30..600 ms.
    let delays_ms: [u64; 10] = [30, 75, 110, 160, 210, 260, 330, 410, 500, 600];

    for (round, delay) in delays_ms.iter().enumerate() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join(format!("kill-{round}.speculum"));

        let mut child = Command::new(&bin)
            .arg("stress-edit")
            .arg(&file)
            .arg("--edits")
            .arg("100000")
            .arg("--autosave")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn stress-edit");

        sleep(Duration::from_millis(*delay));
        // SIGKILL via std.
        child.kill().expect("kill child");
        let _ = child.wait();

        // 1. The .speculum file must parse.
        let bytes = std::fs::read(&file)
            .unwrap_or_else(|_| panic!("round {round}: .speculum file must exist after kill"));
        let doc: speculum_core::Document = serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| panic!("round {round}: .speculum must parse after kill"));

        // 2. validate() has no Error issues.
        let issues = speculum_core::validate_document(&doc);
        let errors: Vec<_> = issues
            .iter()
            .filter(|i| i.severity == Severity::Error)
            .collect();
        assert!(
            errors.is_empty(),
            "round {round}: validate errors after kill: {errors:?}"
        );

        // 3. Session::open must return NeedsRecovery or Clean.
        let saved_count = saved_object_count(&file);
        match speculum_store::Session::open(&file).expect("open must not error") {
            speculum_store::OpenOutcome::Clean(s) => {
                // Clean is fine (killed before first journal entry or after a
                // save+truncate). Closing must keep things clean.
                s.close().expect("close");
            }
            speculum_store::OpenOutcome::NeedsRecovery(info, pending) => {
                assert!(
                    info.pending_commands >= 1,
                    "round {round}: NeedsRecovery must report >= 1 pending"
                );
                // 4. restore() must produce >= saved object count.
                let live = pending.restore().expect("restore");
                let restored = live.doc().model.objects.len();
                assert!(
                    restored >= saved_count,
                    "round {round}: restored {restored} < saved {saved_count}"
                );
                live.close().expect("close");
            }
        }
    }
}
