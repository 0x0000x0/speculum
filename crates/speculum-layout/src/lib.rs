use speculum_core::{Document, Id, ObjectKind, Rect};
use std::collections::BTreeMap;

pub const BOX_W: f64 = 240.0;
pub const BOX_H: f64 = 120.0;
pub const GAP: f64 = 48.0;
pub const ORIGIN_X: f64 = 64.0;
pub const ORIGIN_Y: f64 = 64.0;

fn kind_rank(k: &ObjectKind) -> u8 {
    match k {
        ObjectKind::Actor => 0,
        ObjectKind::System => 1,
        ObjectKind::Group => 2,
        ObjectKind::App => 3,
        ObjectKind::Store => 4,
        ObjectKind::Component => 5,
    }
}

fn snap8(v: f64) -> f64 {
    (v / 8.0).round() * 8.0
}

fn overlaps(a: &Rect, b: &Rect) -> bool {
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/// Compute rects for boxes on `diagram_id` that have no rect or have
/// zero width/height. Existing valid rects are never touched and the
/// result never overlaps them. Deterministic: sorted by kind order
/// (actor, system, group, app, store, component) then name then id.
pub fn place_missing(doc: &Document, diagram_id: &Id) -> BTreeMap<Id, Rect> {
    let diagram = match doc.diagrams.get(diagram_id) {
        Some(d) => d,
        None => return BTreeMap::new(),
    };
    // Existing valid rects occupy space.
    let mut occupied: Vec<Rect> = diagram
        .boxes
        .values()
        .filter(|r| r.w > 0.0 && r.h > 0.0)
        .cloned()
        .collect();

    // Missing ids: box entry with w/h == 0. (Callers that want to add
    // objects not yet on the diagram should AddToDiagram with these rects.)
    let mut missing: Vec<(Id, u8, String)> = Vec::new();
    for (id, rect) in &diagram.boxes {
        if rect.w <= 0.0 || rect.h <= 0.0 {
            let obj = doc.model.objects.get(id);
            let rank = obj.map(|o| kind_rank(&o.kind)).unwrap_or(6);
            let name = obj.map(|o| o.name.clone()).unwrap_or_default();
            missing.push((id.clone(), rank, name));
        }
    }
    missing.sort_by(|a, b| {
        a.1.cmp(&b.1)
            .then_with(|| a.2.cmp(&b.2))
            .then_with(|| a.0.cmp(&b.0))
    });

    let mut out = BTreeMap::new();
    let cell_w = BOX_W + GAP;
    let cell_h = BOX_H + GAP;
    // Cursor over an unbounded row-major grid; skip cells that overlap.
    let mut cell: usize = 0;
    for (id, _, _) in missing {
        loop {
            let col = cell % 4;
            let row = cell / 4;
            cell += 1;
            let r = Rect {
                x: snap8(ORIGIN_X + col as f64 * cell_w),
                y: snap8(ORIGIN_Y + row as f64 * cell_h),
                w: BOX_W,
                h: BOX_H,
            };
            if occupied.iter().any(|o| overlaps(o, &r)) {
                continue;
            }
            occupied.push(r.clone());
            out.insert(id, r);
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use speculum_core::{Diagram, DiagramLevel, Object};
    use std::collections::BTreeMap;

    fn doc_with_diagram(boxes: BTreeMap<Id, Rect>, objs: Vec<Object>) -> (Document, Id) {
        let mut doc = Document::new("t".to_string());
        for o in objs {
            doc.model.objects.insert(o.id.clone(), o);
        }
        let did = "d1".to_string();
        doc.diagrams.insert(
            did.clone(),
            Diagram {
                id: did.clone(),
                name: "D".to_string(),
                level: DiagramLevel::Context,
                boxes,
                ..Default::default()
            },
        );
        (doc, did)
    }

    fn obj(id: &str, name: &str, kind: ObjectKind) -> Object {
        Object {
            id: id.to_string(),
            name: name.to_string(),
            kind,
            ..Default::default()
        }
    }

    #[test]
    fn no_overlaps_and_snapped() {
        let mut boxes = BTreeMap::new();
        boxes.insert(
            "a".to_string(),
            Rect { x: 64.0, y: 64.0, w: 240.0, h: 120.0 },
        );
        boxes.insert("b".to_string(), Rect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 });
        boxes.insert("c".to_string(), Rect { x: 10.0, y: 10.0, w: 0.0, h: 5.0 });
        let (doc, did) = doc_with_diagram(
            boxes,
            vec![
                obj("a", "A", ObjectKind::System),
                obj("b", "B", ObjectKind::App),
                obj("c", "C", ObjectKind::Actor),
            ],
        );
        let placed = place_missing(&doc, &did);
        assert_eq!(placed.len(), 2);
        // Existing rect untouched: not in output.
        assert!(!placed.contains_key("a"));
        let all: Vec<Rect> = vec![
            Rect { x: 64.0, y: 64.0, w: 240.0, h: 120.0 },
            placed["b"].clone(),
            placed["c"].clone(),
        ];
        for r in &all[1..] {
            assert_eq!(r.w, BOX_W);
            assert_eq!(r.h, BOX_H);
            assert_eq!(r.x % 8.0, 0.0);
            assert_eq!(r.y % 8.0, 0.0);
        }
        assert!(!overlaps(&all[0], &all[1]));
        assert!(!overlaps(&all[0], &all[2]));
        assert!(!overlaps(&all[1], &all[2]));
    }

    #[test]
    fn deterministic_kind_order() {
        let mut boxes = BTreeMap::new();
        for id in ["s1", "a1", "c1"] {
            boxes.insert(id.to_string(), Rect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 });
        }
        let (doc, did) = doc_with_diagram(
            boxes,
            vec![
                obj("s1", "Zulu", ObjectKind::System),
                obj("a1", "Zulu", ObjectKind::Actor),
                obj("c1", "Alpha", ObjectKind::Component),
            ],
        );
        let p1 = place_missing(&doc, &did);
        let p2 = place_missing(&doc, &did);
        assert_eq!(p1, p2);
        // Actor first at origin.
        assert_eq!(p1["a1"].x, ORIGIN_X);
        assert_eq!(p1["a1"].y, ORIGIN_Y);
        // System next, component last.
        assert!(p1["s1"].x > p1["a1"].x || p1["s1"].y > p1["a1"].y);
        let last = &p1["c1"];
        let first = &p1["a1"];
        assert!(last.x >= first.x && last.y >= first.y);
    }

    #[test]
    fn unknown_diagram_is_empty() {
        let doc = Document::new("t".to_string());
        let out = place_missing(&doc, &"nope".to_string());
        assert!(out.is_empty());
    }
}
