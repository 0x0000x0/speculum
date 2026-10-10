use speculum_core::{Command, Diagram, Object, ObjectPatch, Rect};
use speculum_store::{OpenOutcome, Session};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn usage() -> ! {
    eprintln!(
        "Usage:\n\
         \x20 speculum new <file> [--name N]\n\
         \x20 speculum info <file>\n\
         \x20 speculum version <file> --name N --notes T\n\
         \x20 speculum stress-edit <file> --edits N [--autosave]\n\
         \x20 speculum recover <file> --restore|--discard\n\
         \x20 speculum validate <file>"
    );
    std::process::exit(2);
}

fn flag_value(args: &[String], flag: &str) -> Option<String> {
    let mut iter = args.iter().peekable();
    while let Some(a) = iter.next() {
        if a == flag {
            return iter.next().cloned();
        }
        if let Some(rest) = a.strip_prefix(&format!("{flag}=")) {
            return Some(rest.to_string());
        }
    }
    None
}

fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|a| a == flag)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("speculum 0.1.0");
        return;
    }
    if args.len() < 2 {
        usage();
    }
    let cmd = args[1].as_str();
    let rest = &args[2..];
    let code = match cmd {
        "new" => cmd_new(rest),
        "info" => cmd_info(rest),
        "version" => cmd_version(rest),
        "stress-edit" => cmd_stress_edit(rest),
        "recover" => cmd_recover(rest),
        "validate" => cmd_validate(rest),
        _ => usage(),
    };
    std::process::exit(code);
}

fn cmd_new(rest: &[String]) -> i32 {
    if rest.is_empty() {
        usage();
    }
    let file = PathBuf::from(&rest[0]);
    let name = flag_value(rest, "--name").unwrap_or_else(|| {
        file.file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Untitled".to_string())
    });
    match Session::create(&file, &name) {
        Ok(s) => {
            if let Err(e) = s.close() {
                eprintln!("new: close failed: {e}");
                return 1;
            }
            println!("created {}", file.display());
            0
        }
        Err(e) => {
            eprintln!("new: {e}");
            1
        }
    }
}

fn cmd_info(rest: &[String]) -> i32 {
    if rest.is_empty() {
        usage();
    }
    let file = Path::new(&rest[0]);
    // Counts from the file if parseable, else from last-good.
    let outcome = Session::open(file);
    match outcome {
        Ok(OpenOutcome::Clean(s)) => {
            print_info(file, &s, false);
            let _ = s.close();
            // Re-lock? close() removed the lock that open() created. For a
            // read-only info command we must not leave a stale lock behind,
            // but we also must not delete a pre-existing lock. open() always
            // writes a fresh lock; close() removes it. Since info is read-only
            // and the file was clean (no prior lock... actually there may have
            // been none), close() is correct. If there HAD been a lock with no
            // journal, open() overwrote it — acceptable for a CLI tool.
            0
        }
        Ok(OpenOutcome::NeedsRecovery(info, pending)) => {
            let doc = pending.preview();
            let versions = speculum_store::list_versions(file).unwrap_or_default();
            println!("file: {}", file.display());
            println!("objects: {}", doc.model.objects.len());
            println!("connections: {}", doc.model.connections.len());
            println!("tags: {}", doc.model.tags.len());
            println!("diagrams: {}", doc.diagrams.len());
            println!("flows: {}", doc.model.flows.len());
            println!("versions: {}", versions.len());
            println!("recovery pending: yes ({})", info.pending_commands);
            println!("file ok: {}", if info.file_ok { "yes" } else { "no" });
            // Do NOT consume the pending session: leave lock+journal alone.
            0
        }
        Err(e) => {
            eprintln!("info: {e}");
            1
        }
    }
}

fn print_info(file: &Path, s: &Session, pending: bool) {
    let c = s.counts();
    let versions = speculum_store::list_versions(file).unwrap_or_default();
    println!("file: {}", file.display());
    println!("objects: {}", c.objects);
    println!("connections: {}", c.connections);
    println!("tags: {}", c.tags);
    println!("diagrams: {}", c.diagrams);
    println!("flows: {}", c.flows);
    println!("versions: {}", versions.len());
    println!(
        "recovery pending: {}",
        if pending { "yes" } else { "no" }
    );
}

fn cmd_version(rest: &[String]) -> i32 {
    if rest.is_empty() {
        usage();
    }
    let file = PathBuf::from(&rest[0]);
    let name = flag_value(rest, "--name").unwrap_or_default();
    let notes = flag_value(rest, "--notes").unwrap_or_default();
    if name.trim().is_empty() || notes.trim().is_empty() {
        eprintln!("version: --name and --notes must both be non-empty");
        return 2;
    }
    match Session::open(&file) {
        Ok(OpenOutcome::Clean(s)) => {
            match s.create_version(&name, &notes) {
                Ok(info) => {
                    println!("version {} \"{}\"", info.id, info.name);
                    let _ = s.close();
                    0
                }
                Err(e) => {
                    eprintln!("version: {e}");
                    1
                }
            }
        }
        Ok(OpenOutcome::NeedsRecovery(_, _)) => {
            eprintln!("version: file needs recovery first (run recover)");
            1
        }
        Err(e) => {
            eprintln!("version: {e}");
            1
        }
    }
}

fn cmd_stress_edit(rest: &[String]) -> i32 {
    if rest.is_empty() {
        usage();
    }
    let file = PathBuf::from(&rest[0]);
    let edits: usize = flag_value(rest, "--edits")
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| usage());
    let autosave = has_flag(rest, "--autosave");

    // Open or create.
    let mut session = if file.exists() {
        match Session::open(&file) {
            Ok(OpenOutcome::Clean(s)) => s,
            Ok(OpenOutcome::NeedsRecovery(_, pending)) => match pending.restore() {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("stress-edit: restore failed: {e}");
                    return 1;
                }
            },
            Err(e) => {
                eprintln!("stress-edit: open failed: {e}");
                return 1;
            }
        }
    } else {
        let name = file
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Stress".to_string());
        match Session::create(&file, &name) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("stress-edit: create failed: {e}");
                return 1;
            }
        }
    };

    // Ensure at least one diagram exists for MoveBoxes variety.
    let now0 = speculum_store::time::now_ms();
    if session.doc().diagrams.is_empty() {
        let mut boxes = BTreeMap::new();
        boxes.insert(
            "stress-seed".to_string(),
            Rect {
                x: 0.0,
                y: 0.0,
                w: 10.0,
                h: 10.0,
            },
        );
        // Seed object first so the diagram validates.
        let _ = session.dispatch(
            Command::CreateObject {
                object: Object {
                    id: "stress-seed".to_string(),
                    name: "Stress Seed".to_string(),
                    ..Default::default()
                },
            },
            now0,
        );
        let _ = session.dispatch(
            Command::CreateDiagram {
                diagram: Diagram {
                    id: "dia-stress".to_string(),
                    name: "Stress Page".to_string(),
                    boxes,
                    ..Default::default()
                },
            },
            now0,
        );
    }

    let mut now = speculum_store::time::now_ms();
    for i in 0..edits {
        now = now.wrapping_add(1);
        let id = format!("stress-{i:06}");
        // Cycle through Create / Rename / MoveBoxes for variety.
        let cmd = match i % 3 {
            0 => Command::CreateObject {
                object: Object {
                    id: id.clone(),
                    name: format!("Stress Box {i}"),
                    ..Default::default()
                },
            },
            1 => {
                let target = format!("stress-{:06}", i.saturating_sub(1));
                Command::PatchObject {
                    id: target,
                    patch: ObjectPatch {
                        name: Some(format!("Renamed Stress Box {i}")),
                        ..Default::default()
                    },
                }
            }
            _ => {
                let mut moves = BTreeMap::new();
                moves.insert(
                    "stress-seed".to_string(),
                    Rect {
                        x: i as f64,
                        y: (i % 100) as f64,
                        w: 10.0,
                        h: 10.0,
                    },
                );
                Command::MoveBoxes {
                    diagram_id: "dia-stress".to_string(),
                    moves,
                }
            }
        };
        // Some commands may fail to apply late in the run (e.g. patch of a
        // missing id if the matching create was skipped); skip failures so
        // the loop keeps hammering the journal.
        let _ = session.dispatch(cmd, now);
        if autosave {
            // Tick with the same clock; ignore save errors (e.g. locked).
            let _ = session.tick(now);
            now = now.wrapping_add(1);
        }
    }
    // Intentionally do NOT close: stress-edit is usually SIGKILLed. But if we
    // finish all edits, save + close cleanly.
    if let Err(e) = session.save_now() {
        eprintln!("stress-edit: final save failed: {e}");
        return 1;
    }
    match session.close() {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("stress-edit: close failed: {e}");
            1
        }
    }
}

fn cmd_recover(rest: &[String]) -> i32 {
    if rest.is_empty() {
        usage();
    }
    let file = PathBuf::from(&rest[0]);
    let restore = has_flag(rest, "--restore");
    let discard = has_flag(rest, "--discard");
    if restore == discard {
        eprintln!("recover: specify exactly one of --restore|--discard");
        return 2;
    }
    match Session::open(&file) {
        Ok(OpenOutcome::Clean(s)) => {
            println!("nothing to recover");
            let _ = s.close();
            0
        }
        Ok(OpenOutcome::NeedsRecovery(info, pending)) => {
            println!("pending commands: {}", info.pending_commands);
            let res = if restore {
                pending.restore().map(|s| {
                    let n = s.doc().model.objects.len();
                    let _ = s.close();
                    println!("restored ({n} objects)");
                })
            } else {
                pending.discard().map(|s| {
                    let n = s.doc().model.objects.len();
                    let _ = s.close();
                    println!("discarded to saved state ({n} objects)");
                })
            };
            match res {
                Ok(()) => 0,
                Err(e) => {
                    eprintln!("recover: {e}");
                    1
                }
            }
        }
        Err(e) => {
            eprintln!("recover: {e}");
            1
        }
    }
}

fn cmd_validate(rest: &[String]) -> i32 {
    if rest.is_empty() {
        usage();
    }
    let file = Path::new(&rest[0]);
    let bytes = match std::fs::read(file) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("validate: cannot read {}: {e}", file.display());
            return 1;
        }
    };
    let doc = match speculum_store::from_bytes(&bytes) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("validate: parse failed: {e}");
            return 1;
        }
    };
    let issues = speculum_core::validate_document(&doc);
    let errors = issues
        .iter()
        .filter(|i| i.severity == speculum_core::validate::Severity::Error)
        .count();
    let warnings = issues.len() - errors;
    for issue in &issues {
        let level = match issue.severity {
            speculum_core::validate::Severity::Error => "error",
            _ => "warning",
        };
        println!("{level} {}: {}", issue.code, issue.message);
    }
    println!("{errors} error(s), {warnings} warning(s)");
    if errors > 0 {
        1
    } else {
        0
    }
}
