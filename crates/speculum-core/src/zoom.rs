//! Drill-down target resolution (Milestone M5, pure function).
//!
//! `zoom_target` decides what "Open inside" does for a box on a diagram:
//! an existing diagram, a to-be-created lower diagram, or not zoomable.

use serde::{Deserialize, Serialize};

use crate::model::{DiagramLevel, Document, Id};

/// Where "Open inside" on `object_id` should go.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ZoomTarget {
    /// A diagram already exists; open it.
    Existing { diagram_id: Id },
    /// No diagram yet; the caller should create one scoped to the object.
    NeedsCreate {
        level: DiagramLevel,
        scope_object_id: Id,
        suggested_name: String,
    },
    /// This object cannot contain a lower diagram (actor, or a childless
    /// component) and has no diagram yet.
    NotZoomable,
}

/// Level word used in suggested names, following the sample's conventions
/// ("Shop Landscape", "Storefront Apps", "Payments API Internals").
pub fn level_word(level: &DiagramLevel) -> &'static str {
    match level {
        DiagramLevel::Context => "Landscape",
        DiagramLevel::App => "Apps",
        DiagramLevel::Component => "Internals",
    }
}

pub fn suggested_name(object_name: &str, level: &DiagramLevel) -> String {
    format!("{} {}", object_name, level_word(level))
}

/// Resolve the drill-down target for `object_id` seen from `from_diagram_id`.
///
/// Order:
/// 1. the from-diagram's `landing[object_id]`, if that diagram still exists;
/// 2. the first diagram (lowest `order`, then name, then id) whose
///    `scope_object_id == object_id`;
/// 3. `NeedsCreate` when the object kind can contain children
///    (system -> app level, app/store -> component level, group -> same
///    level as the from-diagram; actor/component with model children ->
///    same level as the from-diagram so deeply nested samples stay
///    drillable);
/// 4. otherwise `NotZoomable` (actor, or childless component, with no
///    diagram yet).
pub fn zoom_target(
    doc: &Document,
    from_diagram_id: &Id,
    object_id: &Id,
) -> ZoomTarget {
    // 1. Explicit landing override on the from-diagram.
    if let Some(from) = doc.diagrams.get(from_diagram_id) {
        if let Some(target_id) = from.landing.get(object_id) {
            if doc.diagrams.contains_key(target_id) {
                return ZoomTarget::Existing {
                    diagram_id: target_id.clone(),
                };
            }
        }
    }
    // 2. First diagram scoped to the object (lowest order, then name, then id).
    let mut scoped: Vec<&crate::model::Diagram> = doc
        .diagrams
        .values()
        .filter(|d| d.scope_object_id.as_ref() == Some(object_id))
        .collect();
    scoped.sort_by(|a, b| {
        a.order
            .cmp(&b.order)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
    if let Some(d) = scoped.into_iter().next() {
        return ZoomTarget::Existing {
            diagram_id: d.id.clone(),
        };
    }
    // 3/4. Kind-based creation.
    let obj = match doc.model.objects.get(object_id) {
        Some(o) => o,
        None => return ZoomTarget::NotZoomable,
    };
    let from_level = doc
        .diagrams
        .get(from_diagram_id)
        .map(|d| d.level.clone())
        .unwrap_or(DiagramLevel::Context);
    let level = match obj.kind {
        crate::model::ObjectKind::System => Some(DiagramLevel::App),
        crate::model::ObjectKind::App | crate::model::ObjectKind::Store => {
            Some(DiagramLevel::Component)
        }
        crate::model::ObjectKind::Group => Some(from_level.clone()),
        crate::model::ObjectKind::Actor | crate::model::ObjectKind::Component => {
            // Actors never contain diagrams. Components can only drill when
            // they already have a diagram (handled above) or when the model
            // actually nests children under them (extended samples).
            if obj.kind == crate::model::ObjectKind::Component
                && !doc.model.children(object_id).is_empty()
            {
                Some(from_level.clone())
            } else {
                None
            }
        }
    };
    match level {
        Some(level) => ZoomTarget::NeedsCreate {
            suggested_name: suggested_name(&obj.name, &level),
            scope_object_id: object_id.clone(),
            level,
        },
        None => ZoomTarget::NotZoomable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Diagram, Object, ObjectKind, Rect};
    use std::collections::BTreeMap;

    fn obj(id: &str, name: &str, kind: ObjectKind, parent: Option<&str>) -> Object {
        Object {
            id: id.to_string(),
            name: name.to_string(),
            kind,
            parent_id: parent.map(|s| s.to_string()),
            ..Default::default()
        }
    }

    fn diagram(id: &str, name: &str, order: u32, scope: Option<&str>) -> Diagram {
        Diagram {
            id: id.to_string(),
            name: name.to_string(),
            order,
            scope_object_id: scope.map(|s| s.to_string()),
            boxes: BTreeMap::new(),
            ..Default::default()
        }
    }

    fn boxed(id: &str, name: &str, order: u32, scope: Option<&str>, boxes: &[&str]) -> Diagram {
        let mut d = diagram(id, name, order, scope);
        for b in boxes {
            d.boxes.insert(
                b.to_string(),
                Rect { x: 0.0, y: 0.0, w: 10.0, h: 10.0 },
            );
        }
        d
    }

    fn doc() -> Document {
        let mut doc = Document::new("t".to_string());
        for o in [
            obj("sys", "Shop", ObjectKind::System, None),
            obj("app", "Web App", ObjectKind::App, Some("sys")),
            obj("comp", "Cart Service", ObjectKind::Component, Some("app")),
            obj("actor", "Customer", ObjectKind::Actor, None),
            obj("grp", "Cloud Region", ObjectKind::Group, None),
        ] {
            doc.model.objects.insert(o.id.clone(), o);
        }
        doc.diagrams.insert(
            "dg-top".to_string(),
            boxed("dg-top", "Shop Landscape", 0, None, &["sys", "actor", "grp"]),
        );
        doc.diagrams.insert(
            "dg-sys".to_string(),
            boxed("dg-sys", "Shop Apps", 1, Some("sys"), &["app"]),
        );
        doc
    }

    #[test]
    fn landing_override_wins() {
        let mut d = doc();
        d.diagrams
            .get_mut("dg-top")
            .unwrap()
            .landing
            .insert("sys".to_string(), "dg-sys".to_string());
        assert_eq!(
            zoom_target(&d, &"dg-top".to_string(), &"sys".to_string()),
            ZoomTarget::Existing {
                diagram_id: "dg-sys".to_string()
            }
        );
    }

    #[test]
    fn dangling_landing_falls_through_to_scope() {
        let mut d = doc();
        d.diagrams
            .get_mut("dg-top")
            .unwrap()
            .landing
            .insert("sys".to_string(), "dg-gone".to_string());
        // Scope search still finds dg-sys.
        assert_eq!(
            zoom_target(&d, &"dg-top".to_string(), &"sys".to_string()),
            ZoomTarget::Existing {
                diagram_id: "dg-sys".to_string()
            }
        );
    }

    #[test]
    fn scope_search_prefers_lowest_order_then_name() {
        let mut d = doc();
        d.diagrams.insert(
            "dg-sys-b".to_string(),
            boxed("dg-sys-b", "AAA Apps", 1, Some("sys"), &[]),
        );
        // Same order as dg-sys ("Shop Apps") but name sorts first.
        assert_eq!(
            zoom_target(&d, &"dg-top".to_string(), &"sys".to_string()),
            ZoomTarget::Existing {
                diagram_id: "dg-sys-b".to_string()
            }
        );
    }

    #[test]
    fn needs_create_levels() {
        let mut d = doc();
        d.diagrams.remove("dg-sys");
        // System -> app level.
        assert_eq!(
            zoom_target(&d, &"dg-top".to_string(), &"sys".to_string()),
            ZoomTarget::NeedsCreate {
                level: DiagramLevel::App,
                scope_object_id: "sys".to_string(),
                suggested_name: "Shop Apps".to_string(),
            }
        );
        // App without a diagram -> component level.
        assert_eq!(
            zoom_target(&d, &"dg-sys".to_string(), &"app".to_string()),
            ZoomTarget::NeedsCreate {
                level: DiagramLevel::Component,
                scope_object_id: "app".to_string(),
                suggested_name: "Web App Internals".to_string(),
            }
        );
        // Group -> same level as the from-diagram.
        assert_eq!(
            zoom_target(&d, &"dg-top".to_string(), &"grp".to_string()),
            ZoomTarget::NeedsCreate {
                level: DiagramLevel::Context,
                scope_object_id: "grp".to_string(),
                suggested_name: "Cloud Region Landscape".to_string(),
            }
        );
    }

    #[test]
    fn actor_never_zoomable() {
        let d = doc();
        assert_eq!(
            zoom_target(&d, &"dg-top".to_string(), &"actor".to_string()),
            ZoomTarget::NotZoomable
        );
    }

    #[test]
    fn childless_component_not_zoomable() {
        let mut d = doc();
        d.model.objects.remove("comp");
        d.model.objects.insert(
            "leaf".to_string(),
            obj("leaf", "Leaf", ObjectKind::Component, Some("app")),
        );
        assert_eq!(
            zoom_target(&d, &"dg-sys".to_string(), &"leaf".to_string()),
            ZoomTarget::NotZoomable
        );
    }

    #[test]
    fn component_with_children_stays_drillable() {
        let mut d = doc();
        d.model.objects.insert(
            "sub".to_string(),
            obj("sub", "Cart Item", ObjectKind::Component, Some("comp")),
        );
        // Same level as the from-diagram (dg-sys is a Context diagram here).
        assert_eq!(
            zoom_target(&d, &"dg-sys".to_string(), &"comp".to_string()),
            ZoomTarget::NeedsCreate {
                level: DiagramLevel::Context,
                scope_object_id: "comp".to_string(),
                suggested_name: "Cart Service Landscape".to_string(),
            }
        );
    }

    #[test]
    fn unknown_object_is_not_zoomable() {
        let d = doc();
        assert_eq!(
            zoom_target(&d, &"dg-top".to_string(), &"nope".to_string()),
            ZoomTarget::NotZoomable
        );
    }
}
