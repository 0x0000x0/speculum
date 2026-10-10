#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use speculum_core::{Command, Document};
use speculum_store::{OpenOutcome, PendingSession, Session};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct StoreState {
    live: Arc<Mutex<Option<Session>>>,
    pending: Arc<Mutex<Option<PendingSession>>>,
}

impl Default for StoreState {
    fn default() -> Self {
        Self {
            live: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(None)),
        }
    }
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CountsDto {
    objects: usize,
    connections: usize,
    tags: usize,
    diagrams: usize,
    flows: usize,
}

fn counts_of(doc: &Document) -> CountsDto {
    CountsDto {
        objects: doc.model.objects.len(),
        connections: doc.model.connections.len(),
        tags: doc.model.tags.len(),
        diagrams: doc.diagrams.len(),
        flows: doc.model.flows.len(),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryDto {
    pending_commands: usize,
    file_ok: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupDto {
    path: String,
    status: String,
    recovery: Option<RecoveryDto>,
    counts: CountsDto,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StateDto {
    name: String,
    counts: CountsDto,
    dirty: bool,
    last_saved_ms: u64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn resolve_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(env_path) = std::env::var("SPECULUM_FILE") {
        if !env_path.trim().is_empty() {
            return Ok(PathBuf::from(env_path));
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create app data dir: {e}"))?;
    Ok(dir.join("Default.speculum"))
}

fn doc_name_for(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Untitled".to_string())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn startup(app: tauri::AppHandle) -> Result<StartupDto, String> {
    let path = resolve_path(&app)?;
    let state = app.state::<StoreState>();

    if !path.exists() {
        let session =
            Session::create(&path, &doc_name_for(&path)).map_err(|e| e.to_string())?;
        let dto = StartupDto {
            path: path.to_string_lossy().into_owned(),
            status: "clean".to_string(),
            recovery: None,
            counts: counts_of(session.doc()),
        };
        *state.live.lock().map_err(|e| format!("state lock: {e}"))? = Some(session);
        *state
            .pending
            .lock()
            .map_err(|e| format!("state lock: {e}"))? = None;
        return Ok(dto);
    }

    match Session::open(&path).map_err(|e| e.to_string())? {
        OpenOutcome::Clean(session) => {
            let dto = StartupDto {
                path: path.to_string_lossy().into_owned(),
                status: "clean".to_string(),
                recovery: None,
                counts: counts_of(session.doc()),
            };
            *state.live.lock().map_err(|e| format!("state lock: {e}"))? = Some(session);
            *state
                .pending
                .lock()
                .map_err(|e| format!("state lock: {e}"))? = None;
            Ok(dto)
        }
        OpenOutcome::NeedsRecovery(info, pending) => {
            let dto = StartupDto {
                path: path.to_string_lossy().into_owned(),
                status: "needs_recovery".to_string(),
                recovery: Some(RecoveryDto {
                    pending_commands: info.pending_commands,
                    file_ok: info.file_ok,
                }),
                counts: counts_of(&pending.preview()),
            };
            *state.live.lock().map_err(|e| format!("state lock: {e}"))? = None;
            *state
                .pending
                .lock()
                .map_err(|e| format!("state lock: {e}"))? = Some(pending);
            Ok(dto)
        }
    }
}

#[tauri::command]
fn recovery_resolve(app: tauri::AppHandle, choice: String) -> Result<CountsDto, String> {
    let state = app.state::<StoreState>();
    let pending = state
        .pending
        .lock()
        .map_err(|e| format!("state lock: {e}"))?
        .take()
        .ok_or_else(|| "no pending recovery".to_string())?;
    let session = match choice.as_str() {
        "restore" => pending.restore().map_err(|e| e.to_string())?,
        "discard" => pending.discard().map_err(|e| e.to_string())?,
        _ => return Err("choice must be \"restore\" or \"discard\"".to_string()),
    };
    let counts = counts_of(session.doc());
    *state.live.lock().map_err(|e| format!("state lock: {e}"))? = Some(session);
    Ok(counts)
}

#[tauri::command]
fn dispatch(app: tauri::AppHandle, cmd: serde_json::Value) -> Result<CountsDto, String> {
    let command: Command =
        serde_json::from_value(cmd).map_err(|e| format!("invalid command: {e}"))?;
    let state = app.state::<StoreState>();
    let mut guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_mut().ok_or_else(|| "no open document".to_string())?;
    let now = speculum_store::time::now_ms();
    session
        .dispatch(command, now)
        .map_err(|e| e.to_string())?;
    Ok(counts_of(session.doc()))
}

#[tauri::command]
fn undo(app: tauri::AppHandle) -> Result<CountsDto, String> {
    let state = app.state::<StoreState>();
    let mut guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_mut().ok_or_else(|| "no open document".to_string())?;
    session
        .undo(speculum_store::time::now_ms())
        .map_err(|e| e.to_string())?;
    Ok(counts_of(session.doc()))
}

#[tauri::command]
fn redo(app: tauri::AppHandle) -> Result<CountsDto, String> {
    let state = app.state::<StoreState>();
    let mut guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_mut().ok_or_else(|| "no open document".to_string())?;
    session
        .redo(speculum_store::time::now_ms())
        .map_err(|e| e.to_string())?;
    Ok(counts_of(session.doc()))
}

#[tauri::command]
fn save_now(app: tauri::AppHandle) -> Result<StateDto, String> {
    let state = app.state::<StoreState>();
    let mut guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_mut().ok_or_else(|| "no open document".to_string())?;
    session.save_now().map_err(|e| e.to_string())?;
    Ok(state_of(session))
}

#[tauri::command]
fn state(app: tauri::AppHandle) -> Result<StateDto, String> {
    let state = app.state::<StoreState>();
    let guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_ref().ok_or_else(|| "no open document".to_string())?;
    Ok(state_of(session))
}

fn state_of(session: &Session) -> StateDto {
    StateDto {
        name: session.doc().meta.name.clone(),
        counts: counts_of(session.doc()),
        dirty: session.is_dirty(),
        last_saved_ms: session.last_save_ms(),
    }
}

/// Dev helper so a human can make edits before the kill test.
/// Dispatches `CreateObject` with a made-up name like "Sample App 7".
#[tauri::command]
fn add_sample_box(app: tauri::AppHandle) -> Result<CountsDto, String> {
    let state = app.state::<StoreState>();
    let mut guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_mut().ok_or_else(|| "no open document".to_string())?;
    let now = speculum_store::time::now_ms();
    let n = session.doc().model.objects.len() + 1;
    // Made-up sample names only.
    let id = format!("sample-{}", now % 1_000_000);
    let command = Command::CreateObject {
        object: speculum_core::Object {
            id,
            name: format!("Sample App {n}"),
            kind: speculum_core::ObjectKind::App,
            ..Default::default()
        },
    };
    // On the vanishingly rare chance the id collides, suffix and retry once.
    if let Err(e) = session.dispatch(command, now) {
        let retry = Command::CreateObject {
            object: speculum_core::Object {
                id: format!("sample-{now}-b"),
                name: format!("Sample App {n}"),
                kind: speculum_core::ObjectKind::App,
                ..Default::default()
            },
        };
        session.dispatch(retry, now).map_err(|e2| {
            format!("add_sample_box failed: {e} then {e2}")
        })?;
    }
    Ok(counts_of(session.doc()))
}

#[derive(serde::Serialize)]
struct AppInfo {
    name: String,
    version: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: speculum_core::APP_NAME.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

fn main() {
    let store_state = StoreState::default();
    tauri::Builder::default()
        .manage(store_state)
        .setup(|app| {
            // Background autosave tick every 200 ms.
            let state = app.state::<StoreState>();
            let live = state.live.clone();
            std::thread::spawn::<_, ()>(move || loop {
                std::thread::sleep(Duration::from_millis(200));
                let now = speculum_store::time::now_ms();
                if let Ok(mut guard) = live.lock() {
                    if let Some(session) = guard.as_mut() {
                        // Best-effort: a failed tick retries on the next round.
                        let _ = session.tick(now);
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<StoreState>();
                let taken = state
                    .live
                    .lock()
                    .map(|mut guard| guard.take())
                    .unwrap_or(None);
                if let Some(session) = taken {
                    // Best-effort save + unlock on close.
                    let _ = session.close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            startup,
            recovery_resolve,
            dispatch,
            undo,
            redo,
            save_now,
            state,
            add_sample_box
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
