use crate::model::{Document, Id, ObjectKind};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// One child held by a context tray: a direct child of the sibling system
/// that is involved in a link into the current scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextTrayChild {
    #[serde(default)]
    pub object_id: Id,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub kind: ObjectKind,
}

/// A faint neighbour tray: a sibling of the current scope object that has
/// links into the current scope. Holds only the children involved in those
/// links. View-only: never saved, computed per `get_diagram_view`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextTray {
    #[serde(default)]
    pub object_id: Id,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub kind: ObjectKind,
    #[serde(default)]
    pub caption: String,
    /// Deterministic placement side: "left" or "right" of the main tray.
    #[serde(default)]
    pub side: String,
    #[serde(default)]
    pub children: Vec<ContextTrayChild>,
}

fn subtree_ids(doc: &Document, root: &Id) -> BTreeSet<Id> {
    let mut seen = BTreeSet::from([root.clone()]);
    let mut stack = vec![root.clone()];
    while let Some(cur) = stack.pop() {
        for o in doc.model.objects.values() {
            if o.parent_id.as_ref() == Some(&cur) && seen.insert(o.id.clone()) {
                stack.push(o.id.clone());
            }
        }
    }
    seen
}

/// Siblings of the scope object (same parent, excluding the scope itself)
/// that have links into the current scope, with only the involved children.
/// Sorted by (name, id); sides alternate right/left deterministically.
/// Siblings linked only directly (no child involved) are skipped: an empty
/// tray carries no information.
pub fn context_trays(doc: &Document, diagram_id: &Id) -> Vec<ContextTray> {
    let diagram = match doc.diagrams.get(diagram_id) {
        Some(d) => d,
        None => return Vec::new(),
    };
    let scope_id = match &diagram.scope_object_id {
        Some(s) => s.clone(),
        None => return Vec::new(),
    };
    let scope_obj = match doc.model.objects.get(&scope_id) {
        Some(o) => o,
        None => return Vec::new(),
    };
    let parent = scope_obj.parent_id.clone();
    let mut siblings: Vec<&crate::model::Object> = doc
        .model
        .objects
        .values()
        .filter(|o| o.parent_id == parent && o.id != scope_id)
        .collect();
    siblings.sort_by(|a, b| {
        a.name
            .cmp(&b.name)
            .then_with(|| a.id.cmp(&b.id))
    });

    let scope_sub: BTreeSet<Id> = subtree_ids(doc, &scope_id);

    let mut conn_ids: Vec<&Id> = doc.model.connections.keys().collect();
    conn_ids.sort();

    let mut trays = Vec::new();
    for sib in siblings {
        let sib_sub: BTreeSet<Id> = subtree_ids(doc, &sib.id);
        // Direct children of the sibling involved in cross links.
        let mut involved: BTreeMap<(String, String), &crate::model::Object> = BTreeMap::new();
        for cid in &conn_ids {
            let c = &doc.model.connections[*cid];
            let o_in_sib = sib_sub.contains(&c.origin_id);
            let t_in_sib = sib_sub.contains(&c.target_id);
            let o_in_scope = scope_sub.contains(&c.origin_id);
            let t_in_scope = scope_sub.contains(&c.target_id);
            let cross = (o_in_sib && t_in_scope) || (t_in_sib && o_in_scope);
            if !cross {
                continue;
            }
            // Internal links (both ends in the scope already render as
            // normal edges) never reach here: one end is always in sib_sub
            // which is disjoint from scope_sub.
            for end in [&c.origin_id, &c.target_id] {
                if !sib_sub.contains(end) || end == &sib.id {
                    continue;
                }
                // Map the endpoint up to the direct child of the sibling.
                let mut cur = end.clone();
                let mut guard = 0usize;
                while guard < 1024 {
                    guard += 1;
                    match doc.model.objects.get(&cur).and_then(|o| o.parent_id.clone()) {
                        Some(p) if p == sib.id => break,
                        Some(p) => cur = p,
                        None => break,
                    }
                }
                if doc
                    .model
                    .objects
                    .get(&cur)
                    .is_some_and(|o| o.parent_id.as_ref() == Some(&sib.id))
                {
                    if let Some(o) = doc.model.objects.get(&cur) {
                        involved.insert((o.name.clone(), o.id.clone()), o);
                    }
                }
            }
        }
        if involved.is_empty() {
            continue;
        }
        let children = involved
            .values()
            .map(|o| ContextTrayChild {
                object_id: o.id.clone(),
                name: o.name.clone(),
                kind: o.kind.clone(),
            })
            .collect::<Vec<_>>();
        let side = if trays.len() % 2 == 0 { "right" } else { "left" }.to_string();
        trays.push(ContextTray {
            object_id: sib.id.clone(),
            name: sib.name.clone(),
            kind: sib.kind.clone(),
            caption: sib.caption.clone(),
            side,
            children,
        });
    }
    trays
}

#[cfg(test)]
mod context_wire_tests {
    use super::{context_trays, ContextTray};
    use crate::model::{Document, ObjectKind};

    fn obj(doc: &mut Document, id: &str, name: &str, kind: ObjectKind, parent: Option<&str>) {
        doc.model.objects.insert(
            id.to_string(),
            crate::model::Object {
                id: id.to_string(),
                name: name.to_string(),
                kind,
                parent_id: parent.map(|s| s.to_string()),
                ..Default::default()
            },
        );
    }

    fn link(doc: &mut Document, id: &str, origin: &str, target: &str) {
        doc.model.connections.insert(
            id.to_string(),
            crate::model::Connection {
                id: id.to_string(),
                origin_id: origin.to_string(),
                target_id: target.to_string(),
                name: format!("{origin}->{target}"),
                ..Default::default()
            },
        );
    }

    fn diagram(doc: &mut Document, id: &str, scope: Option<&str>, boxes: &[&str]) {
        doc.diagrams.insert(
            id.to_string(),
            crate::model::Diagram {
                id: id.to_string(),
                name: format!("{id} name"),
                boxes: boxes
                    .iter()
                    .map(|b| {
                        (
                            b.to_string(),
                            crate::model::Rect { x: 0.0, y: 0.0, w: 120.0, h: 120.0 },
                        )
                    })
                    .collect(),
                scope_object_id: scope.map(|s| s.to_string()),
                ..Default::default()
            },
        );
    }

    #[test]
    fn context_trays_json_shape_is_pinned() {
        let mut doc = Document::new("Made-up Shop".to_string());
        obj(&mut doc, "obj-storefront", "Storefront", ObjectKind::System, None);
        obj(&mut doc, "obj-payments", "Payments", ObjectKind::System, None);
        obj(&mut doc, "obj-customer", "Customer", ObjectKind::Actor, None);
        obj(&mut doc, "obj-webapp", "Web App", ObjectKind::App, Some("obj-storefront"));
        obj(
            &mut doc,
            "obj-payments-api",
            "Payments API",
            ObjectKind::App,
            Some("obj-payments"),
        );
        link(&mut doc, "conn-1", "obj-webapp", "obj-payments-api");
        link(&mut doc, "conn-2", "obj-customer", "obj-webapp");
        diagram(&mut doc, "dg-storefront", Some("obj-storefront"), &["obj-webapp"]);

        let trays = context_trays(&doc, &"dg-storefront".to_string());
        // Only Payments qualifies (Customer links directly, no child involved).
        assert_eq!(trays.len(), 1);
        let json = serde_json::to_value(&trays).unwrap();
        let expected = serde_json::json!([
            {
                "objectId": "obj-payments",
                "name": "Payments",
                "kind": "system",
                "caption": "",
                "side": "right",
                "children": [
                    {"objectId": "obj-payments-api", "name": "Payments API", "kind": "app"}
                ]
            }
        ]);
        assert_eq!(json, expected);

        // Round-trip through the exact JSON shape.
        let back: Vec<ContextTray> = serde_json::from_value(expected).unwrap();
        assert_eq!(back, trays);

        // Unscoped diagrams and unknown ids have no trays.
        diagram(&mut doc, "dg-top", None, &["obj-storefront"]);
        assert!(context_trays(&doc, &"dg-top".to_string()).is_empty());
        assert!(context_trays(&doc, &"dg-missing".to_string()).is_empty());
    }
}
