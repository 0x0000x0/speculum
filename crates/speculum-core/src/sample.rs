//! Made-up sample document for the empty-state "Open sample" action.
//! All names are synthetic. Dispatched as ONE Batch command (one undo step).

use crate::model::{
    Connection, Diagram, DiagramLevel, Direction, Object, ObjectKind, Rect, Tag,
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
    ] {
        cmds.push(Command::CreateObject { object: o });
    }

    for c in [
        conn("conn-1", "obj-customer", "obj-webapp", "browses", Direction::Outgoing),
        conn("conn-2", "obj-mobile", "obj-orders", "reads", Direction::Outgoing),
        conn("conn-3", "obj-webapp", "obj-payments-api", "charges via", Direction::Outgoing),
        conn("conn-4", "obj-payments-api", "obj-orders", "syncs", Direction::Bidirectional),
        conn("conn-5", "obj-support", "obj-orders", "looks up", Direction::Outgoing),
        conn("conn-6", "obj-cart", "obj-checkout", "hands off", Direction::Outgoing),
        conn("conn-7", "obj-checkout", "obj-tokenizer", "tokenizes via", Direction::Outgoing),
        conn("conn-8", "obj-tokenizer", "obj-vault", "stores in", Direction::Outgoing),
        conn("conn-9", "obj-cart", "obj-cart-item", "holds", Direction::Outgoing),
    ] {
        cmds.push(Command::Connect { connection: c });
    }

    // Hand-made rects: 240x120 boxes, 8px grid, no overlaps per diagram.
    let mut landscape = BTreeMap::new();
    landscape.insert("obj-customer".to_string(), rect(64.0, 64.0, 240.0, 120.0));
    landscape.insert("obj-support".to_string(), rect(64.0, 232.0, 240.0, 120.0));
    landscape.insert("obj-storefront".to_string(), rect(352.0, 64.0, 240.0, 120.0));
    landscape.insert("obj-payments".to_string(), rect(352.0, 232.0, 240.0, 120.0));
    landscape.insert("obj-cloud".to_string(), rect(640.0, 64.0, 240.0, 288.0));

    let mut apps = BTreeMap::new();
    apps.insert("obj-webapp".to_string(), rect(64.0, 64.0, 240.0, 120.0));
    apps.insert("obj-mobile".to_string(), rect(352.0, 64.0, 240.0, 120.0));
    apps.insert("obj-orders".to_string(), rect(640.0, 64.0, 240.0, 120.0));
    apps.insert("obj-cart".to_string(), rect(64.0, 232.0, 240.0, 120.0));
    apps.insert("obj-checkout".to_string(), rect(352.0, 232.0, 240.0, 120.0));

    let mut internals = BTreeMap::new();
    // NOTE: the scope object itself is never a box on its own diagram;
    // the UI draws the scope FRAME instead (M5).
    internals.insert("obj-tokenizer".to_string(), rect(64.0, 64.0, 240.0, 120.0));
    internals.insert("obj-vault".to_string(), rect(352.0, 64.0, 240.0, 120.0));
    internals.insert("obj-checkout".to_string(), rect(64.0, 232.0, 240.0, 120.0));

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
        assert_eq!(doc.model.objects.len(), 14);
        assert_eq!(doc.model.connections.len(), 9);
        assert_eq!(doc.diagrams.len(), 3);
        // Rects on 8px grid, no overlaps per diagram.
        for d in doc.diagrams.values() {
            for r in d.boxes.values() {
                assert_eq!(r.x % 8.0, 0.0);
                assert_eq!(r.y % 8.0, 0.0);
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
        // Undo restores empty.
        inv.apply(&mut doc).expect("undo");
        assert!(is_empty_model(&doc));
    }
}
