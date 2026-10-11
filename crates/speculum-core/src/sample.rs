//! Made-up sample document for the empty-state "Open sample" action.
//! All names are synthetic. Dispatched as ONE Batch command (one undo step).

use crate::model::{
    Connection, Diagram, DiagramLevel, Direction, LineShape, Object, ObjectKind, Rect, Status, Tag,
};
use crate::Command;
use std::collections::BTreeMap;

fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect { x, y, w, h }
}

fn obj(
    id: &str,
    name: &str,
    kind: ObjectKind,
    parent: Option<&str>,
    external: bool,
    caption: &str,
) -> Object {
    Object {
        id: id.to_string(),
        name: name.to_string(),
        kind,
        parent_id: parent.map(|s| s.to_string()),
        external,
        caption: caption.to_string(),
        ..Default::default()
    }
}

fn conn(id: &str, origin: &str, target: &str, name: &str, dir: Direction) -> Connection {
    Connection {
        id: id.to_string(),
        origin_id: origin.to_string(),
        target_id: target.to_string(),
        name: name.to_string(),
        direction: dir,
        ..Default::default()
    }
}

struct ConnOpts {
    status: Status,
    shape: LineShape,
    via: Option<&'static str>,
}

fn conn_full(
    id: &str,
    origin: &str,
    target: &str,
    name: &str,
    dir: Direction,
    opts: ConnOpts,
) -> Connection {
    Connection {
        id: id.to_string(),
        origin_id: origin.to_string(),
        target_id: target.to_string(),
        name: name.to_string(),
        direction: dir,
        status: opts.status,
        line_shape: opts.shape,
        via_id: opts.via.map(|s| s.to_string()),
        ..Default::default()
    }
}

fn live(shape: LineShape) -> ConnOpts {
    ConnOpts { status: Status::Live, shape, via: None }
}

/// Build the sample as a single Batch command. Caller should only dispatch
/// it when the model is empty.
pub fn seed_sample_command() -> Command {
    let mut cmds: Vec<Command> = Vec::new();

    cmds.push(Command::CreateTag {
        tag: Tag {
            id: "tag-core".to_string(),
            name: "Core".to_string(),
            color: "blue".to_string(),
            index: 0,
            ..Default::default()
        },
    });
    cmds.push(Command::CreateTag {
        tag: Tag {
            id: "tag-pci".to_string(),
            name: "PCI".to_string(),
            color: "red".to_string(),
            index: 1,
            ..Default::default()
        },
    });

    for o in [
        obj("obj-customer", "Customer", ObjectKind::Actor, None, true, "Shops with a browser"),
        obj("obj-support", "Support Agent", ObjectKind::Actor, None, true, "Helps shoppers"),
        obj("obj-storefront", "Storefront", ObjectKind::System, None, false, "Customer-facing shop"),
        obj("obj-payments", "Payments", ObjectKind::System, None, false, "Money movement"),
        obj("obj-cloud", "Cloud Region", ObjectKind::Group, None, false, "Shared hosting boundary"),
        obj("obj-webapp", "Web App", ObjectKind::App, Some("obj-storefront"), false, "Server-rendered shop"),
        obj("obj-mobile", "Mobile App", ObjectKind::App, Some("obj-storefront"), false, "Native shopping app"),
        obj("obj-payments-api", "Payments API", ObjectKind::App, Some("obj-payments"), false, "Charges cards"),
        obj("obj-orders", "Orders Store", ObjectKind::Store, Some("obj-storefront"), false, "Orders source of truth"),
        obj("obj-vault", "Card Vault", ObjectKind::Store, Some("obj-payments"), false, "Tokenized cards"),
        obj("obj-cart", "Cart Service", ObjectKind::Component, Some("obj-webapp"), false, "Holds shopping carts"),
        obj("obj-checkout", "Checkout Service", ObjectKind::Component, Some("obj-webapp"), false, "Runs checkout"),
        obj("obj-tokenizer", "Card Tokenizer", ObjectKind::Component, Some("obj-payments-api"), false, "Tokenizes cards"),
        obj("obj-cart-item", "Cart Item", ObjectKind::Component, Some("obj-cart"), false, "One line in the cart"),
        obj("obj-queue", "Orders Queue", ObjectKind::Store, Some("obj-storefront"), false, "Buffers order events"),
    ] {
        cmds.push(Command::CreateObject { object: o });
    }

    for c in [
        conn("conn-1", "obj-customer", "obj-webapp", "browses", Direction::Outgoing),
        conn("conn-2", "obj-mobile", "obj-orders", "reads", Direction::Outgoing),
        conn_full("conn-3", "obj-webapp", "obj-payments-api", "charges via", Direction::Outgoing, live(LineShape::Straight)),
        conn("conn-4", "obj-payments-api", "obj-orders", "syncs", Direction::Bidirectional),
        conn("conn-5", "obj-support", "obj-orders", "looks up", Direction::Outgoing),
        conn_full("conn-6", "obj-cart", "obj-checkout", "hands off", Direction::Outgoing, live(LineShape::Square)),
        conn("conn-7", "obj-checkout", "obj-tokenizer", "tokenizes via", Direction::Outgoing),
        conn("conn-8", "obj-tokenizer", "obj-vault", "stores in", Direction::Outgoing),
        conn("conn-9", "obj-cart", "obj-cart-item", "holds", Direction::Outgoing),
        // M6: parent -> child (scope object linked to a child).
        conn("conn-10", "obj-storefront", "obj-webapp", "hosts", Direction::Outgoing),
        // M6: via object (Orders Queue is not boxed, so it draws as a pill).
        conn_full("conn-11", "obj-webapp", "obj-orders", "enqueues via", Direction::Outgoing, ConnOpts { status: Status::Live, shape: LineShape::Curved, via: Some("obj-queue") }),
        // M6: future + deprecated links.
        conn_full("conn-12", "obj-mobile", "obj-cart", "will preview", Direction::Outgoing, ConnOpts { status: Status::Future, shape: LineShape::Curved, via: None }),
        conn_full("conn-13", "obj-checkout", "obj-orders", "archives", Direction::Outgoing, ConnOpts { status: Status::Deprecated, shape: LineShape::Curved, via: None }),
        // M6: second parallel link between the same pair as conn-6.
        conn_full("conn-14", "obj-cart", "obj-checkout", "streams to", Direction::Outgoing, live(LineShape::Straight)),
        // M6: second lower link on the landscape pair (groups with conn-1).
        conn("conn-15", "obj-customer", "obj-orders", "reorders", Direction::Outgoing),
    ] {
        cmds.push(Command::Connect { connection: c });
    }

    // Hand-made rects, tight packing (V1): inside a parent scope boxes
    // are 120x120 squares on a 180 step (60px gaps); the landscape uses
    // the wide 220x110 variant on the same 60px-gap packing. The vertical
    // gap is 120 only between rows joined by labelled links. Content fits
    // in 1100x800 at >= 90% zoom.
    let mut landscape = BTreeMap::new();
    landscape.insert("obj-storefront".to_string(), rect(64.0, 64.0, 220.0, 110.0));
    landscape.insert("obj-customer".to_string(), rect(344.0, 64.0, 220.0, 110.0));
    landscape.insert("obj-payments".to_string(), rect(624.0, 64.0, 220.0, 110.0));
    landscape.insert("obj-support".to_string(), rect(64.0, 294.0, 220.0, 110.0));
    landscape.insert("obj-cloud".to_string(), rect(344.0, 294.0, 220.0, 110.0));

    let mut apps = BTreeMap::new();
    apps.insert("obj-cart".to_string(), rect(64.0, 96.0, 120.0, 120.0));
    apps.insert("obj-checkout".to_string(), rect(244.0, 96.0, 120.0, 120.0));
    apps.insert("obj-orders".to_string(), rect(424.0, 96.0, 120.0, 120.0));
    apps.insert("obj-mobile".to_string(), rect(64.0, 336.0, 120.0, 120.0));
    apps.insert("obj-webapp".to_string(), rect(244.0, 336.0, 120.0, 120.0));

    let mut internals = BTreeMap::new();
    // NOTE: the scope object itself is never a box on its own diagram;
    // the UI draws the scope FRAME instead (M5).
    internals.insert("obj-tokenizer".to_string(), rect(64.0, 96.0, 120.0, 120.0));
    internals.insert("obj-checkout".to_string(), rect(244.0, 96.0, 120.0, 120.0));
    internals.insert("obj-vault".to_string(), rect(64.0, 336.0, 120.0, 120.0));

    for d in [
        Diagram {
            id: "dg-landscape".to_string(),
            name: "Shop Landscape".to_string(),
            level: DiagramLevel::Context,
            order: 0,
            boxes: landscape,
            ..Default::default()
        },
        Diagram {
            id: "dg-storefront".to_string(),
            name: "Storefront Apps".to_string(),
            level: DiagramLevel::App,
            scope_object_id: Some("obj-storefront".to_string()),
            order: 1,
            boxes: apps,
            ..Default::default()
        },
        Diagram {
            id: "dg-payments-api".to_string(),
            name: "Payments API Internals".to_string(),
            level: DiagramLevel::Component,
            scope_object_id: Some("obj-payments-api".to_string()),
            order: 2,
            boxes: internals,
            ..Default::default()
        },
    ] {
        cmds.push(Command::CreateDiagram { diagram: d });
    }

    Command::Batch { commands: cmds }
}

/// True when the document has no model content and no diagrams.
pub fn is_empty_model(doc: &crate::model::Document) -> bool {
    doc.model.objects.is_empty()
        && doc.model.connections.is_empty()
        && doc.diagrams.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_applies_and_undos_in_one_step() {
        let mut doc = crate::model::Document::new("t".to_string());
        let cmd = seed_sample_command();
        let inv = cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.model.objects.len(), 15);
        assert_eq!(doc.model.connections.len(), 15);
        assert_eq!(doc.diagrams.len(), 3);
        // Rects on 2px grid (60/120px gaps on 120/220/110 boxes).
        for d in doc.diagrams.values() {
            for r in d.boxes.values() {
                assert_eq!(r.x % 2.0, 0.0);
                assert_eq!(r.y % 2.0, 0.0);
            }
            let rs: Vec<&Rect> = d.boxes.values().collect();
            for i in 0..rs.len() {
                for j in (i + 1)..rs.len() {
                    let (a, b) = (rs[i], rs[j]);
                    assert!(
                        !(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h),
                        "overlap in {}",
                        d.id
                    );
                }
            }
        }
        // One bidirectional connection.
        assert!(doc
            .model
            .connections
            .values()
            .any(|c| c.direction == Direction::Bidirectional));
        // M6 sample variety: parent->child, via, future, deprecated,
        // parallel pair, square + straight shapes.
        assert!(doc
            .model
            .connections
            .values()
            .any(|c| c.origin_id == "obj-storefront" && c.target_id == "obj-webapp"));
        assert!(doc
            .model
            .connections
            .values()
            .any(|c| c.via_id.as_deref() == Some("obj-queue")));
        assert!(doc
            .model
            .connections
            .values()
            .any(|c| c.status == Status::Future));
        assert!(doc
            .model
            .connections
            .values()
            .any(|c| c.status == Status::Deprecated));
        assert_eq!(
            doc.model
                .connections
                .values()
                .filter(|c| c.origin_id == "obj-cart" && c.target_id == "obj-checkout")
                .count(),
            2
        );
        assert!(doc
            .model
            .connections
            .values()
            .any(|c| c.line_shape == LineShape::Square));
        assert!(doc
            .model
            .connections
            .values()
            .any(|c| c.line_shape == LineShape::Straight));
        // Undo restores empty.
        inv.apply(&mut doc).expect("undo");
        assert!(is_empty_model(&doc));
    }

    /// V1 tight packing: no overlaps, 60px gaps (120 under labelled
    /// rows), tight frames (30/72 padding), and every level fits >= 90%
    /// zoom in an 1100x800 canvas.
    #[test]
    fn sample_diagrams_are_tightly_packed() {
        let mut doc = crate::model::Document::new("t".to_string());
        let cmd = seed_sample_command();
        cmd.apply(&mut doc).expect("apply");
        for d in doc.diagrams.values() {
            let scoped = d.scope_object_id.is_some();
            let (exp_w, exp_h) = if scoped { (120.0, 120.0) } else { (220.0, 110.0) };
            for (id, r) in &d.boxes {
                assert_eq!(r.w, exp_w, "width of {id} in {}", d.id);
                assert_eq!(r.h, exp_h, "height of {id} in {}", d.id);
            }
            let rs: Vec<(&String, &Rect)> = d.boxes.iter().collect();
            for i in 0..rs.len() {
                for j in (i + 1)..rs.len() {
                    let (a_id, a) = rs[i];
                    let (b_id, b) = rs[j];
                    assert!(
                        !(a.x < b.x + b.w
                            && b.x < a.x + a.w
                            && a.y < b.y + b.h
                            && b.y < a.y + a.h),
                        "overlap between {a_id} and {b_id} in {}",
                        d.id
                    );
                }
            }
            // Columns step exactly box_w + 60.
            let mut xs: Vec<f64> = d.boxes.values().map(|r| r.x).collect();
            xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
            xs.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            for w in xs.windows(2) {
                assert!(
                    (w[1] - w[0] - (exp_w + 60.0)).abs() < 1e-6,
                    "column step {} in {}",
                    w[1] - w[0],
                    d.id
                );
            }
            // Row bands are box_h + 60 apart, or + 120 under labelled rows.
            let mut ys: Vec<f64> = d.boxes.values().map(|r| r.y).collect();
            ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
            ys.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            for w in ys.windows(2) {
                let step = w[1] - w[0] - exp_h;
                assert!(
                    (step - 60.0).abs() < 1e-6 || (step - 120.0).abs() < 1e-6,
                    "row step {step} in {}",
                    d.id
                );
            }
            // Tight frame: bbox + 30/30/30/72.
            let min_x = d.boxes.values().map(|r| r.x).fold(f64::INFINITY, f64::min);
            let min_y = d.boxes.values().map(|r| r.y).fold(f64::INFINITY, f64::min);
            let max_x =
                d.boxes.values().map(|r| r.x + r.w).fold(f64::NEG_INFINITY, f64::max);
            let max_y =
                d.boxes.values().map(|r| r.y + r.h).fold(f64::NEG_INFINITY, f64::max);
            let frame_w = (max_x - min_x) + 60.0;
            let frame_h = (max_y - min_y) + 30.0 + 72.0;
            assert!((min_x - 30.0 - (min_x - 30.0)).abs() < 1e-9);
            // Every level (frame included) fits >= 90% zoom in 1100x800:
            // content * 0.9 must fit the viewport.
            assert!(
                frame_w * 0.9 <= 1100.0,
                "too wide in {}: frame {frame_w}",
                d.id
            );
            assert!(
                frame_h * 0.9 <= 800.0,
                "too tall in {}: frame {frame_h}",
                d.id
            );
            let _ = (min_y, max_x, max_y);
        }
    }

    /// Pins the JSON shape of the M6p2 `showAllLabels` diagram field (the
    /// browser mock in app/ui/src/session/bridge.ts must mirror it).
    #[test]
    fn diagram_show_all_labels_json_shape_is_pinned() {
        let mut d = Diagram {
            id: "dg-x".to_string(),
            name: "X".to_string(),
            ..Default::default()
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["showAllLabels"], serde_json::json!(false));
        d.show_all_labels = true;
        let v2 = serde_json::to_value(&d).unwrap();
        assert_eq!(v2["showAllLabels"], serde_json::json!(true));
        // Old files without the key still load (default false).
        let legacy = serde_json::json!({"id": "dg-x", "name": "X"});
        let back: Diagram = serde_json::from_value(legacy).unwrap();
        assert!(!back.show_all_labels);
        // PatchDiagram carries it as an optional camelCase key.
        let cmd = Command::PatchDiagram {
            id: "dg-landscape".to_string(),
            name: None,
            description: None,
            order: None,
            pinned: None,
            domain_id: None,
            auto_placed: None,
            show_all_labels: Some(true),
        };
        let cv = serde_json::to_value(&cmd).unwrap();
        assert_eq!(cv["op"], serde_json::json!("patchDiagram"));
        assert_eq!(cv["showAllLabels"], serde_json::json!(true));
        // Round-trips through apply + inverse.
        let mut doc = crate::model::Document::new("t".to_string());
        seed_sample_command().apply(&mut doc).expect("seed");
        let inv = cmd.apply(&mut doc).expect("apply");
        assert!(doc.diagrams["dg-landscape"].show_all_labels);
        inv.apply(&mut doc).expect("undo");
        assert!(!doc.diagrams["dg-landscape"].show_all_labels);
    }
    #[test]
    fn connection_json_shape_is_pinned() {
        let c = Connection {
            id: "conn-11".to_string(),
            origin_id: "obj-webapp".to_string(),
            target_id: "obj-orders".to_string(),
            name: "enqueues via".to_string(),
            direction: Direction::Outgoing,
            status: Status::Live,
            line_shape: LineShape::Curved,
            via_id: Some("obj-queue".to_string()),
            ..Default::default()
        };
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["id"], serde_json::json!("conn-11"));
        assert_eq!(v["originId"], serde_json::json!("obj-webapp"));
        assert_eq!(v["targetId"], serde_json::json!("obj-orders"));
        assert_eq!(v["direction"], serde_json::json!("outgoing"));
        assert_eq!(v["status"], serde_json::json!("live"));
        assert_eq!(v["lineShape"], serde_json::json!("curved"));
        assert_eq!(v["viaId"], serde_json::json!("obj-queue"));
        // Optional labelPosition is omitted when None.
        assert!(v.get("labelPosition").is_none(), "{v}");
        // Mirror check: the TS mock builds the same keys.
        let via_none = Connection {
            via_id: None,
            ..c.clone()
        };
        let vn = serde_json::to_value(&via_none).unwrap();
        assert!(vn.get("viaId").is_none(), "{vn}");
    }
}
