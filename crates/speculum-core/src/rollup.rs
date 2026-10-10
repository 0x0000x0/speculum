use crate::model::{Document, Flow, FlowStep, Id};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Endpoint {
    Box(Id),
    #[default]
    Frame,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewEdge {
    #[serde(default)]
    pub from: Endpoint,
    #[serde(default)]
    pub to: Endpoint,
    #[serde(default)]
    pub connection_ids: Vec<Id>,
    #[serde(default)]
    pub lower: bool,
    #[serde(default)]
    pub explicit: bool,
    #[serde(default)]
    pub bidirectional: bool,
}

impl Default for ViewEdge {
    fn default() -> Self {
        Self {
            from: Endpoint::Frame,
            to: Endpoint::Frame,
            connection_ids: Vec::new(),
            lower: false,
            explicit: false,
            bidirectional: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HoverSet {
    #[serde(default)]
    pub boxes: Vec<Id>,
    #[serde(default)]
    pub edges_in: Vec<usize>,
    #[serde(default)]
    pub edges_out: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepLocation {
    #[serde(default)]
    pub diagram_id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<Endpoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<Endpoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_box: Option<Id>,
}

/// Map an object to itself-or-nearest-ancestor on the diagram.
/// Returns (box_id, rolled_up) or None if no box found.
fn map_to_box(
    doc: &Document,
    diagram_id: &Id,
    object_id: &Id,
) -> Option<(Id, bool)> {
    let diagram = doc.diagrams.get(diagram_id)?;
    if diagram.boxes.contains_key(object_id) {
        return Some((object_id.clone(), false));
    }
    for ancestor in doc.model.ancestors(object_id) {
        if diagram.boxes.contains_key(&ancestor.id) {
            return Some((ancestor.id.clone(), true));
        }
    }
    None
}

/// Compute rolled-up edges for a diagram.
pub fn diagram_edges(doc: &Document, diagram_id: &Id) -> Vec<ViewEdge> {
    let diagram = match doc.diagrams.get(diagram_id) {
        Some(d) => d,
        None => return Vec::new(),
    };
    let scope = diagram.scope_object_id.clone();

    // key: (from, to) -> index in grouped vec
    let mut grouped: Vec<ViewEdge> = Vec::new();
    let mut index_of: BTreeMap<(String, String), usize> = BTreeMap::new();

    let mut conn_ids: Vec<&Id> = doc.model.connections.keys().collect();
    conn_ids.sort();
    for cid in conn_ids {
        let conn = &doc.model.connections[cid];
        let origin = &conn.origin_id;
        let target = &conn.target_id;

        // Resolve endpoints, honoring Frame for scope object.
        let (from, from_rolled): (Endpoint, bool) = if Some(origin) == scope.as_ref() {
            (Endpoint::Frame, false)
        } else {
            match map_to_box(doc, diagram_id, origin) {
                Some((b, rolled)) => (Endpoint::Box(b), rolled),
                None => continue,
            }
        };
        let (to, to_rolled): (Endpoint, bool) = if Some(target) == scope.as_ref() {
            (Endpoint::Frame, false)
        } else {
            match map_to_box(doc, diagram_id, target) {
                Some((b, rolled)) => (Endpoint::Box(b), rolled),
                None => continue,
            }
        };

        // Skip if both map to the same box (self-loop / internal).
        if from == to {
            continue;
        }

        let lower = from_rolled || to_rolled;
        let explicit = diagram.connections.contains_key(cid);
        let bidirectional =
            conn.direction == crate::model::Direction::Bidirectional;

        let key = (endpoint_key(&from), endpoint_key(&to));
        if let Some(&idx) = index_of.get(&key) {
            let edge = &mut grouped[idx];
            edge.connection_ids.push(cid.clone());
            edge.connection_ids.sort();
            if lower {
                edge.lower = true;
            }
            if explicit {
                edge.explicit = true;
            }
            if bidirectional {
                edge.bidirectional = true;
            }
        } else {
            let idx = grouped.len();
            index_of.insert(key, idx);
            grouped.push(ViewEdge {
                from,
                to,
                connection_ids: vec![cid.clone()],
                lower,
                explicit,
                bidirectional,
            });
        }
    }

    // Deterministic order: sort by (from_key, to_key).
    grouped.sort_by(|a, b| {
        endpoint_key(&a.from)
            .cmp(&endpoint_key(&b.from))
            .then_with(|| endpoint_key(&a.to).cmp(&endpoint_key(&b.to)))
    });
    grouped
}

fn endpoint_key(e: &Endpoint) -> String {
    match e {
        Endpoint::Frame => "__frame__".to_string(),
        Endpoint::Box(id) => format!("box:{id}"),
    }
}

/// Hover highlight: the hovered box plus neighbors, and edge indices in/out.
pub fn hover_set(doc: &Document, diagram_id: &Id, object_id: &Id) -> HoverSet {
    let diagram = match doc.diagrams.get(diagram_id) {
        Some(d) => d,
        None => return HoverSet::default(),
    };
    // Resolve hovered box: itself if on diagram, else nearest ancestor on diagram.
    let hovered: Option<Id> = if diagram.boxes.contains_key(object_id) {
        Some(object_id.clone())
    } else {
        map_to_box(doc, diagram_id, object_id).map(|(b, _)| b)
    };
    let hovered = match hovered {
        Some(h) => h,
        None => return HoverSet::default(),
    };

    let edges = diagram_edges(doc, diagram_id);
    let mut boxes = vec![hovered.clone()];
    let mut edges_in = Vec::new();
    let mut edges_out = Vec::new();

    for (idx, edge) in edges.iter().enumerate() {
        let from_box = match &edge.from {
            Endpoint::Box(id) => Some(id),
            Endpoint::Frame => None,
        };
        let to_box = match &edge.to {
            Endpoint::Box(id) => Some(id),
            Endpoint::Frame => None,
        };
        let touches_from = from_box == Some(&hovered);
        let touches_to = to_box == Some(&hovered);
        if !touches_from && !touches_to {
            continue;
        }
        // Neighbor box (the other side, if it's a box and not already listed).
        let other = if touches_from { to_box } else { from_box };
        if let Some(o) = other {
            if o != &hovered && !boxes.contains(o) {
                boxes.push(o.clone());
            }
        }
        // Direction from hovered box's point of view; bidirectional counts as both.
        if edge.bidirectional {
            // bidirectional edge counts as both in and out if it touches.
            if touches_from || touches_to {
                // For bidirectional, report both unless it's a Frame edge where
                // direction is ambiguous? Spec: bidirectional counts as both.
                if !edges_out.contains(&idx) {
                    edges_out.push(idx);
                }
                if !edges_in.contains(&idx) {
                    edges_in.push(idx);
                }
            }
        } else {
            if touches_from {
                edges_out.push(idx);
            }
            if touches_to {
                edges_in.push(idx);
            }
        }
    }

    boxes.sort();
    edges_in.sort();
    edges_out.sort();
    HoverSet {
        boxes,
        edges_in,
        edges_out,
    }
}

/// Locate a flow step on the best diagram for playback.
pub fn step_location(doc: &Document, flow: &Flow, step: &FlowStep) -> Option<StepLocation> {
    let via_id = step.via_connection_id.clone();
    let obj_id = step.object_id.clone();

    if via_id.is_some() {
        let cid = via_id.clone().unwrap();
        let conn = doc.model.connections.get(&cid)?;
        // Endpoints: prefer step's own origin/target, fall back to connection's.
        let origin = step.origin_id.clone().unwrap_or_else(|| conn.origin_id.clone());
        let target = step.target_id.clone().unwrap_or_else(|| conn.target_id.clone());

        // Prefer the flow's own diagram.
        if let Some(did) = flow.diagram_id.clone() {
            if doc.diagrams.contains_key(&did) {
                if let Some(loc) = locate_connection(doc, &did, &cid, &origin, &target, step.reversed) {
                    return Some(loc);
                }
            }
        }
        // Otherwise: diagrams where both endpoints visible, prefer deepest scope, then lowest order.
        let mut candidates: Vec<(i64, u32, Id, StepLocation)> = Vec::new();
        let mut dids: Vec<&Id> = doc.diagrams.keys().collect();
        dids.sort();
        for did in dids {
            if let Some(loc) = locate_connection(doc, did, &cid, &origin, &target, step.reversed) {
                let depth = scope_depth(doc, did);
                let order = doc.diagrams[did].order;
                candidates.push((depth, order, did.clone(), loc));
            }
        }
        candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)).then_with(|| a.2.cmp(&b.2)));
        return candidates.into_iter().next().map(|(_, _, _, loc)| loc);
    }

    if let Some(oid) = obj_id {
        // Prefer flow's diagram.
        if let Some(did) = flow.diagram_id.clone() {
            if doc.diagrams.contains_key(&did) {
                if let Some(b) = visible_box(doc, &did, &oid) {
                    return Some(StepLocation {
                        diagram_id: did,
                        from: None,
                        to: None,
                        object_box: Some(b),
                    });
                }
            }
        }
        let mut candidates: Vec<(i64, u32, Id, StepLocation)> = Vec::new();
        let mut dids: Vec<&Id> = doc.diagrams.keys().collect();
        dids.sort();
        for did in dids {
            if let Some(b) = visible_box(doc, did, &oid) {
                let depth = scope_depth(doc, did);
                let order = doc.diagrams[did].order;
                candidates.push((
                    depth,
                    order,
                    did.clone(),
                    StepLocation {
                        diagram_id: (*did).clone(),
                        from: None,
                        to: None,
                        object_box: Some(b),
                    },
                ));
            }
        }
        candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)).then_with(|| a.2.cmp(&b.2)));
        return candidates.into_iter().next().map(|(_, _, _, loc)| loc);
    }

    // Message steps without via but with origin/target: still locate by endpoints
    // (no specific connection to highlight, but show from/to boxes).
    if step.kind == crate::model::StepKind::Message {
        if let (Some(o), Some(t)) = (step.origin_id.clone(), step.target_id.clone()) {
            if let Some(did) = flow.diagram_id.clone() {
                if doc.diagrams.contains_key(&did) {
                    if let Some(loc) = locate_endpoints(doc, &did, &o, &t, step.reversed) {
                        return Some(loc);
                    }
                }
            }
            let mut candidates: Vec<(i64, u32, Id, StepLocation)> = Vec::new();
            let mut dids: Vec<&Id> = doc.diagrams.keys().collect();
            dids.sort();
            for did in dids {
                if let Some(loc) = locate_endpoints(doc, did, &o, &t, step.reversed) {
                    let depth = scope_depth(doc, did);
                    let order = doc.diagrams[did].order;
                    candidates.push((depth, order, did.clone(), loc));
                }
            }
            candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)).then_with(|| a.2.cmp(&b.2)));
            return candidates.into_iter().next().map(|(_, _, _, loc)| loc);
        }
    }

    None
}

fn locate_connection(
    doc: &Document,
    diagram_id: &Id,
    conn_id: &Id,
    origin: &Id,
    target: &Id,
    reversed: bool,
) -> Option<StepLocation> {
    // Check the connection is visible on this diagram (in edges).
    let edges = diagram_edges(doc, diagram_id);
    let visible = edges.iter().any(|e| e.connection_ids.iter().any(|c| c == conn_id));
    if !visible {
        return None;
    }
    locate_endpoints(doc, diagram_id, origin, target, reversed)
}

fn locate_endpoints(
    doc: &Document,
    diagram_id: &Id,
    origin: &Id,
    target: &Id,
    reversed: bool,
) -> Option<StepLocation> {
    let diagram = doc.diagrams.get(diagram_id)?;
    let scope = diagram.scope_object_id.clone();
    let map_one = |oid: &Id| -> Option<Endpoint> {
        if Some(oid) == scope.as_ref() {
            return Some(Endpoint::Frame);
        }
        map_to_box(doc, diagram_id, oid).map(|(b, _)| Endpoint::Box(b))
    };
    let from = map_one(origin)?;
    let to = map_one(target)?;
    if from == to {
        return None;
    }
    let (from, to) = if reversed { (to, from) } else { (from, to) };
    Some(StepLocation {
        diagram_id: diagram_id.clone(),
        from: Some(from),
        to: Some(to),
        object_box: None,
    })
}

fn visible_box(doc: &Document, diagram_id: &Id, object_id: &Id) -> Option<Id> {
    let diagram = doc.diagrams.get(diagram_id)?;
    let scope = diagram.scope_object_id.clone();
    if Some(object_id) == scope.as_ref() {
        return None;
    }
    map_to_box(doc, diagram_id, object_id).map(|(b, _)| b)
}

fn scope_depth(doc: &Document, diagram_id: &Id) -> i64 {
    let diagram = match doc.diagrams.get(diagram_id) {
        Some(d) => d,
        None => return -2,
    };
    match &diagram.scope_object_id {
        None => -1,
        Some(s) => doc.model.depth(s) as i64,
    }
}
