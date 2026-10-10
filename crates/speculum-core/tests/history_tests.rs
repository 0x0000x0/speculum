mod fixtures;

use fixtures::sample_document;
use speculum_core::{Command, History, ObjectPatch};

#[test]
fn merge_within_1s_single_field() {
    let mut doc = sample_document();
    let mut h = History::new();
    h.dispatch(
        &mut doc,
        Command::PatchObject {
            id: "obj-webapp".to_string(),
            patch: ObjectPatch { name: Some("A".to_string()), ..Default::default() },
        },
        1000,
    )
    .unwrap();
    h.dispatch(
        &mut doc,
        Command::PatchObject {
            id: "obj-webapp".to_string(),
            patch: ObjectPatch { name: Some("AB".to_string()), ..Default::default() },
        },
        1500,
    )
    .unwrap();
    assert_eq!(h.undo.len(), 1);
    assert_eq!(doc.model.objects["obj-webapp"].name, "AB");
    h.undo(&mut doc).unwrap();
    assert_eq!(doc.model.objects["obj-webapp"].name, "Web App");
}

#[test]
fn no_merge_after_1s() {
    let mut doc = sample_document();
    let mut h = History::new();
    h.dispatch(
        &mut doc,
        Command::PatchObject {
            id: "obj-webapp".to_string(),
            patch: ObjectPatch { name: Some("A".to_string()), ..Default::default() },
        },
        1000,
    )
    .unwrap();
    h.dispatch(
        &mut doc,
        Command::PatchObject {
            id: "obj-webapp".to_string(),
            patch: ObjectPatch { name: Some("AB".to_string()), ..Default::default() },
        },
        2500,
    )
    .unwrap();
    assert_eq!(h.undo.len(), 2);
}

#[test]
fn no_merge_different_field_or_id() {
    let mut doc = sample_document();
    let mut h = History::new();
    h.dispatch(
        &mut doc,
        Command::PatchObject {
            id: "obj-webapp".to_string(),
            patch: ObjectPatch { name: Some("A".to_string()), ..Default::default() },
        },
        1000,
    )
    .unwrap();
    h.dispatch(
        &mut doc,
        Command::PatchObject {
            id: "obj-webapp".to_string(),
            patch: ObjectPatch { caption: Some("C".to_string()), ..Default::default() },
        },
        1200,
    )
    .unwrap();
    assert_eq!(h.undo.len(), 2);
}

#[test]
fn undo_redo_chain_clears_redo_on_dispatch() {
    let mut doc = sample_document();
    let mut h = History::new();
    h.dispatch(
        &mut doc,
        Command::PatchObject {
            id: "obj-webapp".to_string(),
            patch: ObjectPatch { name: Some("A".to_string()), ..Default::default() },
        },
        0,
    )
    .unwrap();
    h.dispatch(
        &mut doc,
        Command::PatchObject {
            id: "obj-orders".to_string(),
            patch: ObjectPatch { name: Some("B".to_string()), ..Default::default() },
        },
        2000,
    )
    .unwrap();
    assert!(h.undo(&mut doc).unwrap());
    assert_eq!(doc.model.objects["obj-orders"].name, "Orders Store");
    assert!(h.undo(&mut doc).unwrap());
    assert_eq!(doc.model.objects["obj-webapp"].name, "Web App");
    assert!(h.redo(&mut doc).unwrap());
    assert_eq!(doc.model.objects["obj-webapp"].name, "A");
    // new dispatch clears redo
    h.dispatch(
        &mut doc,
        Command::PatchObject {
            id: "obj-webapp".to_string(),
            patch: ObjectPatch { name: Some("Z".to_string()), ..Default::default() },
        },
        5000,
    )
    .unwrap();
    assert!(h.redo.is_empty());
    assert!(!h.redo(&mut doc).unwrap());
    assert!(!History::new().undo(&mut doc).unwrap());
}

#[test]
fn limit_trimming_and_moveboxes_no_merge() {
    let mut doc = sample_document();
    let mut h = History::with_limit(3);
    for i in 0..5 {
        h.dispatch(
            &mut doc,
            Command::PatchObject {
                id: "obj-webapp".to_string(),
                patch: ObjectPatch { description: Some(format!("d{i}")), ..Default::default() },
            },
            (i as u64) * 5000,
        )
        .unwrap();
    }
    assert_eq!(h.undo.len(), 3);
    // MoveBoxes always one step per dispatch (no merge even within 1s)
    let mut h2 = History::new();
    let m1 = std::collections::BTreeMap::from([(
        "obj-customer".to_string(),
        speculum_core::Rect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
    )]);
    let m2 = std::collections::BTreeMap::from([(
        "obj-customer".to_string(),
        speculum_core::Rect { x: 5.0, y: 5.0, w: 1.0, h: 1.0 },
    )]);
    h2.dispatch(
        &mut doc,
        Command::MoveBoxes { diagram_id: "diag-context".to_string(), moves: m1 },
        100,
    )
    .unwrap();
    h2.dispatch(
        &mut doc,
        Command::MoveBoxes { diagram_id: "diag-context".to_string(), moves: m2 },
        200,
    )
    .unwrap();
    assert_eq!(h2.undo.len(), 2);
}
