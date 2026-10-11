use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use crate::model::{
    Connection, Diagram, Direction, Document, Domain, EdgeLayout, Flow, FlowPath, FlowStep, Id,
    LineShape, Link, Object, Rect, Status, StepKind, Tag, TagGroup, Viewport,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Errors from applying commands.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoreError {
    #[error("not found: {0}")]
    NotFound(Id),
    #[error("duplicate id: {0}")]
    DuplicateId(Id),
    #[error("would create cycle")]
    WouldCreateCycle,
    #[error("invalid index")]
    InvalidIndex,
    #[error("invalid: {0}")]
    Invalid(String),
}

// ---------------------------------------------------------------------------
// Patches
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<Status>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag_ids: Option<Vec<Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technologies: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<Link>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_ids: Option<Vec<Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_id: Option<Option<Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<Direction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<Status>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_shape: Option<LineShape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label_position: Option<Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via_id: Option<Option<Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag_ids: Option<Vec<Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technologies: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<Link>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<Id>,
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/// A mutation to a document. Applying it returns its inverse.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Command {
    CreateObject {
        object: Object,
    },
    DeleteObject {
        id: Id,
    },
    PatchObject {
        id: Id,
        patch: ObjectPatch,
    },
    Reparent {
        id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        new_parent: Option<Id>,
    },
    Connect {
        connection: Connection,
    },
    DeleteConnection {
        id: Id,
    },
    PatchConnection {
        id: Id,
        patch: ConnectionPatch,
    },
    CreateTag {
        tag: Tag,
    },
    DeleteTag {
        id: Id,
    },
    PatchTag {
        id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        group_id: Option<Option<Id>>,
    },
    CreateTagGroup {
        group: TagGroup,
    },
    DeleteTagGroup {
        id: Id,
    },
    CreateDomain {
        domain: Domain,
    },
    DeleteDomain {
        id: Id,
    },
    CreateDiagram {
        diagram: Diagram,
    },
    DeleteDiagram {
        id: Id,
    },
    PatchDiagram {
        id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        order: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pinned: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        domain_id: Option<Option<Id>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        auto_placed: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        show_all_labels: Option<bool>,
    },
    AddToDiagram {
        diagram_id: Id,
        object_id: Id,
        rect: Rect,
    },
    RemoveFromDiagram {
        diagram_id: Id,
        object_id: Id,
    },
    MoveBoxes {
        diagram_id: Id,
        moves: BTreeMap<Id, Rect>,
    },
    ApplyLayout {
        diagram_id: Id,
        boxes: BTreeMap<Id, Rect>,
    },
    ShowConnection {
        diagram_id: Id,
        connection_id: Id,
        layout: EdgeLayout,
    },
    HideConnection {
        diagram_id: Id,
        connection_id: Id,
    },
    SetLanding {
        diagram_id: Id,
        object_id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target: Option<Id>,
    },
    SetViewport {
        diagram_id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        viewport: Option<Viewport>,
    },
    CreateFlow {
        flow: Flow,
    },
    DeleteFlow {
        id: Id,
    },
    PatchFlow {
        id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pinned: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        show_all_connection_names: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        show_all_steps: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        diagram_id: Option<Option<Id>>,
    },
    AddStep {
        flow_id: Id,
        #[serde(default)]
        path: Vec<Id>,
        index: usize,
        step: FlowStep,
    },
    PatchStep {
        flow_id: Id,
        step_id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        kind: Option<StepKind>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reversed: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        origin_id: Option<Option<Id>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target_id: Option<Option<Id>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        via_connection_id: Option<Option<Id>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        object_id: Option<Option<Id>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        go_to_flow_id: Option<Option<Id>>,
    },
    MoveStep {
        flow_id: Id,
        step_id: Id,
        #[serde(default)]
        to_path: Vec<Id>,
        to_index: usize,
    },
    DeleteStep {
        flow_id: Id,
        step_id: Id,
    },
    AddPath {
        flow_id: Id,
        step_id: Id,
        path: FlowPath,
    },
    DeletePath {
        flow_id: Id,
        step_id: Id,
        path_id: Id,
    },
    Batch { commands: Vec<Command> },
}

// ---------------------------------------------------------------------------
// Flow navigation helpers
// ---------------------------------------------------------------------------

fn steps_container_mut<'a>(
    top: &'a mut Vec<FlowStep>,
    path: &[Id],
) -> Option<&'a mut Vec<FlowStep>> {
    let mut cur: &'a mut Vec<FlowStep> = top;
    for pid in path {
        // find path with this id among cur's steps
        let mut found: Option<*mut Vec<FlowStep>> = None;
        for s in cur.iter_mut() {
            for p in s.paths.iter_mut() {
                if &p.id == pid {
                    found = Some(&mut p.steps as *mut Vec<FlowStep>);
                    break;
                }
            }
            if found.is_some() {
                break;
            }
        }
        {
            let ptr = found?;
            // SAFETY: ptr derived from cur which we no longer borrow
            cur = unsafe { &mut *ptr };
        }
    }
    Some(cur)
}

fn steps_container<'a>(top: &'a [FlowStep], path: &[Id]) -> Option<&'a [FlowStep]> {
    let mut cur: &'a [FlowStep] = top;
    for pid in path {
        let mut next: Option<&'a [FlowStep]> = None;
        for s in cur {
            for p in &s.paths {
                if &p.id == pid {
                    next = Some(&p.steps);
                    break;
                }
            }
            if next.is_some() {
                break;
            }
        }
        cur = next?;
    }
    Some(cur)
}

fn step_id_exists(steps: &[FlowStep], id: &Id) -> bool {
    for s in steps {
        if &s.id == id {
            return true;
        }
        for p in &s.paths {
            if step_id_exists(&p.steps, id) {
                return true;
            }
        }
    }
    false
}

/// Locate a step: returns (parent path trail, index in parent).
fn locate_step(steps: &[FlowStep], step_id: &Id, trail: &mut Vec<Id>) -> Option<(Vec<Id>, usize)> {
    for (i, s) in steps.iter().enumerate() {
        if &s.id == step_id {
            return Some((trail.clone(), i));
        }
        for p in &s.paths {
            trail.push(p.id.clone());
            if let Some(found) = locate_step(&p.steps, step_id, trail) {
                return Some(found);
            }
            trail.pop();
        }
    }
    None
}

fn locate_step_in_flow(flow: &Flow, step_id: &Id) -> Option<(Vec<Id>, usize)> {
    let mut trail = Vec::new();
    locate_step(&flow.steps, step_id, &mut trail)
}

fn remove_step_from(
    steps: &mut Vec<FlowStep>,
    step_id: &Id,
) -> Option<(Vec<Id>, usize, FlowStep)> {
    let mut trail = Vec::new();
    let (path, idx) = locate_step(steps, step_id, &mut trail)?;
    let container = steps_container_mut(steps, &path)?;
    if idx >= container.len() {
        return None;
    }
    let step = container.remove(idx);
    Some((path, idx, step))
}

fn step_touches(step: &FlowStep, objs: &BTreeSet<Id>, conns: &BTreeSet<Id>) -> bool {
    if let Some(c) = &step.via_connection_id {
        if conns.contains(c) {
            return true;
        }
    }
    if let Some(o) = &step.origin_id {
        if objs.contains(o) {
            return true;
        }
    }
    if let Some(t) = &step.target_id {
        if objs.contains(t) {
            return true;
        }
    }
    if let Some(o) = &step.object_id {
        if objs.contains(o) {
            return true;
        }
    }
    false
}

/// Collect (path_trail, index, step-clone) for steps touching removed sets, depth-first.
fn collect_touching(
    steps: &[FlowStep],
    objs: &BTreeSet<Id>,
    conns: &BTreeSet<Id>,
    trail: &mut Vec<Id>,
    out: &mut Vec<(Vec<Id>, usize, FlowStep)>,
) {
    for (i, s) in steps.iter().enumerate() {
        if step_touches(s, objs, conns) {
            out.push((trail.clone(), i, s.clone()));
        }
        for p in &s.paths {
            trail.push(p.id.clone());
            collect_touching(&p.steps, objs, conns, trail, out);
            trail.pop();
        }
    }
}

fn subtree_ids(doc: &Document, root: &Id) -> BTreeSet<Id> {
    let mut seen: BTreeSet<Id> = BTreeSet::new();
    let mut stack = vec![root.clone()];
    seen.insert(root.clone());
    while let Some(cur) = stack.pop() {
        for (oid, obj) in doc.model.objects.iter() {
            if obj.parent_id.as_ref() == Some(&cur) && seen.insert(oid.clone()) {
                stack.push(oid.clone());
            }
        }
    }
    seen
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

impl Command {
    /// Apply the command, returning its inverse. On error the document is
    /// unchanged.
    pub fn apply(self, doc: &mut Document) -> Result<Command, CoreError> {
        match self {
            Command::CreateObject { object } => {
                if doc.model.objects.contains_key(&object.id) {
                    return Err(CoreError::DuplicateId(object.id));
                }
                if object.id.is_empty() {
                    return Err(CoreError::Invalid("object id is empty".to_string()));
                }
                if let Some(pid) = &object.parent_id {
                    if !doc.model.objects.contains_key(pid) {
                        return Err(CoreError::NotFound(pid.clone()));
                    }
                }
                let id = object.id.clone();
                doc.model.objects.insert(id.clone(), object);
                Ok(Command::DeleteObject { id })
            }
            Command::DeleteObject { id } => {
                if !doc.model.objects.contains_key(&id) {
                    return Err(CoreError::NotFound(id));
                }
                let removed_objs = subtree_ids(doc, &id);
                // objects
                let mut objects: BTreeMap<Id, Object> = BTreeMap::new();
                for oid in &removed_objs {
                    if let Some(o) = doc.model.objects.get(oid) {
                        objects.insert(oid.clone(), o.clone());
                    }
                }
                // connections touching (origin/target/via)
                let mut connections: BTreeMap<Id, Connection> = BTreeMap::new();
                for (cid, c) in doc.model.connections.iter() {
                    if removed_objs.contains(&c.origin_id)
                        || removed_objs.contains(&c.target_id)
                        || c.via_id.as_ref().map(|v| removed_objs.contains(v)).unwrap_or(false)
                    {
                        connections.insert(cid.clone(), c.clone());
                    }
                }
                let removed_conns: BTreeSet<Id> = connections.keys().cloned().collect();
                // diagrams scoped to deleted objects
                let mut diagrams_deleted: BTreeMap<Id, Diagram> = BTreeMap::new();
                for (did, d) in doc.diagrams.iter() {
                    if let Some(scope) = &d.scope_object_id {
                        if removed_objs.contains(scope) {
                            diagrams_deleted.insert(did.clone(), d.clone());
                        }
                    }
                }
                let deleted_diagram_ids: BTreeSet<Id> =
                    diagrams_deleted.keys().cloned().collect();
                // remaining diagrams: boxes / connections / landing to remove
                // capture old values for restore
                let mut boxes_restore: Vec<(Id, Id, Rect)> = Vec::new(); // (diagram, object, rect)
                let mut conns_restore: Vec<(Id, Id, EdgeLayout)> = Vec::new();
                let mut landing_restore: Vec<(Id, Id, Id)> = Vec::new();
                for (did, d) in doc.diagrams.iter() {
                    if deleted_diagram_ids.contains(did) {
                        continue;
                    }
                    for (bid, rect) in &d.boxes {
                        if removed_objs.contains(bid) {
                            boxes_restore.push((did.clone(), bid.clone(), rect.clone()));
                        }
                    }
                    for (cid, layout) in &d.connections {
                        if removed_conns.contains(cid) {
                            conns_restore.push((did.clone(), cid.clone(), layout.clone()));
                        }
                    }
                    for (obj_id, target_id) in &d.landing {
                        if removed_objs.contains(obj_id)
                            || deleted_diagram_ids.contains(target_id)
                        {
                            landing_restore.push((did.clone(), obj_id.clone(), target_id.clone()));
                        }
                    }
                }
                // remaining objects: group_ids cleanup
                let mut group_restore: Vec<(Id, Vec<Id>)> = Vec::new();
                for (oid, o) in doc.model.objects.iter() {
                    if removed_objs.contains(oid) {
                        continue;
                    }
                    if o.group_ids.iter().any(|g| removed_objs.contains(g)) {
                        group_restore.push((oid.clone(), o.group_ids.clone()));
                    }
                }
                // remaining connections: via_id cleanup
                let mut via_restore: Vec<(Id, Option<Id>)> = Vec::new();
                for (cid, c) in doc.model.connections.iter() {
                    if removed_conns.contains(cid) {
                        continue;
                    }
                    if let Some(v) = &c.via_id {
                        if removed_objs.contains(v) {
                            via_restore.push((cid.clone(), c.via_id.clone()));
                        }
                    }
                }
                // flows: diagram_id cleared if pointing at deleted diagram
                let mut flow_diagram_restore: Vec<(Id, Option<Id>)> = Vec::new();
                for (fid, f) in doc.model.flows.iter() {
                    if let Some(did) = &f.diagram_id {
                        if deleted_diagram_ids.contains(did) {
                            flow_diagram_restore.push((fid.clone(), f.diagram_id.clone()));
                        }
                    }
                }
                // flow steps touching removed objs/conns
                let mut steps_restore: Vec<(Id, Vec<Id>, usize, FlowStep)> = Vec::new();
                for (fid, flow) in doc.model.flows.iter() {
                    let mut trail = Vec::new();
                    let mut collected = Vec::new();
                    collect_touching(
                        &flow.steps,
                        &removed_objs,
                        &removed_conns,
                        &mut trail,
                        &mut collected,
                    );
                    for (path, idx, step) in collected {
                        steps_restore.push((fid.clone(), path, idx, step));
                    }
                }

                // ---- mutate ----
                for oid in &removed_objs {
                    doc.model.objects.remove(oid);
                }
                for cid in removed_conns.iter() {
                    doc.model.connections.remove(cid);
                }
                for did in deleted_diagram_ids.iter() {
                    doc.diagrams.remove(did);
                }
                for (did, bid, _) in &boxes_restore {
                    if let Some(d) = doc.diagrams.get_mut(did) {
                        d.boxes.remove(bid);
                    }
                }
                for (did, cid, _) in &conns_restore {
                    if let Some(d) = doc.diagrams.get_mut(did) {
                        d.connections.remove(cid);
                    }
                }
                for (did, obj_id, _) in &landing_restore {
                    if let Some(d) = doc.diagrams.get_mut(did) {
                        d.landing.remove(obj_id);
                    }
                }
                for (oid, _) in &group_restore {
                    if let Some(o) = doc.model.objects.get_mut(oid) {
                        o.group_ids.retain(|g| !removed_objs.contains(g));
                    }
                }
                for (cid, _) in &via_restore {
                    if let Some(c) = doc.model.connections.get_mut(cid) {
                        c.via_id = None;
                    }
                }
                for (fid, _) in &flow_diagram_restore {
                    if let Some(f) = doc.model.flows.get_mut(fid) {
                        f.diagram_id = None;
                    }
                }
                // remove flow steps (deepest-first to keep indices valid)
                {
                    // group by flow
                    let mut by_flow: BTreeMap<Id, Vec<Id>> = BTreeMap::new();
                    for (fid, _, _, step) in &steps_restore {
                        by_flow.entry(fid.clone()).or_default().push(step.id.clone());
                    }
                    // remove deepest-first: sort step ids by depth of location?
                    // simplest: repeatedly remove by id using remove_step_from
                    // in order of descending path length then descending index.
                    let mut ordered = steps_restore.clone();
                    ordered.sort_by(|a, b| {
                        b.1.len()
                            .cmp(&a.1.len())
                            .then_with(|| b.1.cmp(&a.1))
                            .then_with(|| b.2.cmp(&a.2))
                    });
                    for (fid, _, _, step) in ordered {
                        if let Some(flow) = doc.model.flows.get_mut(&fid) {
                            let _ = remove_step_from(&mut flow.steps, &step.id);
                        }
                    }
                }

                // ---- build inverse batch ----
                let mut inv: Vec<Command> = Vec::new();
                // objects: parents first (sort by depth ascending within deleted set)
                let mut objs_sorted: Vec<(Id, Object)> = objects.into_iter().collect();
                {
                    let map: BTreeMap<Id, Object> = objs_sorted
                        .iter()
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect();
                    objs_sorted.sort_by(|a, b| {
                        let da = ancestor_len_in_map(&a.1, &removed_objs, &map);
                        let db = ancestor_len_in_map(&b.1, &removed_objs, &map);
                        da.cmp(&db).then_with(|| a.0.cmp(&b.0))
                    });
                }
                for (_, o) in objs_sorted {
                    inv.push(Command::CreateObject { object: o });
                }
                let mut conns_sorted: Vec<(Id, Connection)> =
                    connections.into_iter().collect();
                conns_sorted.sort_by(|a, b| a.0.cmp(&b.0));
                for (_, c) in conns_sorted {
                    inv.push(Command::Connect { connection: c });
                }
                let mut diags_sorted: Vec<(Id, Diagram)> =
                    diagrams_deleted.into_iter().collect();
                diags_sorted.sort_by(|a, b| a.0.cmp(&b.0));
                for (_, d) in diags_sorted {
                    inv.push(Command::CreateDiagram { diagram: d });
                }
                // diagram entries
                boxes_restore.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
                for (did, bid, rect) in boxes_restore {
                    inv.push(Command::AddToDiagram {
                        diagram_id: did,
                        object_id: bid,
                        rect,
                    });
                }
                conns_restore.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
                for (did, cid, layout) in conns_restore {
                    inv.push(Command::ShowConnection {
                        diagram_id: did,
                        connection_id: cid,
                        layout,
                    });
                }
                landing_restore.sort();
                for (did, obj_id, target) in landing_restore {
                    inv.push(Command::SetLanding {
                        diagram_id: did,
                        object_id: obj_id,
                        target: Some(target),
                    });
                }
                group_restore.sort();
                for (oid, old_groups) in group_restore {
                    inv.push(Command::PatchObject {
                        id: oid,
                        patch: ObjectPatch {
                            group_ids: Some(old_groups),
                            ..Default::default()
                        },
                    });
                }
                via_restore.sort();
                for (cid, old_via) in via_restore {
                    inv.push(Command::PatchConnection {
                        id: cid,
                        patch: ConnectionPatch {
                            via_id: Some(old_via),
                            ..Default::default()
                        },
                    });
                }
                flow_diagram_restore.sort();
                for (fid, old_did) in flow_diagram_restore {
                    inv.push(Command::PatchFlow {
                        id: fid,
                        name: None,
                        description: None,
                        pinned: None,
                        show_all_connection_names: None,
                        show_all_steps: None,
                        diagram_id: Some(old_did),
                    });
                }
                // flow steps: restore ascending (path, index)
                steps_restore.sort_by(|a, b| {
                    a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)).then_with(|| a.2.cmp(&b.2))
                });
                for (fid, path, idx, step) in steps_restore {
                    inv.push(Command::AddStep {
                        flow_id: fid,
                        path,
                        index: idx,
                        step,
                    });
                }
                Ok(Command::Batch { commands: inv })
            }
            Command::PatchObject { id, patch } => {
                let obj = doc
                    .model
                    .objects
                    .get_mut(&id)
                    .ok_or(CoreError::NotFound(id.clone()))?;
                let old = ObjectPatch {
                    name: patch.name.as_ref().map(|_| obj.name.clone()),
                    caption: patch.caption.as_ref().map(|_| obj.caption.clone()),
                    description: patch.description.as_ref().map(|_| obj.description.clone()),
                    status: patch.status.as_ref().map(|_| obj.status.clone()),
                    external: patch.external.as_ref().map(|_| obj.external),
                    icon: patch.icon.as_ref().map(|_| obj.icon.clone()),
                    tag_ids: patch.tag_ids.as_ref().map(|_| obj.tag_ids.clone()),
                    technologies: patch
                        .technologies
                        .as_ref()
                        .map(|_| obj.technologies.clone()),
                    links: patch.links.as_ref().map(|_| obj.links.clone()),
                    group_ids: patch.group_ids.as_ref().map(|_| obj.group_ids.clone()),
                    domain_id: patch.domain_id.as_ref().map(|_| obj.domain_id.clone()),
                    labels: patch.labels.as_ref().map(|_| obj.labels.clone()),
                };
                if let Some(v) = patch.name {
                    obj.name = v;
                }
                if let Some(v) = patch.caption {
                    obj.caption = v;
                }
                if let Some(v) = patch.description {
                    obj.description = v;
                }
                if let Some(v) = patch.status {
                    obj.status = v;
                }
                if let Some(v) = patch.external {
                    obj.external = v;
                }
                if let Some(v) = patch.icon {
                    obj.icon = v;
                }
                if let Some(v) = patch.tag_ids {
                    obj.tag_ids = v;
                }
                if let Some(v) = patch.technologies {
                    obj.technologies = v;
                }
                if let Some(v) = patch.links {
                    obj.links = v;
                }
                if let Some(v) = patch.group_ids {
                    obj.group_ids = v;
                }
                if let Some(v) = patch.domain_id {
                    obj.domain_id = v;
                }
                if let Some(v) = patch.labels {
                    obj.labels = v;
                }
                Ok(Command::PatchObject { id, patch: old })
            }
            Command::Reparent { id, new_parent } => {
                if !doc.model.objects.contains_key(&id) {
                    return Err(CoreError::NotFound(id));
                }
                if let Some(pid) = &new_parent {
                    if !doc.model.objects.contains_key(pid) {
                        return Err(CoreError::NotFound(pid.clone()));
                    }
                    if pid == &id || doc.model.is_ancestor(&id, pid) {
                        return Err(CoreError::WouldCreateCycle);
                    }
                }
                let old = doc
                    .model
                    .objects
                    .get(&id)
                    .and_then(|o| o.parent_id.clone());
                if let Some(obj) = doc.model.objects.get_mut(&id) {
                    obj.parent_id = new_parent;
                }
                Ok(Command::Reparent {
                    id,
                    new_parent: old,
                })
            }
            Command::Connect { connection } => {
                if connection.id.is_empty() {
                    return Err(CoreError::Invalid("connection id is empty".to_string()));
                }
                if doc.model.connections.contains_key(&connection.id) {
                    return Err(CoreError::DuplicateId(connection.id));
                }
                if !doc.model.objects.contains_key(&connection.origin_id) {
                    return Err(CoreError::NotFound(connection.origin_id));
                }
                if !doc.model.objects.contains_key(&connection.target_id) {
                    return Err(CoreError::NotFound(connection.target_id));
                }
                if let Some(v) = &connection.via_id {
                    if !doc.model.objects.contains_key(v) {
                        return Err(CoreError::NotFound(v.clone()));
                    }
                }
                let id = connection.id.clone();
                doc.model.connections.insert(id.clone(), connection);
                Ok(Command::DeleteConnection { id })
            }
            Command::DeleteConnection { id } => {
                let conn = doc
                    .model
                    .connections
                    .get(&id)
                    .cloned()
                    .ok_or(CoreError::NotFound(id.clone()))?;
                // flow steps via it (any step with via_connection_id == id), incl nested
                let mut steps_restore: Vec<(Id, Vec<Id>, usize, FlowStep)> = Vec::new();
                for (fid, flow) in doc.model.flows.iter() {
                    let mut found: Vec<(Vec<Id>, usize, FlowStep)> = Vec::new();
                    find_steps_via(&flow.steps, &id, &mut Vec::new(), &mut found);
                    for (path, idx, step) in found {
                        steps_restore.push((fid.clone(), path, idx, step));
                    }
                }
                // diagram entries showing it
                let mut conns_restore: Vec<(Id, EdgeLayout)> = Vec::new();
                for (did, d) in doc.diagrams.iter() {
                    if let Some(layout) = d.connections.get(&id) {
                        conns_restore.push((did.clone(), layout.clone()));
                    }
                }
                // mutate
                doc.model.connections.remove(&id);
                for (did, _) in &conns_restore {
                    if let Some(d) = doc.diagrams.get_mut(did) {
                        d.connections.remove(&id);
                    }
                }
                {
                    let mut ordered = steps_restore.clone();
                    ordered.sort_by(|a, b| {
                        b.1.len()
                            .cmp(&a.1.len())
                            .then_with(|| b.1.cmp(&a.1))
                            .then_with(|| b.2.cmp(&a.2))
                    });
                    for (fid, _, _, step) in ordered {
                        if let Some(flow) = doc.model.flows.get_mut(&fid) {
                            let _ = remove_step_from(&mut flow.steps, &step.id);
                        }
                    }
                }
                // inverse batch
                let mut inv = vec![Command::Connect { connection: conn }];
                conns_restore.sort_by(|a, b| a.0.cmp(&b.0));
                for (did, layout) in conns_restore {
                    inv.push(Command::ShowConnection {
                        diagram_id: did,
                        connection_id: id.clone(),
                        layout,
                    });
                }
                steps_restore.sort_by(|a, b| {
                    a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)).then_with(|| a.2.cmp(&b.2))
                });
                for (fid, path, idx, step) in steps_restore {
                    inv.push(Command::AddStep {
                        flow_id: fid,
                        path,
                        index: idx,
                        step,
                    });
                }
                Ok(Command::Batch { commands: inv })
            }
            Command::PatchConnection { id, patch } => {
                // validate endpoints/via if changed
                if let Some(o) = &patch.origin_id {
                    if !doc.model.objects.contains_key(o) {
                        return Err(CoreError::NotFound(o.clone()));
                    }
                }
                if let Some(t) = &patch.target_id {
                    if !doc.model.objects.contains_key(t) {
                        return Err(CoreError::NotFound(t.clone()));
                    }
                }
                if let Some(Some(vid)) = &patch.via_id {
                    if !doc.model.objects.contains_key(vid) {
                        return Err(CoreError::NotFound(vid.clone()));
                    }
                }
                let conn = doc
                    .model
                    .connections
                    .get_mut(&id)
                    .ok_or(CoreError::NotFound(id.clone()))?;
                let old = ConnectionPatch {
                    name: patch.name.as_ref().map(|_| conn.name.clone()),
                    description: patch.description.as_ref().map(|_| conn.description.clone()),
                    direction: patch.direction.as_ref().map(|_| conn.direction.clone()),
                    status: patch.status.as_ref().map(|_| conn.status.clone()),
                    line_shape: patch.line_shape.as_ref().map(|_| conn.line_shape.clone()),
                    label_position: patch
                        .label_position
                        .as_ref()
                        .map(|_| conn.label_position),
                    via_id: patch.via_id.as_ref().map(|_| conn.via_id.clone()),
                    tag_ids: patch.tag_ids.as_ref().map(|_| conn.tag_ids.clone()),
                    technologies: patch
                        .technologies
                        .as_ref()
                        .map(|_| conn.technologies.clone()),
                    links: patch.links.as_ref().map(|_| conn.links.clone()),
                    origin_id: patch.origin_id.as_ref().map(|_| conn.origin_id.clone()),
                    target_id: patch.target_id.as_ref().map(|_| conn.target_id.clone()),
                };
                if let Some(v) = patch.name {
                    conn.name = v;
                }
                if let Some(v) = patch.description {
                    conn.description = v;
                }
                if let Some(v) = patch.direction {
                    conn.direction = v;
                }
                if let Some(v) = patch.status {
                    conn.status = v;
                }
                if let Some(v) = patch.line_shape {
                    conn.line_shape = v;
                }
                if let Some(v) = patch.label_position {
                    conn.label_position = v;
                }
                if let Some(v) = patch.via_id {
                    conn.via_id = v;
                }
                if let Some(v) = patch.tag_ids {
                    conn.tag_ids = v;
                }
                if let Some(v) = patch.technologies {
                    conn.technologies = v;
                }
                if let Some(v) = patch.links {
                    conn.links = v;
                }
                if let Some(v) = patch.origin_id {
                    conn.origin_id = v;
                }
                if let Some(v) = patch.target_id {
                    conn.target_id = v;
                }
                Ok(Command::PatchConnection { id, patch: old })
            }
            Command::CreateTag { tag } => {
                if tag.id.is_empty() {
                    return Err(CoreError::Invalid("tag id is empty".to_string()));
                }
                if doc.model.tags.contains_key(&tag.id) {
                    return Err(CoreError::DuplicateId(tag.id));
                }
                let id = tag.id.clone();
                doc.model.tags.insert(id.clone(), tag);
                Ok(Command::DeleteTag { id })
            }
            Command::DeleteTag { id } => {
                let tag = doc
                    .model
                    .tags
                    .get(&id)
                    .cloned()
                    .ok_or(CoreError::NotFound(id.clone()))?;
                let mut obj_restore: Vec<(Id, Vec<Id>)> = Vec::new();
                for (oid, o) in doc.model.objects.iter() {
                    if o.tag_ids.contains(&id) {
                        obj_restore.push((oid.clone(), o.tag_ids.clone()));
                    }
                }
                let mut conn_restore: Vec<(Id, Vec<Id>)> = Vec::new();
                for (cid, c) in doc.model.connections.iter() {
                    if c.tag_ids.contains(&id) {
                        conn_restore.push((cid.clone(), c.tag_ids.clone()));
                    }
                }
                doc.model.tags.remove(&id);
                for (oid, _) in &obj_restore {
                    if let Some(o) = doc.model.objects.get_mut(oid) {
                        o.tag_ids.retain(|t| t != &id);
                    }
                }
                for (cid, _) in &conn_restore {
                    if let Some(c) = doc.model.connections.get_mut(cid) {
                        c.tag_ids.retain(|t| t != &id);
                    }
                }
                let mut inv = vec![Command::CreateTag { tag }];
                obj_restore.sort();
                for (oid, old) in obj_restore {
                    inv.push(Command::PatchObject {
                        id: oid,
                        patch: ObjectPatch {
                            tag_ids: Some(old),
                            ..Default::default()
                        },
                    });
                }
                conn_restore.sort();
                for (cid, old) in conn_restore {
                    inv.push(Command::PatchConnection {
                        id: cid,
                        patch: ConnectionPatch {
                            tag_ids: Some(old),
                            ..Default::default()
                        },
                    });
                }
                Ok(Command::Batch { commands: inv })
            }
            Command::PatchTag {
                id,
                name,
                color,
                group_id,
            } => {
                if let Some(Some(gid)) = &group_id {
                    if !doc.model.tag_groups.contains_key(gid) {
                        return Err(CoreError::NotFound(gid.clone()));
                    }
                }
                let t_name = name.is_some();
                let t_color = color.is_some();
                let t_group = group_id.is_some();
                let tag = doc
                    .model
                    .tags
                    .get_mut(&id)
                    .ok_or(CoreError::NotFound(id.clone()))?;
                let old_name = tag.name.clone();
                let old_color = tag.color.clone();
                let old_group = tag.group_id.clone();
                if let Some(v) = name {
                    tag.name = v;
                }
                if let Some(v) = color {
                    tag.color = v;
                }
                if let Some(v) = group_id {
                    tag.group_id = v;
                }
                Ok(Command::PatchTag {
                    id,
                    name: if t_name { Some(old_name) } else { None },
                    color: if t_color { Some(old_color) } else { None },
                    group_id: if t_group { Some(old_group) } else { None },
                })
            }
            Command::CreateTagGroup { group } => {
                if group.id.is_empty() {
                    return Err(CoreError::Invalid("tag group id is empty".to_string()));
                }
                if doc.model.tag_groups.contains_key(&group.id) {
                    return Err(CoreError::DuplicateId(group.id));
                }
                let id = group.id.clone();
                doc.model.tag_groups.insert(id.clone(), group);
                Ok(Command::DeleteTagGroup { id })
            }
            Command::DeleteTagGroup { id } => {
                let group = doc
                    .model
                    .tag_groups
                    .get(&id)
                    .cloned()
                    .ok_or(CoreError::NotFound(id.clone()))?;
                // tags in this group
                let mut tags_deleted: BTreeMap<Id, Tag> = BTreeMap::new();
                for (tid, t) in doc.model.tags.iter() {
                    if t.group_id.as_ref() == Some(&id) {
                        tags_deleted.insert(tid.clone(), t.clone());
                    }
                }
                let deleted_tag_ids: BTreeSet<Id> = tags_deleted.keys().cloned().collect();
                // refs to those tags
                let mut obj_restore: Vec<(Id, Vec<Id>)> = Vec::new();
                for (oid, o) in doc.model.objects.iter() {
                    if o.tag_ids.iter().any(|t| deleted_tag_ids.contains(t)) {
                        obj_restore.push((oid.clone(), o.tag_ids.clone()));
                    }
                }
                let mut conn_restore: Vec<(Id, Vec<Id>)> = Vec::new();
                for (cid, c) in doc.model.connections.iter() {
                    if c.tag_ids.iter().any(|t| deleted_tag_ids.contains(t)) {
                        conn_restore.push((cid.clone(), c.tag_ids.clone()));
                    }
                }
                // mutate
                for tid in deleted_tag_ids.iter() {
                    doc.model.tags.remove(tid);
                }
                doc.model.tag_groups.remove(&id);
                for (oid, _) in &obj_restore {
                    if let Some(o) = doc.model.objects.get_mut(oid) {
                        o.tag_ids.retain(|t| !deleted_tag_ids.contains(t));
                    }
                }
                for (cid, _) in &conn_restore {
                    if let Some(c) = doc.model.connections.get_mut(cid) {
                        c.tag_ids.retain(|t| !deleted_tag_ids.contains(t));
                    }
                }
                let mut inv = vec![Command::CreateTagGroup { group }];
                let mut tags_sorted: Vec<(Id, Tag)> = tags_deleted.into_iter().collect();
                tags_sorted.sort_by(|a, b| a.0.cmp(&b.0));
                for (_, t) in tags_sorted {
                    inv.push(Command::CreateTag { tag: t });
                }
                obj_restore.sort();
                for (oid, old) in obj_restore {
                    inv.push(Command::PatchObject {
                        id: oid,
                        patch: ObjectPatch {
                            tag_ids: Some(old),
                            ..Default::default()
                        },
                    });
                }
                conn_restore.sort();
                for (cid, old) in conn_restore {
                    inv.push(Command::PatchConnection {
                        id: cid,
                        patch: ConnectionPatch {
                            tag_ids: Some(old),
                            ..Default::default()
                        },
                    });
                }
                Ok(Command::Batch { commands: inv })
            }
            Command::CreateDomain { domain } => {
                if domain.id.is_empty() {
                    return Err(CoreError::Invalid("domain id is empty".to_string()));
                }
                if doc.model.domains.contains_key(&domain.id) {
                    return Err(CoreError::DuplicateId(domain.id));
                }
                let id = domain.id.clone();
                doc.model.domains.insert(id.clone(), domain);
                Ok(Command::DeleteDomain { id })
            }
            Command::DeleteDomain { id } => {
                let domain = doc
                    .model
                    .domains
                    .get(&id)
                    .cloned()
                    .ok_or(CoreError::NotFound(id.clone()))?;
                let mut obj_restore: Vec<(Id, Option<Id>)> = Vec::new();
                for (oid, o) in doc.model.objects.iter() {
                    if o.domain_id.as_ref() == Some(&id) {
                        obj_restore.push((oid.clone(), o.domain_id.clone()));
                    }
                }
                let mut diag_restore: Vec<(Id, Option<Id>)> = Vec::new();
                for (did, d) in doc.diagrams.iter() {
                    if d.domain_id.as_ref() == Some(&id) {
                        diag_restore.push((did.clone(), d.domain_id.clone()));
                    }
                }
                doc.model.domains.remove(&id);
                for (oid, _) in &obj_restore {
                    if let Some(o) = doc.model.objects.get_mut(oid) {
                        o.domain_id = None;
                    }
                }
                for (did, _) in &diag_restore {
                    if let Some(d) = doc.diagrams.get_mut(did) {
                        d.domain_id = None;
                    }
                }
                let mut inv = vec![Command::CreateDomain { domain }];
                obj_restore.sort();
                for (oid, old) in obj_restore {
                    inv.push(Command::PatchObject {
                        id: oid,
                        patch: ObjectPatch {
                            domain_id: Some(old),
                            ..Default::default()
                        },
                    });
                }
                diag_restore.sort();
                for (did, old) in diag_restore {
                    inv.push(Command::PatchDiagram {
                        id: did,
                        name: None,
                        description: None,
                        order: None,
                        pinned: None,
                        domain_id: Some(old),
                        auto_placed: None,
                        show_all_labels: None,
                    });
                }
                Ok(Command::Batch { commands: inv })
            }
            Command::CreateDiagram { diagram } => {
                if diagram.id.is_empty() {
                    return Err(CoreError::Invalid("diagram id is empty".to_string()));
                }
                if doc.diagrams.contains_key(&diagram.id) {
                    return Err(CoreError::DuplicateId(diagram.id));
                }
                if let Some(scope) = &diagram.scope_object_id {
                    if !doc.model.objects.contains_key(scope) {
                        return Err(CoreError::NotFound(scope.clone()));
                    }
                }
                // validate boxes/landing targets exist? allow dangling? strictly validate boxes:
                for bid in diagram.boxes.keys() {
                    if !doc.model.objects.contains_key(bid) {
                        return Err(CoreError::NotFound(bid.clone()));
                    }
                }
                for cid in diagram.connections.keys() {
                    if !doc.model.connections.contains_key(cid) {
                        return Err(CoreError::NotFound(cid.clone()));
                    }
                }
                let id = diagram.id.clone();
                doc.diagrams.insert(id.clone(), diagram);
                Ok(Command::DeleteDiagram { id })
            }
            Command::DeleteDiagram { id } => {
                let diagram = doc
                    .diagrams
                    .remove(&id)
                    .ok_or(CoreError::NotFound(id))?;
                // flows pointing at this diagram: clear
                let mut flow_restore: Vec<(Id, Option<Id>)> = Vec::new();
                for (fid, f) in doc.model.flows.iter() {
                    if f.diagram_id.as_ref() == Some(&diagram.id) {
                        flow_restore.push((fid.clone(), f.diagram_id.clone()));
                    }
                }
                // landings in other diagrams pointing at this diagram: remove
                let mut landing_restore: Vec<(Id, Id, Id)> = Vec::new();
                for (did, d) in doc.diagrams.iter() {
                    for (obj_id, target) in &d.landing {
                        if target == &diagram.id {
                            landing_restore.push((did.clone(), obj_id.clone(), target.clone()));
                        }
                    }
                }
                for (did, obj_id, _) in &landing_restore {
                    if let Some(d) = doc.diagrams.get_mut(did) {
                        d.landing.remove(obj_id);
                    }
                }
                for (fid, _) in &flow_restore {
                    if let Some(f) = doc.model.flows.get_mut(fid) {
                        f.diagram_id = None;
                    }
                }
                let mut inv = vec![Command::CreateDiagram { diagram }];
                landing_restore.sort();
                for (did, obj_id, target) in landing_restore {
                    inv.push(Command::SetLanding {
                        diagram_id: did,
                        object_id: obj_id,
                        target: Some(target),
                    });
                }
                flow_restore.sort();
                for (fid, old) in flow_restore {
                    inv.push(Command::PatchFlow {
                        id: fid,
                        name: None,
                        description: None,
                        pinned: None,
                        show_all_connection_names: None,
                        show_all_steps: None,
                        diagram_id: Some(old),
                    });
                }
                Ok(Command::Batch { commands: inv })
            }
            Command::PatchDiagram {
                id,
                name,
                description,
                order,
                pinned,
                domain_id,
                auto_placed,
                show_all_labels,
            } => {
                if let Some(Some(did)) = &domain_id {
                    if !doc.model.domains.contains_key(did) {
                        return Err(CoreError::NotFound(did.clone()));
                    }
                }
                let touched_name = name.is_some();
                let touched_desc = description.is_some();
                let touched_order = order.is_some();
                let touched_pinned = pinned.is_some();
                let touched_domain = domain_id.is_some();
                let touched_auto = auto_placed.is_some();
                let touched_labels = show_all_labels.is_some();
                let d = doc
                    .diagrams
                    .get_mut(&id)
                    .ok_or(CoreError::NotFound(id.clone()))?;
                let old_name = d.name.clone();
                let old_desc = d.description.clone();
                let old_order = d.order;
                let old_pinned = d.pinned;
                let old_domain = d.domain_id.clone();
                let old_auto = d.auto_placed;
                let old_labels = d.show_all_labels;
                if let Some(v) = name {
                    d.name = v;
                }
                if let Some(v) = description {
                    d.description = v;
                }
                if let Some(v) = order {
                    d.order = v;
                }
                if let Some(v) = pinned {
                    d.pinned = v;
                }
                if let Some(v) = domain_id {
                    d.domain_id = v;
                }
                if let Some(v) = auto_placed {
                    d.auto_placed = v;
                }
                if let Some(v) = show_all_labels {
                    d.show_all_labels = v;
                }
                Ok(Command::PatchDiagram {
                    id,
                    name: if touched_name { Some(old_name) } else { None },
                    description: if touched_desc { Some(old_desc) } else { None },
                    order: if touched_order { Some(old_order) } else { None },
                    pinned: if touched_pinned { Some(old_pinned) } else { None },
                    domain_id: if touched_domain { Some(old_domain) } else { None },
                    auto_placed: if touched_auto { Some(old_auto) } else { None },
                    show_all_labels: if touched_labels { Some(old_labels) } else { None },
                })
            }
            Command::AddToDiagram {
                diagram_id,
                object_id,
                rect,
            } => {
                let d = doc
                    .diagrams
                    .get(&diagram_id)
                    .ok_or(CoreError::NotFound(diagram_id.clone()))?;
                if !doc.model.objects.contains_key(&object_id) {
                    return Err(CoreError::NotFound(object_id));
                }
                // A diagram scoped to object X must not show X itself as a
                // box; the UI draws the scope FRAME instead (M5).
                if d.scope_object_id.as_ref() == Some(&object_id) {
                    return Err(CoreError::Invalid(format!(
                        "cannot add scope object '{object_id}' to its own diagram '{diagram_id}'"
                    )));
                }
                let old_boxes = doc
                    .diagrams
                    .get(&diagram_id)
                    .map(|d| d.boxes.clone())
                    .unwrap_or_default();
                if let Some(d) = doc.diagrams.get_mut(&diagram_id) {
                    d.boxes.insert(object_id, rect);
                }
                Ok(Command::ApplyLayout {
                    diagram_id,
                    boxes: old_boxes,
                })
            }
            Command::RemoveFromDiagram {
                diagram_id,
                object_id,
            } => {
                let d = doc
                    .diagrams
                    .get(&diagram_id)
                    .ok_or(CoreError::NotFound(diagram_id.clone()))?;
                if !d.boxes.contains_key(&object_id) {
                    return Err(CoreError::NotFound(object_id));
                }
                let rect = d.boxes.get(&object_id).cloned().unwrap_or(Rect {
                    x: 0.0,
                    y: 0.0,
                    w: 0.0,
                    h: 0.0,
                });
                // connections touching the object shown on this diagram
                let mut dropped: Vec<(Id, EdgeLayout)> = Vec::new();
                for (cid, layout) in &d.connections {
                    if let Some(conn) = doc.model.connections.get(cid) {
                        if conn.origin_id == object_id || conn.target_id == object_id {
                            dropped.push((cid.clone(), layout.clone()));
                        }
                    }
                }
                // Undo for the scope object itself cannot be AddToDiagram
                // (rejected since M5); restore the whole box map instead.
                let is_scope = d.scope_object_id.as_ref() == Some(&object_id);
                let old_boxes = d.boxes.clone();
                if let Some(dd) = doc.diagrams.get_mut(&diagram_id) {
                    dd.boxes.remove(&object_id);
                    for (cid, _) in &dropped {
                        dd.connections.remove(cid);
                    }
                }
                let mut inv: Vec<Command> = vec![if is_scope {
                    Command::ApplyLayout {
                        diagram_id: diagram_id.clone(),
                        boxes: old_boxes,
                    }
                } else {
                    Command::AddToDiagram {
                        diagram_id: diagram_id.clone(),
                        object_id: object_id.clone(),
                        rect,
                    }
                }];
                dropped.sort_by(|a, b| a.0.cmp(&b.0));
                for (cid, layout) in dropped {
                    inv.push(Command::ShowConnection {
                        diagram_id: diagram_id.clone(),
                        connection_id: cid,
                        layout,
                    });
                }
                Ok(Command::Batch { commands: inv })
            }
            Command::MoveBoxes { diagram_id, moves } => {
                let d = doc
                    .diagrams
                    .get(&diagram_id)
                    .ok_or(CoreError::NotFound(diagram_id.clone()))?;
                let old_boxes = d.boxes.clone();
                if let Some(dd) = doc.diagrams.get_mut(&diagram_id) {
                    for (bid, r) in moves {
                        dd.boxes.insert(bid, r);
                    }
                }
                Ok(Command::ApplyLayout {
                    diagram_id,
                    boxes: old_boxes,
                })
            }
            Command::ApplyLayout { diagram_id, boxes } => {
                let d = doc
                    .diagrams
                    .get(&diagram_id)
                    .ok_or(CoreError::NotFound(diagram_id.clone()))?;
                let old = d.boxes.clone();
                if let Some(dd) = doc.diagrams.get_mut(&diagram_id) {
                    dd.boxes = boxes;
                }
                Ok(Command::ApplyLayout {
                    diagram_id,
                    boxes: old,
                })
            }
            Command::ShowConnection {
                diagram_id,
                connection_id,
                layout,
            } => {
                if !doc.diagrams.contains_key(&diagram_id) {
                    return Err(CoreError::NotFound(diagram_id));
                }
                if !doc.model.connections.contains_key(&connection_id) {
                    return Err(CoreError::NotFound(connection_id));
                }
                let old = doc
                    .diagrams
                    .get(&diagram_id)
                    .and_then(|d| d.connections.get(&connection_id).cloned());
                if let Some(d) = doc.diagrams.get_mut(&diagram_id) {
                    d.connections.insert(connection_id.clone(), layout);
                }
                match old {
                    Some(old_layout) => Ok(Command::ShowConnection {
                        diagram_id,
                        connection_id,
                        layout: old_layout,
                    }),
                    None => Ok(Command::HideConnection {
                        diagram_id,
                        connection_id,
                    }),
                }
            }
            Command::HideConnection {
                diagram_id,
                connection_id,
            } => {
                let d = doc
                    .diagrams
                    .get(&diagram_id)
                    .ok_or(CoreError::NotFound(diagram_id.clone()))?;
                let old = d
                    .connections
                    .get(&connection_id)
                    .cloned()
                    .ok_or(CoreError::NotFound(connection_id.clone()))?;
                if let Some(dd) = doc.diagrams.get_mut(&diagram_id) {
                    dd.connections.remove(&connection_id);
                }
                Ok(Command::ShowConnection {
                    diagram_id,
                    connection_id,
                    layout: old,
                })
            }
            Command::SetLanding {
                diagram_id,
                object_id,
                target,
            } => {
                if !doc.diagrams.contains_key(&diagram_id) {
                    return Err(CoreError::NotFound(diagram_id));
                }
                if !doc.model.objects.contains_key(&object_id) {
                    return Err(CoreError::NotFound(object_id.clone()));
                }
                if let Some(t) = &target {
                    if !doc.diagrams.contains_key(t) {
                        return Err(CoreError::NotFound(t.clone()));
                    }
                }
                let old = doc
                    .diagrams
                    .get(&diagram_id)
                    .and_then(|d| d.landing.get(&object_id).cloned());
                if let Some(d) = doc.diagrams.get_mut(&diagram_id) {
                    match target {
                        Some(t) => {
                            d.landing.insert(object_id.clone(), t);
                        }
                        None => {
                            d.landing.remove(&object_id);
                        }
                    }
                }
                Ok(Command::SetLanding {
                    diagram_id,
                    object_id,
                    target: old,
                })
            }
            Command::SetViewport {
                diagram_id,
                viewport,
            } => {
                let d = doc
                    .diagrams
                    .get(&diagram_id)
                    .ok_or(CoreError::NotFound(diagram_id.clone()))?;
                let old = d.viewport.clone();
                if let Some(dd) = doc.diagrams.get_mut(&diagram_id) {
                    dd.viewport = viewport;
                }
                Ok(Command::SetViewport {
                    diagram_id,
                    viewport: old,
                })
            }
            Command::CreateFlow { flow } => {
                if flow.id.is_empty() {
                    return Err(CoreError::Invalid("flow id is empty".to_string()));
                }
                if doc.model.flows.contains_key(&flow.id) {
                    return Err(CoreError::DuplicateId(flow.id));
                }
                if let Some(did) = &flow.diagram_id {
                    if !doc.diagrams.contains_key(did) {
                        return Err(CoreError::NotFound(did.clone()));
                    }
                }
                let id = flow.id.clone();
                doc.model.flows.insert(id.clone(), flow);
                Ok(Command::DeleteFlow { id })
            }
            Command::DeleteFlow { id } => {
                let flow = doc
                    .model
                    .flows
                    .remove(&id)
                    .ok_or(CoreError::NotFound(id.clone()))?;
                // steps in other flows with go_to_flow == id must be removed? Spec doesn't
                // say, but to keep validate clean we remove them (nested too).
                let mut steps_restore: Vec<(Id, Vec<Id>, usize, FlowStep)> = Vec::new();
                for (fid, f) in doc.model.flows.iter() {
                    let mut found = Vec::new();
                    find_steps_goto(&f.steps, &id, &mut Vec::new(), &mut found);
                    for (path, idx, step) in found {
                        steps_restore.push((fid.clone(), path, idx, step));
                    }
                }
                {
                    let mut ordered = steps_restore.clone();
                    ordered.sort_by(|a, b| {
                        b.1.len()
                            .cmp(&a.1.len())
                            .then_with(|| b.1.cmp(&a.1))
                            .then_with(|| b.2.cmp(&a.2))
                    });
                    for (fid, _, _, step) in ordered {
                        if let Some(flow) = doc.model.flows.get_mut(&fid) {
                            let _ = remove_step_from(&mut flow.steps, &step.id);
                        }
                    }
                }
                let mut inv = vec![Command::CreateFlow { flow }];
                steps_restore.sort_by(|a, b| {
                    a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)).then_with(|| a.2.cmp(&b.2))
                });
                for (fid, path, idx, step) in steps_restore {
                    inv.push(Command::AddStep {
                        flow_id: fid,
                        path,
                        index: idx,
                        step,
                    });
                }
                Ok(Command::Batch { commands: inv })
            }
            Command::PatchFlow {
                id,
                name,
                description,
                pinned,
                show_all_connection_names,
                show_all_steps,
                diagram_id,
            } => {
                if let Some(Some(did)) = &diagram_id {
                    if !doc.diagrams.contains_key(did) {
                        return Err(CoreError::NotFound(did.clone()));
                    }
                }
                let t_name = name.is_some();
                let t_desc = description.is_some();
                let t_pinned = pinned.is_some();
                let t_names = show_all_connection_names.is_some();
                let t_steps = show_all_steps.is_some();
                let t_diag = diagram_id.is_some();
                let f = doc
                    .model
                    .flows
                    .get_mut(&id)
                    .ok_or(CoreError::NotFound(id.clone()))?;
                let o_name = f.name.clone();
                let o_desc = f.description.clone();
                let o_pinned = f.pinned;
                let o_names = f.show_all_connection_names;
                let o_steps = f.show_all_steps;
                let o_diag = f.diagram_id.clone();
                if let Some(v) = name {
                    f.name = v;
                }
                if let Some(v) = description {
                    f.description = v;
                }
                if let Some(v) = pinned {
                    f.pinned = v;
                }
                if let Some(v) = show_all_connection_names {
                    f.show_all_connection_names = v;
                }
                if let Some(v) = show_all_steps {
                    f.show_all_steps = v;
                }
                if let Some(v) = diagram_id {
                    f.diagram_id = v;
                }
                Ok(Command::PatchFlow {
                    id,
                    name: if t_name { Some(o_name) } else { None },
                    description: if t_desc { Some(o_desc) } else { None },
                    pinned: if t_pinned { Some(o_pinned) } else { None },
                    show_all_connection_names: if t_names { Some(o_names) } else { None },
                    show_all_steps: if t_steps { Some(o_steps) } else { None },
                    diagram_id: if t_diag { Some(o_diag) } else { None },
                })
            }
            Command::AddStep {
                flow_id,
                path,
                index,
                step,
            } => {
                if !doc.model.flows.contains_key(&flow_id) {
                    return Err(CoreError::NotFound(flow_id));
                }
                // check duplicate step id anywhere in flow
                {
                    let flow = &doc.model.flows[&flow_id];
                    if step_id_exists(&flow.steps, &step.id) {
                        return Err(CoreError::DuplicateId(step.id));
                    }
                }
                let flow = doc
                    .model
                    .flows
                    .get_mut(&flow_id)
                    .ok_or(CoreError::NotFound(flow_id.clone()))?;
                let container = steps_container_mut(&mut flow.steps, &path)
                    .ok_or(CoreError::NotFound(path.first().cloned().unwrap_or_default()))?;
                if index > container.len() {
                    return Err(CoreError::InvalidIndex);
                }
                let step_id = step.id.clone();
                container.insert(index, step);
                Ok(Command::DeleteStep {
                    flow_id,
                    step_id,
                })
            }
            Command::PatchStep {
                flow_id,
                step_id,
                title,
                description,
                kind,
                reversed,
                origin_id,
                target_id,
                via_connection_id,
                object_id,
                go_to_flow_id,
            } => {
                // validate refs if set to Some
                if let Some(Some(oid)) = &origin_id {
                    if !doc.model.objects.contains_key(oid) {
                        return Err(CoreError::NotFound(oid.clone()));
                    }
                }
                if let Some(Some(tid)) = &target_id {
                    if !doc.model.objects.contains_key(tid) {
                        return Err(CoreError::NotFound(tid.clone()));
                    }
                }
                if let Some(Some(cid)) = &via_connection_id {
                    if !doc.model.connections.contains_key(cid) {
                        return Err(CoreError::NotFound(cid.clone()));
                    }
                }
                if let Some(Some(oid)) = &object_id {
                    if !doc.model.objects.contains_key(oid) {
                        return Err(CoreError::NotFound(oid.clone()));
                    }
                }
                if let Some(Some(gid)) = &go_to_flow_id {
                    if !doc.model.flows.contains_key(gid) {
                        return Err(CoreError::NotFound(gid.clone()));
                    }
                }
                let t_title = title.is_some();
                let t_desc = description.is_some();
                let t_kind = kind.is_some();
                let t_rev = reversed.is_some();
                let t_orig = origin_id.is_some();
                let t_targ = target_id.is_some();
                let t_via = via_connection_id.is_some();
                let t_obj = object_id.is_some();
                let t_goto = go_to_flow_id.is_some();
                let flow = doc
                    .model
                    .flows
                    .get_mut(&flow_id)
                    .ok_or(CoreError::NotFound(flow_id.clone()))?;
                let st = find_step_mut(&mut flow.steps, &step_id)
                    .ok_or(CoreError::NotFound(step_id.clone()))?;
                let o_title = st.title.clone();
                let o_desc = st.description.clone();
                let o_kind = st.kind.clone();
                let o_rev = st.reversed;
                let o_orig = st.origin_id.clone();
                let o_targ = st.target_id.clone();
                let o_via = st.via_connection_id.clone();
                let o_obj = st.object_id.clone();
                let o_goto = st.go_to_flow_id.clone();
                if let Some(v) = title {
                    st.title = v;
                }
                if let Some(v) = description {
                    st.description = v;
                }
                if let Some(v) = kind {
                    st.kind = v;
                }
                if let Some(v) = reversed {
                    st.reversed = v;
                }
                if let Some(v) = origin_id {
                    st.origin_id = v;
                }
                if let Some(v) = target_id {
                    st.target_id = v;
                }
                if let Some(v) = via_connection_id {
                    st.via_connection_id = v;
                }
                if let Some(v) = object_id {
                    st.object_id = v;
                }
                if let Some(v) = go_to_flow_id {
                    st.go_to_flow_id = v;
                }
                Ok(Command::PatchStep {
                    flow_id,
                    step_id,
                    title: if t_title { Some(o_title) } else { None },
                    description: if t_desc { Some(o_desc) } else { None },
                    kind: if t_kind { Some(o_kind) } else { None },
                    reversed: if t_rev { Some(o_rev) } else { None },
                    origin_id: if t_orig { Some(o_orig) } else { None },
                    target_id: if t_targ { Some(o_targ) } else { None },
                    via_connection_id: if t_via { Some(o_via) } else { None },
                    object_id: if t_obj { Some(o_obj) } else { None },
                    go_to_flow_id: if t_goto { Some(o_goto) } else { None },
                })
            }
            Command::MoveStep {
                flow_id,
                step_id,
                to_path,
                to_index,
            } => {
                if !doc.model.flows.contains_key(&flow_id) {
                    return Err(CoreError::NotFound(flow_id));
                }
                // validate dest path exists
                {
                    let flow = &doc.model.flows[&flow_id];
                    if steps_container(&flow.steps, &to_path).is_none() {
                        return Err(CoreError::NotFound(
                            to_path.first().cloned().unwrap_or_default(),
                        ));
                    }
                    if locate_step_in_flow(flow, &step_id).is_none() {
                        return Err(CoreError::NotFound(step_id));
                    }
                }
                let flow = doc
                    .model
                    .flows
                    .get_mut(&flow_id)
                    .ok_or(CoreError::NotFound(flow_id.clone()))?;
                let (from_path, from_index) =
                    locate_step_in_flow(flow, &step_id).ok_or(CoreError::NotFound(step_id.clone()))?;
                if from_path == to_path && from_index == to_index {
                    // no-op: inverse is itself
                    return Ok(Command::MoveStep {
                        flow_id,
                        step_id,
                        to_path: from_path,
                        to_index: from_index,
                    });
                }
                let (_, _, step) = remove_step_from(&mut flow.steps, &step_id)
                    .ok_or(CoreError::NotFound(step_id.clone()))?;
                // re-borrow container (path may have shifted? paths are by id so still valid
                // unless we removed an ancestor — but step ids unique, moving a step that
                // contains the destination path would be invalid; detect: if to_path contains
                // a path id inside the moved step, reject.
                if path_inside_step(&step, &to_path) {
                    // restore
                    let container = steps_container_mut(&mut flow.steps, &from_path)
                        .ok_or(CoreError::Invalid("move into own subtree".to_string()))?;
                    let idx = from_index.min(container.len());
                    container.insert(idx, step);
                    return Err(CoreError::Invalid("cannot move step into itself".to_string()));
                }
                let dest = steps_container_mut(&mut flow.steps, &to_path)
                    .ok_or(CoreError::NotFound(to_path.first().cloned().unwrap_or_default()))?;
                if to_index > dest.len() {
                    // restore original
                    let container = steps_container_mut(&mut flow.steps, &from_path)
                        .ok_or(CoreError::InvalidIndex)?;
                    let idx = from_index.min(container.len());
                    container.insert(idx, step);
                    return Err(CoreError::InvalidIndex);
                }
                dest.insert(to_index, step);
                Ok(Command::MoveStep {
                    flow_id,
                    step_id,
                    to_path: from_path,
                    to_index: from_index,
                })
            }
            Command::DeleteStep { flow_id, step_id } => {
                let flow = doc
                    .model
                    .flows
                    .get_mut(&flow_id)
                    .ok_or(CoreError::NotFound(flow_id.clone()))?;
                let (path, idx, step) = remove_step_from(&mut flow.steps, &step_id)
                    .ok_or(CoreError::NotFound(step_id))?;
                Ok(Command::AddStep {
                    flow_id,
                    path,
                    index: idx,
                    step,
                })
            }
            Command::AddPath {
                flow_id,
                step_id,
                path,
            } => {
                let flow = doc
                    .model
                    .flows
                    .get_mut(&flow_id)
                    .ok_or(CoreError::NotFound(flow_id.clone()))?;
                let st = find_step_mut(&mut flow.steps, &step_id)
                    .ok_or(CoreError::NotFound(step_id.clone()))?;
                if st.paths.iter().any(|p| p.id == path.id) {
                    return Err(CoreError::DuplicateId(path.id));
                }
                let path_id = path.id.clone();
                st.paths.push(path);
                Ok(Command::DeletePath {
                    flow_id,
                    step_id,
                    path_id,
                })
            }
            Command::DeletePath {
                flow_id,
                step_id,
                path_id,
            } => {
                let flow = doc
                    .model
                    .flows
                    .get_mut(&flow_id)
                    .ok_or(CoreError::NotFound(flow_id.clone()))?;
                let st = find_step_mut(&mut flow.steps, &step_id)
                    .ok_or(CoreError::NotFound(step_id.clone()))?;
                let pos = st
                    .paths
                    .iter()
                    .position(|p| p.id == path_id)
                    .ok_or(CoreError::NotFound(path_id.clone()))?;
                let removed = st.paths.remove(pos);
                // Build inverse that restores exact order: delete trailing paths,
                // re-add removed + trailing.
                let trailing: Vec<FlowPath> = st.paths[pos..].to_vec();
                let mut inv: Vec<Command> = Vec::new();
                for t in trailing.iter().rev() {
                    inv.push(Command::DeletePath {
                        flow_id: flow_id.clone(),
                        step_id: step_id.clone(),
                        path_id: t.id.clone(),
                    });
                }
                inv.push(Command::AddPath {
                    flow_id: flow_id.clone(),
                    step_id: step_id.clone(),
                    path: removed,
                });
                for t in trailing {
                    inv.push(Command::AddPath {
                        flow_id: flow_id.clone(),
                        step_id: step_id.clone(),
                        path: t,
                    });
                }
                // If deleted was last, inv is single AddPath (exact). Otherwise multi-step.
                if inv.len() == 1 {
                    Ok(inv.into_iter().next().unwrap())
                } else {
                    Ok(Command::Batch { commands: inv })
                }
            }
            Command::Batch { commands } => {
                let mut tmp = doc.clone();
                let mut inverses: Vec<Command> = Vec::new();
                for c in commands {
                    inverses.push(c.apply(&mut tmp)?);
                }
                *doc = tmp;
                inverses.reverse();
                Ok(Command::Batch {
                    commands: inverses,
                })
            }
        }
    }
}

fn ancestor_len_in_map(
    obj: &Object,
    removed: &BTreeSet<Id>,
    map: &BTreeMap<Id, Object>,
) -> usize {
    let mut n = 0;
    let mut cur = obj.parent_id.clone();
    let mut guard = 0;
    while let Some(pid) = cur {
        if !removed.contains(&pid) {
            break;
        }
        n += 1;
        cur = map.get(&pid).and_then(|o| o.parent_id.clone());
        guard += 1;
        if guard > 10000 {
            break;
        }
    }
    n
}

fn find_step_mut<'a>(steps: &'a mut [FlowStep], id: &Id) -> Option<&'a mut FlowStep> {
    for s in steps.iter_mut() {
        if &s.id == id {
            return Some(s);
        }
        for p in s.paths.iter_mut() {
            if let Some(f) = find_step_mut(&mut p.steps, id) {
                return Some(f);
            }
        }
    }
    None
}

fn path_inside_step(step: &FlowStep, path: &[Id]) -> bool {
    // true if any id in path is a FlowPath id inside step's subtree
    for pid in path {
        if path_id_exists(&step.paths, pid) {
            return true;
        }
    }
    false
}

fn path_id_exists(paths: &[FlowPath], pid: &Id) -> bool {
    for p in paths {
        if &p.id == pid {
            return true;
        }
        for s in &p.steps {
            if path_id_exists(&s.paths, pid) {
                return true;
            }
        }
    }
    false
}

fn find_steps_via(
    steps: &[FlowStep],
    conn_id: &Id,
    trail: &mut Vec<Id>,
    out: &mut Vec<(Vec<Id>, usize, FlowStep)>,
) {
    for (i, s) in steps.iter().enumerate() {
        if s.via_connection_id.as_ref() == Some(conn_id) {
            out.push((trail.clone(), i, s.clone()));
        }
        for p in &s.paths {
            trail.push(p.id.clone());
            find_steps_via(&p.steps, conn_id, trail, out);
            trail.pop();
        }
    }
}

fn find_steps_goto(
    steps: &[FlowStep],
    flow_id: &Id,
    trail: &mut Vec<Id>,
    out: &mut Vec<(Vec<Id>, usize, FlowStep)>,
) {
    for (i, s) in steps.iter().enumerate() {
        if s.go_to_flow_id.as_ref() == Some(flow_id) {
            out.push((trail.clone(), i, s.clone()));
        }
        for p in &s.paths {
            trail.push(p.id.clone());
            find_steps_goto(&p.steps, flow_id, trail, out);
            trail.pop();
        }
    }
}

// ---------------------------------------------------------------------------
// intelligent_step
// ---------------------------------------------------------------------------

/// Build a sensible new flow step from the current selection.
///
/// - one connection selected -> Message step with origin/target/via + title = connection name
/// - two objects selected that share a connection -> Message using it
///   (reversed if selected in the opposite order)
/// - one object selected -> Process step titled with the object name
pub fn intelligent_step(doc: &Document, _flow_id: &Id, selection: &[Id]) -> Option<FlowStep> {
    if selection.len() == 1 {
        let sel = &selection[0];
        if let Some(conn) = doc.model.connections.get(sel) {
            return Some(FlowStep {
                id: String::new(),
                kind: StepKind::Message,
                title: conn.name.clone(),
                description: String::new(),
                origin_id: Some(conn.origin_id.clone()),
                target_id: Some(conn.target_id.clone()),
                via_connection_id: Some(conn.id.clone()),
                reversed: false,
                object_id: None,
                go_to_flow_id: None,
                paths: Vec::new(),
                extra: BTreeMap::new(),
            });
        }
        if let Some(obj) = doc.model.objects.get(sel) {
            return Some(FlowStep {
                id: String::new(),
                kind: StepKind::Process,
                title: obj.name.clone(),
                description: String::new(),
                origin_id: None,
                target_id: None,
                via_connection_id: None,
                reversed: false,
                object_id: Some(obj.id.clone()),
                go_to_flow_id: None,
                paths: Vec::new(),
                extra: BTreeMap::new(),
            });
        }
        return None;
    }
    if selection.len() == 2 {
        let a = &selection[0];
        let b = &selection[1];
        if !doc.model.objects.contains_key(a) || !doc.model.objects.contains_key(b) {
            return None;
        }
        // connections between a and b, sorted by id
        let mut candidates: Vec<&Connection> = doc
            .model
            .connections
            .values()
            .filter(|c| {
                (&c.origin_id == a && &c.target_id == b)
                    || (&c.origin_id == b && &c.target_id == a)
            })
            .collect();
        candidates.sort_by(|x, y| x.id.cmp(&y.id));
        let conn = candidates.into_iter().next()?;
        let reversed = !(conn.origin_id == *a && conn.target_id == *b);
        return Some(FlowStep {
            id: String::new(),
            kind: StepKind::Message,
            title: conn.name.clone(),
            description: String::new(),
            origin_id: Some(a.clone()),
            target_id: Some(b.clone()),
            via_connection_id: Some(conn.id.clone()),
            reversed,
            object_id: None,
            go_to_flow_id: None,
            paths: Vec::new(),
            extra: BTreeMap::new(),
        });
    }
    None
}
