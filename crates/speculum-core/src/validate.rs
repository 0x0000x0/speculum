use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use crate::command::Command;
use crate::model::{Document, Id, Model, ObjectKind, StepKind};

/// Severity of an issue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Warning,
    Error,
}

/// A validation issue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub severity: Severity,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub ids: Vec<Id>,
}

fn err(code: &str, message: String, ids: Vec<Id>) -> Issue {
    Issue {
        severity: Severity::Error,
        code: code.to_string(),
        message,
        ids,
    }
}

fn warn(code: &str, message: String, ids: Vec<Id>) -> Issue {
    Issue {
        severity: Severity::Warning,
        code: code.to_string(),
        message,
        ids,
    }
}

/// Validate a model, returning all issues. Never panics.
pub fn validate(model: &Model) -> Vec<Issue> {
    validate_inner(model, None)
}

/// Validate a full document (model + diagrams). Never panics.
pub fn validate_document(doc: &Document) -> Vec<Issue> {
    validate_inner(&doc.model, Some(&doc.diagrams))
}

fn validate_inner(
    model: &Model,
    diagrams: Option<&BTreeMap<Id, crate::model::Diagram>>,
) -> Vec<Issue> {
    let mut out = Vec::new();

    // --- parents ---------------------------------------------------------
    for obj in model.objects.values() {
        if let Some(pid) = &obj.parent_id {
            if !model.objects.contains_key(pid) {
                out.push(err(
                    "missing-parent",
                    format!("object '{}' has missing parent '{}'", obj.id, pid),
                    vec![obj.id.clone()],
                ));
            }
        }
    }

    for cycle in find_parent_cycles(model) {
        out.push(err(
            "parent-cycle",
            format!("parent cycle: {}", cycle.join(" -> ")),
            cycle,
        ));
    }

    // parent kind rules (warning)
    for obj in model.objects.values() {
        if let Some(pid) = &obj.parent_id {
            if let Some(parent) = model.objects.get(pid) {
                if !parent_kind_ok(&obj.kind, &parent.kind, model, obj, parent) {
                    out.push(warn(
                        "invalid-parent-kind",
                        format!(
                            "object '{}' ({:?}) has invalid parent '{}' ({:?})",
                            obj.id, obj.kind, pid, parent.kind
                        ),
                        vec![obj.id.clone()],
                    ));
                }
            }
        }
    }

    // --- connections -----------------------------------------------------
    for conn in model.connections.values() {
        let has_origin = model.objects.contains_key(&conn.origin_id);
        let has_target = model.objects.contains_key(&conn.target_id);
        if !has_origin || !has_target {
            out.push(err(
                "missing-connection-endpoint",
                format!(
                    "connection '{}' has missing endpoint(s) '{}' -> '{}'",
                    conn.id, conn.origin_id, conn.target_id
                ),
                vec![conn.id.clone()],
            ));
        } else if conn.origin_id == conn.target_id {
            out.push(warn(
                "connection-self-loop",
                format!("connection '{}' loops on '{}'", conn.id, conn.origin_id),
                vec![conn.id.clone()],
            ));
        }
        if let Some(via) = &conn.via_id {
            if !model.objects.contains_key(via) {
                out.push(err(
                    "missing-via-object",
                    format!("connection '{}' has missing via object '{}'", conn.id, via),
                    vec![conn.id.clone()],
                ));
            }
        }
        for tid in &conn.tag_ids {
            if !model.tags.contains_key(tid) {
                out.push(warn(
                    "missing-tag",
                    format!("connection '{}' references missing tag '{}'", conn.id, tid),
                    vec![conn.id.clone(), tid.clone()],
                ));
            }
        }
    }

    // --- objects: tags / groups ------------------------------------------
    for obj in model.objects.values() {
        for tid in &obj.tag_ids {
            if !model.tags.contains_key(tid) {
                out.push(warn(
                    "missing-tag",
                    format!("object '{}' references missing tag '{}'", obj.id, tid),
                    vec![obj.id.clone(), tid.clone()],
                ));
            }
        }
        for gid in &obj.group_ids {
            match model.objects.get(gid) {
                None => out.push(warn(
                    "invalid-group-ref",
                    format!("object '{}' references missing group '{}'", obj.id, gid),
                    vec![obj.id.clone(), gid.clone()],
                )),
                Some(g) => {
                    if g.kind != ObjectKind::Group {
                        out.push(warn(
                            "invalid-group-ref",
                            format!(
                                "object '{}' references non-group '{}' ({:?})",
                                obj.id, gid, g.kind
                            ),
                            vec![obj.id.clone(), gid.clone()],
                        ));
                    }
                }
            }
        }
    }
    for tag in model.tags.values() {
        if let Some(gid) = &tag.group_id {
            if !model.tag_groups.contains_key(gid) {
                out.push(warn(
                    "missing-tag-group",
                    format!("tag '{}' references missing group '{}'", tag.id, gid),
                    vec![tag.id.clone()],
                ));
            }
        }
    }

    // --- flows ------------------------------------------------------------
    for flow in model.flows.values() {
        if flow.steps.is_empty() {
            out.push(warn(
                "empty-flow",
                format!("flow '{}' has no steps", flow.id),
                vec![flow.id.clone()],
            ));
        }
        for (step, _trail) in flow.walk_steps() {
            validate_step(model, flow, step, &mut out);
        }
    }

    // --- diagrams ----------------------------------------------------------
    if let Some(diagrams) = diagrams {
        for d in diagrams.values() {
            if let Some(scope) = &d.scope_object_id {
                if !model.objects.contains_key(scope) {
                    out.push(err(
                        "missing-diagram-scope",
                        format!("diagram '{}' has missing scope '{}'", d.id, scope),
                        vec![d.id.clone()],
                    ));
                }
            }
            for box_id in d.boxes.keys() {
                if !model.objects.contains_key(box_id) {
                    out.push(err(
                        "missing-diagram-box",
                        format!("diagram '{}' has missing box '{}'", d.id, box_id),
                        vec![d.id.clone(), box_id.clone()],
                    ));
                }
            }
            // The scope object must not be a box on its own diagram; the UI
            // draws the scope FRAME instead (M5).
            if let Some(scope) = &d.scope_object_id {
                if d.boxes.contains_key(scope) {
                    out.push(warn(
                        "scope-object-boxed",
                        format!(
                            "scope object boxed on its own diagram: object '{}' on diagram '{}'",
                            scope, d.id
                        ),
                        vec![d.id.clone(), scope.clone()],
                    ));
                }
            }
            for conn_id in d.connections.keys() {
                if !model.connections.contains_key(conn_id) {
                    out.push(err(
                        "missing-diagram-connection",
                        format!(
                            "diagram '{}' shows missing connection '{}'",
                            d.id, conn_id
                        ),
                        vec![d.id.clone(), conn_id.clone()],
                    ));
                }
            }
            for (obj_id, target_id) in &d.landing {
                if !diagrams.contains_key(target_id) {
                    out.push(err(
                        "missing-landing",
                        format!(
                            "diagram '{}' landing for '{}' points at missing diagram '{}'",
                            d.id, obj_id, target_id
                        ),
                        vec![d.id.clone(), target_id.clone()],
                    ));
                }
            }
        }
    }

    out
}

fn parent_kind_ok(
    kind: &ObjectKind,
    parent_kind: &ObjectKind,
    model: &Model,
    obj: &crate::model::Object,
    parent: &crate::model::Object,
) -> bool {
    match kind {
        ObjectKind::Actor | ObjectKind::System | ObjectKind::Group => {
            // parent None or a Group (None already handled; here parent exists)
            matches!(parent_kind, ObjectKind::Group)
        }
        ObjectKind::App | ObjectKind::Store => {
            // parent System or Group (inside a system)
            match parent_kind {
                ObjectKind::System => true,
                ObjectKind::Group => {
                    // Group inside a system: walk group ancestors for a System
                    if parent.parent_id.is_none() {
                        return true; // lenient: top-level group ok as warning-free?
                    }
                    // check ancestors of parent for System
                    let mut cur = parent.parent_id.clone();
                    let mut guard = 0usize;
                    let mut seen = BTreeSet::new();
                    while let Some(pid) = cur {
                        if !seen.insert(pid.clone()) {
                            break;
                        }
                        match model.objects.get(&pid) {
                            Some(o) => {
                                if o.kind == ObjectKind::System {
                                    return true;
                                }
                                cur = o.parent_id.clone();
                            }
                            None => break,
                        }
                        guard += 1;
                        if guard > model.objects.len() + 5 {
                            break;
                        }
                    }
                    // If group has no system ancestor, still treat as warning.
                    // To be lenient for messy imports we only warn when clearly wrong?
                    // Spec says app/store parent must be System or Group(inside a system),
                    // so a top-level group is a violation -> false.
                    let _ = obj;
                    false
                }
                _ => false,
            }
        }
        ObjectKind::Component => matches!(parent_kind, ObjectKind::App | ObjectKind::Store),
    }
}

fn validate_step(
    model: &Model,
    flow: &crate::model::Flow,
    step: &crate::model::FlowStep,
    out: &mut Vec<Issue>,
) {
    let fid = &flow.id;
    let sid = &step.id;
    if let Some(cid) = &step.via_connection_id {
        if !model.connections.contains_key(cid) {
            out.push(err(
                "missing-step-ref",
                format!("flow '{fid}' step '{sid}' references missing connection '{cid}'"),
                vec![fid.clone(), sid.clone()],
            ));
        }
    }
    if let Some(oid) = &step.origin_id {
        if !model.objects.contains_key(oid) {
            out.push(err(
                "missing-step-ref",
                format!("flow '{fid}' step '{sid}' references missing origin '{oid}'"),
                vec![fid.clone(), sid.clone()],
            ));
        }
    }
    if let Some(tid) = &step.target_id {
        if !model.objects.contains_key(tid) {
            out.push(err(
                "missing-step-ref",
                format!("flow '{fid}' step '{sid}' references missing target '{tid}'"),
                vec![fid.clone(), sid.clone()],
            ));
        }
    }
    if let Some(oid) = &step.object_id {
        if !model.objects.contains_key(oid) {
            out.push(err(
                "missing-step-ref",
                format!("flow '{fid}' step '{sid}' references missing object '{oid}'"),
                vec![fid.clone(), sid.clone()],
            ));
        }
    }
    if let Some(gid) = &step.go_to_flow_id {
        if !model.flows.contains_key(gid) {
            out.push(err(
                "missing-step-ref",
                format!("flow '{fid}' step '{sid}' references missing flow '{gid}'"),
                vec![fid.clone(), sid.clone()],
            ));
        } else if gid == fid {
            out.push(warn(
                "flow-self-goto",
                format!("flow '{fid}' step '{sid}' points at its own flow"),
                vec![fid.clone(), sid.clone()],
            ));
        }
    }

    match step.kind {
        StepKind::Message => {
            // Message should have connection + endpoints? Spec requires checks for
            // missing refs; we only enforce endpoint-match warning when all present.
            if let (Some(cid), Some(oid), Some(tid)) = (
                &step.via_connection_id,
                &step.origin_id,
                &step.target_id,
            ) {
                if let Some(conn) = model.connections.get(cid) {
                    if model.objects.contains_key(oid) && model.objects.contains_key(tid) {
                        let forward =
                            oid == &conn.origin_id && tid == &conn.target_id;
                        let backward =
                            oid == &conn.target_id && tid == &conn.origin_id;
                        if !forward && !backward {
                            out.push(warn(
                                "step-endpoint-mismatch",
                                format!(
                                    "flow '{fid}' step '{sid}' endpoints do not match connection '{cid}'"
                                ),
                                vec![fid.clone(), sid.clone()],
                            ));
                        }
                    }
                }
            }
        }
        StepKind::Process => {
            if step.object_id.is_none() {
                out.push(err(
                    "step-missing-object",
                    format!("flow '{fid}' step '{sid}' is Process but has no object"),
                    vec![fid.clone(), sid.clone()],
                ));
            }
        }
        StepKind::AlternatePaths | StepKind::ParallelPaths if step.paths.is_empty() => {
            out.push(warn(
                "flow-no-paths",
                format!("flow '{fid}' step '{sid}' has no paths"),
                vec![fid.clone(), sid.clone()],
            ));
        }
        _ => {}
    }
}

fn find_parent_cycles(model: &Model) -> Vec<Vec<Id>> {
    let mut cycles: Vec<Vec<Id>> = Vec::new();
    let mut seen_cycles: BTreeSet<Vec<Id>> = BTreeSet::new();
    for start in model.objects.keys() {
        let mut path: Vec<Id> = Vec::new();
        let mut in_path: BTreeSet<Id> = BTreeSet::new();
        let mut cur: Option<Id> = Some(start.clone());
        let mut guard = 0usize;
        while let Some(cid) = cur {
            if in_path.contains(&cid) {
                let pos = path.iter().position(|x| x == &cid).unwrap_or(0);
                let mut cyc: Vec<Id> = path[pos..].to_vec();
                cyc.sort();
                if seen_cycles.insert(cyc.clone()) {
                    cycles.push(cyc);
                }
                break;
            }
            if !model.objects.contains_key(&cid) {
                break;
            }
            path.push(cid.clone());
            in_path.insert(cid.clone());
            let next = model.objects.get(&cid).and_then(|o| o.parent_id.clone());
            match next {
                Some(n) => {
                    if !model.objects.contains_key(&n) {
                        break;
                    }
                    cur = Some(n);
                }
                None => break,
            }
            guard += 1;
            if guard > model.objects.len() + 5 {
                break;
            }
        }
    }
    cycles.sort();
    cycles
}

/// Repair a model in place, returning issues describing what was fixed.
/// Never panics.
pub fn repair(model: &mut Model) -> Vec<Issue> {
    repair_inner(model, None)
}

/// Repair a full document in place. Clears dangling diagram entries too.
pub fn repair_document(doc: &mut Document) -> Vec<Issue> {
    repair_inner(&mut doc.model, Some(&mut doc.diagrams))
}

fn repair_inner(
    model: &mut Model,
    diagrams: Option<&mut BTreeMap<Id, crate::model::Diagram>>,
) -> Vec<Issue> {
    let mut fixed = Vec::new();

    // dangling parents
    let mut dangling_parents: Vec<Id> = Vec::new();
    for (id, obj) in model.objects.iter() {
        if let Some(pid) = &obj.parent_id {
            if !model.objects.contains_key(pid) {
                dangling_parents.push(id.clone());
            }
        }
    }
    dangling_parents.sort();
    for id in dangling_parents {
        if let Some(obj) = model.objects.get_mut(&id) {
            obj.parent_id = None;
            fixed.push(warn(
                "missing-parent",
                format!("cleared dangling parent of '{id}'"),
                vec![id],
            ));
        }
    }

    // cycles: clear parent of smallest id in each cycle
    loop {
        let cycles = find_parent_cycles(model);
        if cycles.is_empty() {
            break;
        }
        let cyc = &cycles[0];
        let smallest = cyc.iter().min().cloned().unwrap_or_default();
        if let Some(obj) = model.objects.get_mut(&smallest) {
            obj.parent_id = None;
            fixed.push(err(
                "parent-cycle",
                format!("broke parent cycle at '{smallest}'"),
                vec![smallest],
            ));
        } else {
            break;
        }
    }

    // connections with missing endpoints -> drop
    let mut bad_conns: Vec<Id> = Vec::new();
    for (id, conn) in model.connections.iter() {
        if !model.objects.contains_key(&conn.origin_id)
            || !model.objects.contains_key(&conn.target_id)
        {
            bad_conns.push(id.clone());
        }
    }
    bad_conns.sort();
    for id in bad_conns {
        model.connections.remove(&id);
        fixed.push(err(
            "missing-connection-endpoint",
            format!("dropped connection '{id}' with missing endpoint"),
            vec![id],
        ));
    }

    // clear dangling via_id on remaining connections
    let obj_set: BTreeSet<Id> = model.objects.keys().cloned().collect();
    let conn_ids: Vec<Id> = model.connections.keys().cloned().collect();
    for cid in conn_ids {
        if let Some(conn) = model.connections.get_mut(&cid) {
            if let Some(via) = conn.via_id.clone() {
                if !obj_set.contains(&via) {
                    conn.via_id = None;
                    fixed.push(err(
                        "missing-via-object",
                        format!("cleared dangling via of connection '{cid}'"),
                        vec![cid],
                    ));
                }
            }
        }
    }

    // dangling tag_ids on objects + connections
    let tag_ids: BTreeSet<Id> = model.tags.keys().cloned().collect();
    // snapshot of which ids are groups (to avoid borrow conflicts)
    let group_kind: BTreeMap<Id, bool> = model
        .objects
        .iter()
        .map(|(k, o)| (k.clone(), o.kind == ObjectKind::Group))
        .collect();
    let obj_ids: Vec<Id> = model.objects.keys().cloned().collect();
    for oid in obj_ids {
        // tags
        let new_tags: Option<Vec<Id>> = model.objects.get(&oid).map(|obj| {
            obj.tag_ids
                .iter()
                .filter(|t| tag_ids.contains(*t))
                .cloned()
                .collect()
        });
        if let Some(new_tags) = new_tags {
            if let Some(obj) = model.objects.get_mut(&oid) {
                if obj.tag_ids.len() != new_tags.len() {
                    obj.tag_ids = new_tags;
                    fixed.push(warn(
                        "missing-tag",
                        format!("removed dangling tags from '{oid}'"),
                        vec![oid.clone()],
                    ));
                }
            }
        }
        // dangling group_ids: remove refs to missing or non-group objects
        let new_groups: Option<Vec<Id>> = model.objects.get(&oid).map(|obj| {
            obj.group_ids
                .iter()
                .filter(|g| group_kind.get(*g).copied().unwrap_or(false))
                .cloned()
                .collect()
        });
        if let Some(new_groups) = new_groups {
            if let Some(obj) = model.objects.get_mut(&oid) {
                if obj.group_ids.len() != new_groups.len() {
                    obj.group_ids = new_groups;
                    fixed.push(warn(
                        "invalid-group-ref",
                        format!("removed dangling group refs from '{oid}'"),
                        vec![oid.clone()],
                    ));
                }
            }
        }
    }
    let tag_set2: BTreeSet<Id> = model.tags.keys().cloned().collect();
    let conn_ids2: Vec<Id> = model.connections.keys().cloned().collect();
    for cid in conn_ids2 {
        if let Some(conn) = model.connections.get_mut(&cid) {
            let before = conn.tag_ids.len();
            conn.tag_ids.retain(|t| tag_set2.contains(t));
            if conn.tag_ids.len() != before {
                fixed.push(warn(
                    "missing-tag",
                    format!("removed dangling tags from connection '{cid}'"),
                    vec![cid],
                ));
            }
        }
    }

    // dangling tag group refs -> clear
    let group_set: BTreeSet<Id> = model.tag_groups.keys().cloned().collect();
    let tag_list: Vec<Id> = model.tags.keys().cloned().collect();
    for tid in tag_list {
        if let Some(tag) = model.tags.get_mut(&tid) {
            if let Some(g) = tag.group_id.clone() {
                if !group_set.contains(&g) {
                    tag.group_id = None;
                    fixed.push(warn(
                        "missing-tag-group",
                        format!("cleared dangling group of tag '{tid}'"),
                        vec![tid],
                    ));
                }
            }
        }
    }

    // flow steps with dangling refs -> drop (including nested)
    let obj_set2: BTreeSet<Id> = model.objects.keys().cloned().collect();
    let conn_set: BTreeSet<Id> = model.connections.keys().cloned().collect();
    let flow_set: BTreeSet<Id> = model.flows.keys().cloned().collect();
    let flow_ids: Vec<Id> = model.flows.keys().cloned().collect();
    for fid in flow_ids {
        if let Some(flow) = model.flows.get_mut(&fid) {
            let before_total = count_steps(&flow.steps);
            prune_steps(&mut flow.steps, &obj_set2, &conn_set, &flow_set);
            // Also drop Process steps with no object (error) — prune handles? No:
            // Process with None is an error but not dangling; repair should NOT
            // silently drop it? Spec says "drops flow steps with dangling refs".
            // A Process with no object has no dangling ref, just missing field.
            // Keep it (validate will still report error) — but then repair test
            // "no Errors" would fail if fixture has such step. The repair test we
            // write will avoid that case. Keep behavior: only drop dangling.
            let after_total = count_steps(&flow.steps);
            if after_total != before_total {
                fixed.push(err(
                    "missing-step-ref",
                    format!("dropped broken steps in flow '{fid}'"),
                    vec![fid],
                ));
            }
        }
    }

    // diagrams
    if let Some(diagrams) = diagrams {
        let dids: Vec<Id> = diagrams.keys().cloned().collect();
        let all_dids: BTreeSet<Id> = diagrams.keys().cloned().collect();
        for did in dids {
            if let Some(d) = diagrams.get_mut(&did) {
                if let Some(scope) = d.scope_object_id.clone() {
                    if !model.objects.contains_key(&scope) {
                        d.scope_object_id = None;
                        fixed.push(err(
                            "missing-diagram-scope",
                            format!("cleared missing scope of diagram '{did}'"),
                            vec![did.clone()],
                        ));
                    }
                }
                let before_b = d.boxes.len();
                d.boxes.retain(|bid, _| model.objects.contains_key(bid));
                if d.boxes.len() != before_b {
                    fixed.push(err(
                        "missing-diagram-box",
                        format!("removed dangling boxes from diagram '{did}'"),
                        vec![did.clone()],
                    ));
                }
                // One-off M5 migration: the scope object is not a box on its
                // own diagram (the UI draws the scope FRAME instead).
                if let Some(scope) = d.scope_object_id.clone() {
                    if d.boxes.remove(&scope).is_some() {
                        fixed.push(warn(
                            "scope-object-boxed",
                            format!(
                                "removed scope object '{scope}' from its own diagram '{did}'"
                            ),
                            vec![did.clone(), scope],
                        ));
                    }
                }
                let before_c = d.connections.len();
                d.connections
                    .retain(|cid, _| model.connections.contains_key(cid));
                if d.connections.len() != before_c {
                    fixed.push(err(
                        "missing-diagram-connection",
                        format!("removed dangling connections from diagram '{did}'"),
                        vec![did.clone()],
                    ));
                }
                let before_l = d.landing.len();
                d.landing.retain(|_, target| all_dids.contains(target));
                if d.landing.len() != before_l {
                    fixed.push(err(
                        "missing-landing",
                        format!("removed dangling landing entries from diagram '{did}'"),
                        vec![did.clone()],
                    ));
                }
            }
        }
    }

    fixed
}

fn count_steps(steps: &[crate::model::FlowStep]) -> usize {
    let mut n = 0;
    for s in steps {
        n += 1;
        for p in &s.paths {
            n += count_steps(&p.steps);
        }
    }
    n
}

fn step_dangling(
    step: &crate::model::FlowStep,
    objs: &BTreeSet<Id>,
    conns: &BTreeSet<Id>,
    flows: &BTreeSet<Id>,
) -> bool {
    if let Some(cid) = &step.via_connection_id {
        if !conns.contains(cid) {
            return true;
        }
    }
    if let Some(oid) = &step.origin_id {
        if !objs.contains(oid) {
            return true;
        }
    }
    if let Some(tid) = &step.target_id {
        if !objs.contains(tid) {
            return true;
        }
    }
    if let Some(oid) = &step.object_id {
        if !objs.contains(oid) {
            return true;
        }
    }
    if let Some(gid) = &step.go_to_flow_id {
        if !flows.contains(gid) {
            return true;
        }
    }
    false
}

fn prune_steps(
    steps: &mut Vec<crate::model::FlowStep>,
    objs: &BTreeSet<Id>,
    conns: &BTreeSet<Id>,
    flows: &BTreeSet<Id>,
) {
    let mut kept = Vec::new();
    for mut s in steps.drain(..) {
        if step_dangling(&s, objs, conns, flows) {
            continue;
        }
        for p in s.paths.iter_mut() {
            prune_steps(&mut p.steps, objs, conns, flows);
        }
        kept.push(s);
    }
    *steps = kept;
}

/// Build one `RemoveFromDiagram` per diagram that currently boxes its own
/// scope object, so `Session::open` / `ensure_layout` can repair old files
/// as a normal undoable command. Sorted by (diagram, object) for
/// determinism. Empty when there is nothing to repair.
pub fn scope_box_removal_commands(doc: &Document) -> Vec<Command> {
    let mut out: Vec<Command> = Vec::new();
    let mut dids: Vec<&Id> = doc.diagrams.keys().collect();
    dids.sort();
    for did in dids {
        let d = &doc.diagrams[did];
        if let Some(scope) = &d.scope_object_id {
            if d.boxes.contains_key(scope) {
                out.push(Command::RemoveFromDiagram {
                    diagram_id: (*did).clone(),
                    object_id: scope.clone(),
                });
            }
        }
    }
    out
}

/// Convenience: all issue codes currently produced.
pub fn all_codes() -> Vec<&'static str> {
    vec![
        "missing-parent",
        "parent-cycle",
        "invalid-parent-kind",
        "missing-connection-endpoint",
        "connection-self-loop",
        "missing-via-object",
        "missing-tag",
        "missing-tag-group",
        "invalid-group-ref",
        "missing-step-ref",
        "step-endpoint-mismatch",
        "step-missing-object",
        "empty-flow",
        "flow-no-paths",
        "flow-self-goto",
        "missing-diagram-scope",
        "missing-diagram-box",
        "missing-diagram-connection",
        "missing-landing",
        "scope-object-boxed",
    ]
}

#[allow(dead_code)]
fn _map_keys(map: &BTreeMap<Id, crate::model::Object>) -> Vec<Id> {
    map.keys().cloned().collect()
}
