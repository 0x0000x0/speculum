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
    rev: u64,
}

fn counts_of(doc: &Document, rev: u64) -> CountsDto {
    CountsDto {
        objects: doc.model.objects.len(),
        connections: doc.model.connections.len(),
        tags: doc.model.tags.len(),
        diagrams: doc.diagrams.len(),
        flows: doc.model.flows.len(),
        rev,
    }
}

fn change_of(session: &Session) -> CountsDto {
    counts_of(session.doc(), session.rev())
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
            counts: counts_of(session.doc(), session.rev()),
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
            counts: counts_of(session.doc(), session.rev()),
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
                counts: counts_of(&pending.preview(), 0),
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
    let counts = change_of(&session);
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
    Ok(change_of(session))
}

#[tauri::command]
fn undo(app: tauri::AppHandle) -> Result<CountsDto, String> {
    let state = app.state::<StoreState>();
    let mut guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_mut().ok_or_else(|| "no open document".to_string())?;
    session
        .undo(speculum_store::time::now_ms())
        .map_err(|e| e.to_string())?;
    Ok(change_of(session))
}

#[tauri::command]
fn redo(app: tauri::AppHandle) -> Result<CountsDto, String> {
    let state = app.state::<StoreState>();
    let mut guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_mut().ok_or_else(|| "no open document".to_string())?;
    session
        .redo(speculum_store::time::now_ms())
        .map_err(|e| e.to_string())?;
    Ok(change_of(session))
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
        counts: change_of(session),
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
    Ok(change_of(session))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagramListItem {
    id: String,
    name: String,
    level: speculum_core::DiagramLevel,
    scope_object_id: Option<String>,
    order: u32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BreadcrumbItem {
    id: String,
    name: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScopeDto {
    id: String,
    name: String,
    kind: speculum_core::ObjectKind,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagramViewDto {
    diagram: speculum_core::Diagram,
    objects: Vec<speculum_core::Object>,
    child_counts: std::collections::BTreeMap<String, usize>,
    edges: Vec<speculum_core::ViewEdge>,
    breadcrumb: Vec<BreadcrumbItem>,
    scope: Option<ScopeDto>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EnsureLayoutDto {
    placed: usize,
    counts: CountsDto,
}

fn live_session<'a>(
    app: &'a tauri::AppHandle,
    guard: &'a mut std::sync::MutexGuard<'_, Option<Session>>,
) -> Result<&'a mut Session, String> {
    let _ = app;
    guard.as_mut().ok_or_else(|| "no open document".to_string())
}

#[tauri::command]
fn get_document(app: tauri::AppHandle) -> Result<Document, String> {
    let state = app.state::<StoreState>();
    let guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_ref().ok_or_else(|| "no open document".to_string())?;
    Ok(session.doc().clone())
}

#[tauri::command]
fn list_diagrams(app: tauri::AppHandle) -> Result<Vec<DiagramListItem>, String> {
    let state = app.state::<StoreState>();
    let guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_ref().ok_or_else(|| "no open document".to_string())?;
    let mut out: Vec<DiagramListItem> = session
        .doc()
        .diagrams
        .values()
        .map(|d| DiagramListItem {
            id: d.id.clone(),
            name: d.name.clone(),
            level: d.level.clone(),
            scope_object_id: d.scope_object_id.clone(),
            order: d.order,
        })
        .collect();
    out.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
    Ok(out)
}

#[tauri::command]
fn get_diagram_view(
    app: tauri::AppHandle,
    diagram_id: String,
) -> Result<DiagramViewDto, String> {
    let state = app.state::<StoreState>();
    let guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_ref().ok_or_else(|| "no open document".to_string())?;
    let doc = session.doc();
    let diagram = doc
        .diagrams
        .get(&diagram_id)
        .cloned()
        .ok_or_else(|| format!("unknown diagram: {diagram_id}"))?;
    // M5: the scope object is never a box on its own diagram; the UI draws
    // the scope FRAME instead. Old files are repaired by Session open and
    // ensure_layout; the view defensively filters here too.
    let scope_id = diagram.scope_object_id.clone();
    let mut objects = Vec::new();
    let mut child_counts = std::collections::BTreeMap::new();
    let mut box_ids: Vec<&String> = diagram.boxes.keys().collect();
    box_ids.sort();
    for bid in box_ids {
        if Some(bid) == scope_id.as_ref() {
            continue;
        }
        if let Some(o) = doc.model.objects.get(bid) {
            child_counts.insert(bid.clone(), doc.model.children(bid).len());
            objects.push(o.clone());
        }
    }
    let scope = scope_id.as_ref().and_then(|sid| {
        doc.model.objects.get(sid).map(|o| ScopeDto {
            id: o.id.clone(),
            name: o.name.clone(),
            kind: o.kind.clone(),
        })
    });
    let edges = speculum_core::diagram_edges(doc, &diagram_id);
    // Scope breadcrumb: root-first ancestors, then the scope object itself.
    let mut breadcrumb = Vec::new();
    if let Some(scope) = &diagram.scope_object_id {
        let mut chain: Vec<&speculum_core::Object> = doc.model.ancestors(scope);
        chain.reverse();
        for a in chain {
            breadcrumb.push(BreadcrumbItem {
                id: a.id.clone(),
                name: a.name.clone(),
            });
        }
        let name = doc
            .model
            .objects
            .get(scope)
            .map(|o| o.name.clone())
            .unwrap_or_default();
        breadcrumb.push(BreadcrumbItem {
            id: scope.clone(),
            name,
        });
    }
    Ok(DiagramViewDto {
        diagram,
        objects,
        child_counts,
        edges,
        breadcrumb,
        scope,
    })
}

/// Seed the made-up sample document. Only works on an empty model;
/// dispatched as ONE Batch command so it is a single undo step.
#[tauri::command]
fn seed_sample(app: tauri::AppHandle) -> Result<CountsDto, String> {
    let state = app.state::<StoreState>();
    let mut guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = live_session(&app, &mut guard)?;
    if !speculum_core::is_empty_model(session.doc()) {
        return Err("document is not empty".to_string());
    }
    let now = speculum_store::time::now_ms();
    session
        .dispatch(speculum_core::seed_sample_command(), now)
        .map_err(|e| e.to_string())?;
    Ok(change_of(session))
}

/// Place boxes that have no rect (or a zero-size rect) on a diagram.
/// Dispatches a single Batch(ApplyLayout + mark auto_placed) only when
/// something was missing; otherwise a no-op that still reports rev.
#[tauri::command]
fn ensure_layout(
    app: tauri::AppHandle,
    diagram_id: String,
) -> Result<EnsureLayoutDto, String> {
    let state = app.state::<StoreState>();
    let mut guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = live_session(&app, &mut guard)?;
    if !session.doc().diagrams.contains_key(&diagram_id) {
        return Err(format!("unknown diagram: {diagram_id}"));
    }
    // M5 one-off repair: drop the scope object if an old file boxes it on
    // its own diagram (persisted via the same undoable batch below).
    let scope_boxed = session
        .doc()
        .diagrams
        .get(&diagram_id)
        .and_then(|d| d.scope_object_id.clone())
        .map(|scope| {
            session
                .doc()
                .diagrams
                .get(&diagram_id)
                .map(|d| d.boxes.contains_key(&scope))
                .unwrap_or(false)
        })
        .unwrap_or(false);
    if scope_boxed {
        eprintln!("speculum: ensure_layout removes scope box on '{diagram_id}'");
    }
    let placed_map = speculum_layout::place_missing(session.doc(), &diagram_id);
    let placed = placed_map.len();
    if placed > 0 || scope_boxed {
        let mut boxes = session
            .doc()
            .diagrams
            .get(&diagram_id)
            .map(|d| d.boxes.clone())
            .unwrap_or_default();
        if scope_boxed {
            if let Some(scope) = session
                .doc()
                .diagrams
                .get(&diagram_id)
                .and_then(|d| d.scope_object_id.clone())
            {
                boxes.remove(&scope);
            }
        }
        boxes.extend(placed_map);
        let now = speculum_store::time::now_ms();
        session
            .dispatch(
                Command::Batch {
                    commands: vec![
                        Command::ApplyLayout {
                            diagram_id: diagram_id.clone(),
                            boxes,
                        },
                        Command::PatchDiagram {
                            id: diagram_id,
                            name: None,
                            description: None,
                            order: None,
                            pinned: None,
                            domain_id: None,
                            auto_placed: Some(true),
                        },
                    ],
                },
                now,
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(EnsureLayoutDto {
        placed,
        counts: change_of(session),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ZoomIntoDto {
    diagram_id: String,
    created: bool,
}

/// Resolve "Open inside" for a box. When no diagram exists yet and the
/// object kind can contain children, creates the lower diagram as ONE Batch
/// (one undo step): scoped to the object, named "<Object name> <Level>",
/// with the object's existing model children added as boxes placed by
/// speculum-layout.
#[tauri::command]
fn zoom_into(
    app: tauri::AppHandle,
    diagram_id: String,
    object_id: String,
) -> Result<ZoomIntoDto, String> {
    let state = app.state::<StoreState>();
    let mut guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = live_session(&app, &mut guard)?;
    if !session.doc().diagrams.contains_key(&diagram_id) {
        return Err(format!("unknown diagram: {diagram_id}"));
    }
    if !session.doc().model.objects.contains_key(&object_id) {
        return Err(format!("unknown object: {object_id}"));
    }
    match speculum_core::zoom_target(session.doc(), &diagram_id, &object_id) {
        speculum_core::ZoomTarget::Existing { diagram_id: target } => {
            Ok(ZoomIntoDto { diagram_id: target, created: false })
        }
        speculum_core::ZoomTarget::NotZoomable => {
            Err(format!("object is not zoomable: {object_id}"))
        }
        speculum_core::ZoomTarget::NeedsCreate {
            level,
            scope_object_id,
            suggested_name,
        } => {
            // Children to seed as boxes: model children, plus group members
            // for groups. Never the scope object itself.
            let mut seed_ids: Vec<String> = session
                .doc()
                .model
                .children(&scope_object_id)
                .iter()
                .map(|o| o.id.clone())
                .collect();
            if let Some(obj) = session.doc().model.objects.get(&scope_object_id) {
                if obj.kind == speculum_core::ObjectKind::Group {
                    for m in session.doc().model.group_members(&scope_object_id) {
                        if !seed_ids.contains(&m.id) {
                            seed_ids.push(m.id.clone());
                        }
                    }
                }
            }
            seed_ids.retain(|id| id != &scope_object_id);
            seed_ids.sort();
            // Unique diagram id derived from the scope object.
            let slug: String = scope_object_id
                .trim_start_matches("obj-")
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect();
            let slug = if slug.trim_matches('-').is_empty() {
                    "diagram".to_string()
                } else {
                    slug.trim_matches('-').to_string()
                };
            let mut new_id = format!("dg-{slug}");
            let mut n = 2u32;
            while session.doc().diagrams.contains_key(&new_id) {
                new_id = format!("dg-{slug}-{n}");
                n += 1;
            }
            let order = session
                .doc()
                .diagrams
                .values()
                .map(|d| d.order)
                .max()
                .unwrap_or(0)
                .saturating_add(1);
            // Placeholder zero rects, then place via speculum-layout on a
            // scratch doc so the created diagram carries final rects.
            let mut scratch = session.doc().clone();
            let placeholder: std::collections::BTreeMap<String, speculum_core::Rect> =
                seed_ids
                    .iter()
                    .map(|id| {
                        (
                            id.clone(),
                            speculum_core::Rect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 },
                        )
                    })
                    .collect();
            scratch.diagrams.insert(
                new_id.clone(),
                speculum_core::Diagram {
                    id: new_id.clone(),
                    name: suggested_name.clone(),
                    level: level.clone(),
                    scope_object_id: Some(scope_object_id.clone()),
                    order,
                    boxes: placeholder,
                    ..Default::default()
                },
            );
            let mut boxes = std::collections::BTreeMap::new();
            // Keep only children that still exist (they do), with placed rects.
            let placed = speculum_layout::place_missing(&scratch, &new_id);
            for id in &seed_ids {
                if let Some(r) = placed.get(id) {
                    boxes.insert(id.clone(), r.clone());
                }
            }
            let now = speculum_store::time::now_ms();
            session
                .dispatch(
                    Command::Batch {
                        commands: vec![Command::CreateDiagram {
                            diagram: speculum_core::Diagram {
                                id: new_id.clone(),
                                name: suggested_name,
                                level,
                                scope_object_id: Some(scope_object_id),
                                order,
                                boxes,
                                ..Default::default()
                            },
                        }],
                    },
                    now,
                )
                .map_err(|e| e.to_string())?;
            Ok(ZoomIntoDto { diagram_id: new_id, created: true })
        }
    }
}

/// The diagram "up" from here: the lowest-order diagram boxing this
/// diagram's scope object, or None at the top. (The UI prefers the diagram
/// we came from; this picks the default.)
#[tauri::command]
fn diagram_parent(
    app: tauri::AppHandle,
    diagram_id: String,
) -> Result<Option<String>, String> {
    let state = app.state::<StoreState>();
    let guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_ref().ok_or_else(|| "no open document".to_string())?;
    let doc = session.doc();
    let diagram = doc
        .diagrams
        .get(&diagram_id)
        .ok_or_else(|| format!("unknown diagram: {diagram_id}"))?;
    let scope = match &diagram.scope_object_id {
        Some(s) => s.clone(),
        None => return Ok(None),
    };
    let mut holders: Vec<&speculum_core::Diagram> = doc
        .diagrams
        .values()
        .filter(|d| d.id != diagram_id && d.boxes.contains_key(&scope))
        .collect();
    holders.sort_by(|a, b| {
        a.order
            .cmp(&b.order)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(holders.into_iter().next().map(|d| d.id.clone()))
}

/// Override where "Open inside" on a box goes (None clears it).
#[tauri::command]
fn set_landing(
    app: tauri::AppHandle,
    diagram_id: String,
    object_id: String,
    target_diagram_id: Option<String>,
) -> Result<CountsDto, String> {
    let state = app.state::<StoreState>();
    let mut guard = state.live.lock().map_err(|e| format!("state lock: {e}"))?;
    let session = guard.as_mut().ok_or_else(|| "no open document".to_string())?;
    let now = speculum_store::time::now_ms();
    session
        .dispatch(
            Command::SetLanding {
                diagram_id,
                object_id,
                target: target_diagram_id,
            },
            now,
        )
        .map_err(|e| e.to_string())?;
    Ok(change_of(session))
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
            add_sample_box,
            get_document,
            list_diagrams,
            get_diagram_view,
            seed_sample,
            ensure_layout,
            zoom_into,
            diagram_parent,
            set_landing
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
