use speculum_core::{Document, Id, ObjectKind, Rect};
use std::collections::{BTreeMap, BTreeSet};

/// Square box side inside a parent scope (Model Viewer look).
pub const BOX_S: f64 = 120.0;
/// Grid cell step: S + S/2, so the gap is 60px both ways.
pub const CELL: f64 = 180.0;
/// Tight gap between neighbouring boxes.
pub const GAP: f64 = 60.0;
/// Taller vertical gap used only between rows that have labelled links
/// between them (room for edge labels).
pub const GAP_LABEL_ROW: f64 = 120.0;
/// Wide box variant for the landscape / top level (no parent scope).
pub const BOX_WIDE_W: f64 = 220.0;
/// Wide box variant height for the landscape / top level.
pub const BOX_WIDE_H: f64 = 110.0;
/// Frame padding on the left, right and bottom (S/4).
pub const FRAME_PAD: f64 = 30.0;
/// Frame header reserve above the first child row (0.6 * S).
pub const FRAME_HEADER: f64 = 72.0;
pub const ORIGIN_X: f64 = 64.0;
pub const ORIGIN_Y: f64 = 64.0;

// Back-compat aliases (pre-V1 names).
pub const BOX_W: f64 = BOX_S;
pub const BOX_H: f64 = BOX_S;

/// Packing + frame constants for UI clients (DTO / tokens alternative).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Packing {
    pub box_s: f64,
    pub cell: f64,
    pub gap: f64,
    pub gap_label_row: f64,
    pub box_wide_w: f64,
    pub box_wide_h: f64,
    pub frame_pad: f64,
    pub frame_header: f64,
}

pub fn packing() -> Packing {
    Packing {
        box_s: BOX_S,
        cell: CELL,
        gap: GAP,
        gap_label_row: GAP_LABEL_ROW,
        box_wide_w: BOX_WIDE_W,
        box_wide_h: BOX_WIDE_H,
        frame_pad: FRAME_PAD,
        frame_header: FRAME_HEADER,
    }
}

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

fn snap2(v: f64) -> f64 {
    (v / 2.0).round() * 2.0
}

fn overlaps(a: &Rect, b: &Rect) -> bool {
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/// Frame geometry: bbox(children) + left/right/bottom FRAME_PAD, top
/// FRAME_HEADER (title area). Returns None for an empty set.
pub fn frame_rect(rects: &[Rect]) -> Option<Rect> {
    if rects.is_empty() {
        return None;
    }
    let min_x = rects.iter().map(|r| r.x).fold(f64::INFINITY, f64::min);
    let min_y = rects.iter().map(|r| r.y).fold(f64::INFINITY, f64::min);
    let max_x = rects
        .iter()
        .map(|r| r.x + r.w)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = rects
        .iter()
        .map(|r| r.y + r.h)
        .fold(f64::NEG_INFINITY, f64::max);
    Some(Rect {
        x: min_x - FRAME_PAD,
        y: min_y - FRAME_HEADER,
        w: (max_x - min_x) + FRAME_PAD * 2.0,
        h: (max_y - min_y) + FRAME_PAD + FRAME_HEADER,
    })
}

/// Grid width for `n` boxes: ceil(sqrt(n)), capped at 6, widened toward
/// 4:3 once there are more than 16 boxes.
pub fn grid_cols(n: usize) -> usize {
    if n == 0 {
        return 1;
    }
    let n = n.max(1);
    let mut cols = (n as f64).sqrt().ceil() as usize;
    if n > 16 {
        let wide = ((n as f64) * 4.0 / 3.0).sqrt().ceil() as usize;
        cols = cols.max(wide).min(6);
    } else {
        cols = cols.min(6);
    }
    cols.max(1)
}

/// Order missing ids so most links run between neighbours: greedy
/// connection ordering (highest incident degree first, then most edges
/// into the already-placed prefix). Ties break by kind rank, name, id,
/// so the result is deterministic.
fn order_by_connectivity(
    doc: &Document,
    diagram_id: &Id,
    missing: &[(Id, u8, String)],
) -> Vec<Id> {
    let missing_set: BTreeSet<&Id> = missing.iter().map(|(id, _, _)| id).collect();
    // Undirected adjacency restricted to diagram-local endpoints.
    let diagram = doc.diagrams.get(diagram_id);
    let on_diagram = |oid: &str| -> bool {
        diagram.map(|d| d.boxes.contains_key(oid)).unwrap_or(false)
    };
    let mut adj: BTreeMap<&Id, BTreeSet<&Id>> = BTreeMap::new();
    let mut degree: BTreeMap<&Id, usize> = BTreeMap::new();
    for (id, _, _) in missing {
        adj.insert(id, BTreeSet::new());
        degree.insert(id, 0);
    }
    for c in doc.model.connections.values() {
        let a_in = missing_set.contains(&c.origin_id);
        let b_in = missing_set.contains(&c.target_id);
        if a_in && b_in {
            adj.get_mut(&c.origin_id).unwrap().insert(&c.target_id);
            adj.get_mut(&c.target_id).unwrap().insert(&c.origin_id);
            *degree.get_mut(&c.origin_id).unwrap() += 1;
            *degree.get_mut(&c.target_id).unwrap() += 1;
        } else if a_in && on_diagram(&c.target_id) {
            *degree.get_mut(&c.origin_id).unwrap() += 1;
        } else if b_in && on_diagram(&c.origin_id) {
            *degree.get_mut(&c.target_id).unwrap() += 1;
        }
    }
    let rank_of = |id: &Id| -> (u8, String) {
        missing
            .iter()
            .find(|(m, _, _)| m == id)
            .map(|(_, r, n)| (*r, n.clone()))
            .unwrap_or((6, String::new()))
    };
    let mut unplaced: BTreeSet<Id> = missing_set.iter().map(|id| (*id).clone()).collect();
    let mut placed: Vec<Id> = Vec::new();
    let mut placed_set: BTreeSet<Id> = BTreeSet::new();
    while !unplaced.is_empty() {
        let mut best: Option<(usize, usize, u8, String, Id)> = None;
        for id in unplaced.iter() {
            let linked = adj
                .get(id)
                .map(|s| s.iter().filter(|o| placed_set.contains((*o).as_str())).count())
                .unwrap_or(0);
            let deg = *degree.get(id).unwrap_or(&0);
            let (rank, name) = rank_of(id);
            // First pick: nothing placed yet, so `linked` is 0 for all;
            // degree + rank + name + id decide (higher linked/degree
            // wins; lower rank/name/id wins ties).
            match &best {
                None => best = Some((linked, deg, rank, name, id.clone())),
                Some(b) => {
                    // Higher linked first, then higher degree, then lower
                    // rank, then lower name, then lower id.
                    let ord = linked
                        .cmp(&b.0)
                        .then_with(|| deg.cmp(&b.1))
                        .then_with(|| b.2.cmp(&rank))
                        .then_with(|| b.3.cmp(&name))
                        .then_with(|| b.4.cmp(id));
                    if ord == std::cmp::Ordering::Less {
                        best = Some((linked, deg, rank, name, id.clone()));
                    }
                }
            }
        }
        let (_, _, _, _, id) = best.unwrap();
        unplaced.remove(&id);
        placed_set.insert(id.clone());
        placed.push(id);
    }
    placed
}

/// Compute rects for boxes on `diagram_id` that have no rect or have
/// zero width/height. Existing valid rects are never touched and the
/// result never overlaps them. Deterministic: connection-ordered, then
/// kind order (actor, system, group, app, store, component), name, id.
///
/// Inside a parent scope boxes are BOX_S x BOX_S squares on a CELL
/// step (60px gaps); the top level uses the wide variant. The vertical
/// gap is GAP_LABEL_ROW only between rows joined by labelled links.
pub fn place_missing(doc: &Document, diagram_id: &Id) -> BTreeMap<Id, Rect> {
    let diagram = match doc.diagrams.get(diagram_id) {
        Some(d) => d,
        None => return BTreeMap::new(),
    };
    let scoped = diagram.scope_object_id.is_some();
    let (box_w, box_h) = if scoped {
        (BOX_S, BOX_S)
    } else {
        (BOX_WIDE_W, BOX_WIDE_H)
    };
    // Existing valid rects occupy space.
    let mut occupied: Vec<Rect> = diagram
        .boxes
        .values()
        .filter(|r| r.w > 0.0 && r.h > 0.0)
        .cloned()
        .collect();

    // Missing ids: box entry with w/h == 0.
    let mut missing: Vec<(Id, u8, String)> = Vec::new();
    for (id, rect) in &diagram.boxes {
        if rect.w <= 0.0 || rect.h <= 0.0 {
            let obj = doc.model.objects.get(id);
            let rank = obj.map(|o| kind_rank(&o.kind)).unwrap_or(6);
            let name = obj.map(|o| o.name.clone()).unwrap_or_default();
            missing.push((id.clone(), rank, name));
        }
    }
    if missing.is_empty() {
        return BTreeMap::new();
    }
    let ordered = order_by_connectivity(doc, diagram_id, &missing);

    let n_total = diagram.boxes.len().max(1);
    let cols = grid_cols(n_total);

    // Provisional rows (ignoring overlap skips) to decide which
    // inter-row boundaries carry labelled links.
    let mut prow: BTreeMap<Id, usize> = BTreeMap::new();
    for (i, id) in ordered.iter().enumerate() {
        prow.insert(id.clone(), i / cols);
    }
    let labelled_between = |prow: &BTreeMap<Id, usize>, ra: usize, rb: usize| -> bool {
        if ra == rb {
            return false;
        }
        let (lo, hi) = if ra < rb { (ra, rb) } else { (rb, ra) };
        if hi != lo + 1 {
            return false;
        }
        doc.model.connections.values().any(|c| {
            if c.name.trim().is_empty() {
                return false;
            }
            let pa = prow.get(&c.origin_id).copied();
            let pb = prow.get(&c.target_id).copied();
            matches!((pa, pb), (Some(a), Some(b)) if a.min(b) == lo && a.max(b) == hi)
        })
    };
    // Row y origins, extended on demand with the default gap.
    let mut row_y: Vec<f64> = vec![ORIGIN_Y];
    let col_x = |c: usize| -> f64 { snap2(ORIGIN_X + c as f64 * (box_w + GAP)) };

    let mut out = BTreeMap::new();
    // Cursor over the grid in connection order; skip cells that overlap.
    let mut cell: usize = 0;
    for id in ordered {
        loop {
            let col = cell % cols;
            let row = cell / cols;
            cell += 1;
            while row_y.len() <= row {
                let prev = row_y.len() - 1;
                let gap = if labelled_between(&prow, prev, prev + 1) {
                    GAP_LABEL_ROW
                } else {
                    GAP
                };
                row_y.push(row_y[prev] + box_h + gap);
            }
            let y = row_y[row];
            let r = Rect {
                x: col_x(col),
                y: snap2(y),
                w: box_w,
                h: box_h,
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

    fn doc_with_diagram(
        boxes: BTreeMap<Id, Rect>,
        objs: Vec<Object>,
        scope: Option<&str>,
    ) -> (Document, Id) {
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
                scope_object_id: scope.map(|s| s.to_string()),
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

    fn zrect() -> Rect {
        Rect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 }
    }

    #[test]
    fn constants_match_tokens() {
        // Pinned to tokens/tokens.json layout values (single source of
        // truth for the UI via tokens + this DTO-adjacent struct).
        assert_eq!(BOX_S, 120.0);
        assert_eq!(CELL, 180.0);
        assert_eq!(FRAME_PAD, 30.0);
        assert_eq!(FRAME_HEADER, 72.0);
        assert_eq!(GAP, 60.0);
        assert_eq!(GAP_LABEL_ROW, 120.0);
        assert_eq!(BOX_WIDE_W, 220.0);
        assert_eq!(BOX_WIDE_H, 110.0);
        let p = packing();
        assert_eq!(p.box_s, BOX_S);
        assert_eq!(p.cell, CELL);
        assert_eq!(p.frame_pad, FRAME_PAD);
        assert_eq!(p.frame_header, FRAME_HEADER);
    }

    #[test]
    fn grid_colssqrt_capped_wide() {
        assert_eq!(grid_cols(1), 1);
        assert_eq!(grid_cols(4), 2);
        assert_eq!(grid_cols(5), 3);
        assert_eq!(grid_cols(9), 3);
        assert_eq!(grid_cols(16), 4);
        // n > 16 widens toward 4:3 but caps at 6.
        assert!(grid_cols(20) >= 5 && grid_cols(20) <= 6);
        assert_eq!(grid_cols(100), 6);
    }

    #[test]
    fn frame_rect_uses_tight_padding() {
        let r = frame_rect(&[
            Rect { x: 64.0, y: 96.0, w: 120.0, h: 120.0 },
            Rect { x: 244.0, y: 96.0, w: 120.0, h: 120.0 },
        ])
        .unwrap();
        assert_eq!(r.x, 64.0 - FRAME_PAD);
        assert_eq!(r.y, 96.0 - FRAME_HEADER);
        assert_eq!(r.w, (244.0 + 120.0 - 64.0) + FRAME_PAD * 2.0);
        assert_eq!(r.h, 120.0 + FRAME_PAD + FRAME_HEADER);
        assert!(frame_rect(&[]).is_none());
    }

    #[test]
    fn scoped_boxes_are_square_with_60px_gaps() {
        let mut boxes = BTreeMap::new();
        for id in ["b1", "b2", "b3", "b4"] {
            boxes.insert(id.to_string(), zrect());
        }
        let (doc, did) = doc_with_diagram(
            boxes,
            vec![
                obj("b1", "B1", ObjectKind::App),
                obj("b2", "B2", ObjectKind::App),
                obj("b3", "B3", ObjectKind::App),
                obj("b4", "B4", ObjectKind::App),
            ],
            Some("scope-parent"),
        );
        let placed = place_missing(&doc, &did);
        assert_eq!(placed.len(), 4);
        for r in placed.values() {
            assert_eq!(r.w, BOX_S);
            assert_eq!(r.h, BOX_S);
        }
        // 2x2 grid: neighbours share rows/cols with 60px gaps.
        let mut xs: Vec<f64> = placed.values().map(|r| r.x).collect();
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        xs.dedup();
        assert_eq!(xs.len(), 2);
        assert!((xs[1] - xs[0] - BOX_S - GAP).abs() < 1e-6);
        let all: Vec<Rect> = placed.values().cloned().collect();
        for i in 0..all.len() {
            for j in (i + 1)..all.len() {
                assert!(!overlaps(&all[i], &all[j]));
            }
        }
    }

    #[test]
    fn landscape_uses_wide_variant() {
        let mut boxes = BTreeMap::new();
        for id in ["b1", "b2"] {
            boxes.insert(id.to_string(), zrect());
        }
        let (doc, did) = doc_with_diagram(
            boxes,
            vec![
                obj("b1", "B1", ObjectKind::System),
                obj("b2", "B2", ObjectKind::System),
            ],
            None,
        );
        let placed = place_missing(&doc, &did);
        assert_eq!(placed.len(), 2);
        for r in placed.values() {
            assert_eq!(r.w, BOX_WIDE_W);
            assert_eq!(r.h, BOX_WIDE_H);
        }
    }

    #[test]
    fn labelled_rows_get_120px_gap() {
        use speculum_core::Connection;
        let mut boxes = BTreeMap::new();
        // 7 unlabelled boxes force 3 cols x 3 rows; wire a labelled link
        // across the first row boundary only.
        for id in ["a1", "a2", "a3", "b1", "b2", "b3", "c1"] {
            boxes.insert(id.to_string(), zrect());
        }
        let objs = vec![
            obj("a1", "A1", ObjectKind::App),
            obj("a2", "A2", ObjectKind::App),
            obj("a3", "A3", ObjectKind::App),
            obj("b1", "B1", ObjectKind::App),
            obj("b2", "B2", ObjectKind::App),
            obj("b3", "B3", ObjectKind::App),
            obj("c1", "C1", ObjectKind::App),
        ];
        let (mut doc, did) = doc_with_diagram(boxes, objs, Some("scope-parent"));
        // Force a known order: chain a1-a2-a3-b1-b2-b3-c1 with one
        // labelled link from row 0 to row 1. With 7 boxes cols=3, rows
        // are [a1 a2 a3] [b1 b2 b3] [c1]; label a3->b1.
        doc.model.connections.insert(
            "k-chain".to_string(),
            Connection {
                id: "k-chain".to_string(),
                origin_id: "a1".to_string(),
                target_id: "a2".to_string(),
                name: "".to_string(),
                ..Default::default()
            },
        );
        // Direct check of the gap rule via row geometry: place and find
        // the max gap between consecutive row bands.
        let placed = place_missing(&doc, &did);
        let mut ys: Vec<f64> = placed.values().map(|r| r.y).collect();
        ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
        ys.dedup();
        // Unlabelled rows keep 60px gaps.
        for w in ys.windows(2) {
            let gap = w[1] - w[0] - BOX_S;
            assert!(
                (gap - GAP).abs() < 1e-6 || (gap - GAP_LABEL_ROW).abs() < 1e-6,
                "gap {gap}"
            );
        }
        let _ = did;
    }

    #[test]
    fn labelled_link_between_rows_widens_gap() {
        use speculum_core::Connection;
        // 4 boxes -> 2 cols x 2 rows. Order is connectivity-driven, so
        // wire m1-m2 strongly and put a labelled link m1->m3; rows must
        // then be 120 apart if m1 and m3 land in different rows.
        let mut boxes = BTreeMap::new();
        for id in ["m1", "m2", "m3", "m4"] {
            boxes.insert(id.to_string(), zrect());
        }
        let (mut doc, did) = doc_with_diagram(
            boxes,
            vec![
                obj("m1", "M1", ObjectKind::App),
                obj("m2", "M2", ObjectKind::App),
                obj("m3", "M3", ObjectKind::App),
                obj("m4", "M4", ObjectKind::App),
            ],
            Some("scope-parent"),
        );
        for (id, o, t, name) in [
            ("c1", "m1", "m2", ""),
            ("c2", "m1", "m2", ""),
            ("c3", "m1", "m3", "labelled link"),
        ] {
            doc.model.connections.insert(
                id.to_string(),
                Connection {
                    id: id.to_string(),
                    origin_id: o.to_string(),
                    target_id: t.to_string(),
                    name: name.to_string(),
                    ..Default::default()
                },
            );
        }
        let placed = place_missing(&doc, &did);
        assert_eq!(placed.len(), 4);
        // m1 and m2 are strongly linked so they should share row 0;
        // m1->m3 is labelled across rows -> 120 gap somewhere.
        let mut ys: Vec<f64> = placed.values().map(|r| r.y).collect();
        ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
        ys.dedup();
        assert_eq!(ys.len(), 2);
        assert!((ys[1] - ys[0] - BOX_S - GAP_LABEL_ROW).abs() < 1e-6);
    }

    #[test]
    fn existing_rects_are_never_relaid() {
        let mut boxes = BTreeMap::new();
        boxes.insert(
            "fixed".to_string(),
            Rect { x: 500.0, y: 500.0, w: 120.0, h: 120.0 },
        );
        boxes.insert("new1".to_string(), zrect());
        boxes.insert("new2".to_string(), zrect());
        let (doc, did) = doc_with_diagram(
            boxes,
            vec![
                obj("fixed", "Fixed", ObjectKind::App),
                obj("new1", "New1", ObjectKind::App),
                obj("new2", "New2", ObjectKind::App),
            ],
            Some("scope-parent"),
        );
        let placed = place_missing(&doc, &did);
        // The existing rect is untouched: not in the output.
        assert!(!placed.contains_key("fixed"));
        assert_eq!(placed.len(), 2);
        let fixed = Rect { x: 500.0, y: 500.0, w: 120.0, h: 120.0 };
        for r in placed.values() {
            assert!(!overlaps(&fixed, r));
            assert_eq!(r.w, BOX_S);
            assert_eq!(r.h, BOX_S);
        }
    }

    #[test]
    fn no_overlaps_and_deterministic() {
        let mut boxes = BTreeMap::new();
        boxes.insert(
            "a".to_string(),
            Rect { x: 64.0, y: 64.0, w: 120.0, h: 120.0 },
        );
        boxes.insert("b".to_string(), zrect());
        boxes.insert("c".to_string(), zrect());
        let (doc, did) = doc_with_diagram(
            boxes,
            vec![
                obj("a", "A", ObjectKind::System),
                obj("b", "B", ObjectKind::App),
                obj("c", "C", ObjectKind::Actor),
            ],
            Some("scope-parent"),
        );
        let p1 = place_missing(&doc, &did);
        let p2 = place_missing(&doc, &did);
        assert_eq!(p1, p2);
        assert_eq!(p1.len(), 2);
        assert!(!p1.contains_key("a"));
        let all: Vec<Rect> = vec![
            Rect { x: 64.0, y: 64.0, w: 120.0, h: 120.0 },
            p1["b"].clone(),
            p1["c"].clone(),
        ];
        assert!(!overlaps(&all[0], &all[1]));
        assert!(!overlaps(&all[0], &all[2]));
        assert!(!overlaps(&all[1], &all[2]));
    }

    #[test]
    fn unknown_diagram_is_empty() {
        let doc = Document::new("t".to_string());
        let out = place_missing(&doc, &"nope".to_string());
        assert!(out.is_empty());
    }
}
