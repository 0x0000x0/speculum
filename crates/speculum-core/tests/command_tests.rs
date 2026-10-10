mod fixtures;

use fixtures::sample_document;
use speculum_core::{
    Command, Connection, ConnectionPatch, CoreError, Diagram, DiagramLevel, Document,
    Domain, EdgeLayout, Flow, FlowPath, FlowStep, Object, ObjectKind, ObjectPatch, Rect,
    StepKind, Tag, TagGroup, Viewport,
};
use std::collections::BTreeMap;

fn rect() -> Rect {
    Rect { x: 1.0, y: 2.0, w: 50.0, h: 60.0 }
}

fn apply_invert_restores(mut doc: Document, cmd: Command) {
    let before = doc.clone();
    let inv = cmd.apply(&mut doc).expect("apply should succeed");
    let _ = inv.apply(&mut doc).expect("invert should succeed");
    assert_eq!(doc, before);
}

#[test]
fn all_variants_apply_invert_loop() {
    // Property-style loop over (almost) every variant.
    let doc = sample_document();
    let new_obj = Object {
        id: "obj-new".to_string(),
        name: "New App".to_string(),
        kind: ObjectKind::App,
        parent_id: Some("obj-storefront".to_string()),
        ..Default::default()
    };
    let new_conn = Connection {
        id: "conn-new".to_string(),
        origin_id: "obj-webapp".to_string(),
        target_id: "obj-orders".to_string(),
        name: "New link".to_string(),
        ..Default::default()
    };
    let new_tag = Tag {
        id: "tag-new".to_string(),
        name: "New".to_string(),
        color: "green".to_string(),
        group_id: Some("tg-team".to_string()),
        index: 3,
        ..Default::default()
    };
    let new_group = TagGroup {
        id: "tg-new".to_string(),
        name: "NewGroup".to_string(),
        icon: "star".to_string(),
        index: 5,
        ..Default::default()
    };
    let new_domain = Domain {
        id: "dom-new".to_string(),
        name: "NewDom".to_string(),
        ..Default::default()
    };
    let new_diagram = Diagram {
        id: "diag-new".to_string(),
        name: "New diagram".to_string(),
        level: DiagramLevel::Context,
        order: 9,
        ..Default::default()
    };
    let new_flow = Flow {
        id: "flow-new".to_string(),
        name: "New flow".to_string(),
        ..Default::default()
    };
    let new_step = FlowStep {
        id: "step-new".to_string(),
        kind: StepKind::Information,
        title: "Info".to_string(),
        ..Default::default()
    };
    let new_path = FlowPath {
        id: "path-new".to_string(),
        name: "Branch".to_string(),
        ..Default::default()
    };
    let cmds: Vec<Command> = vec![
        Command::CreateObject { object: new_obj },
        Command::PatchObject {
            id: "obj-webapp".to_string(),
            patch: ObjectPatch { name: Some("Web App 2".to_string()), ..Default::default() },
        },
        Command::Reparent { id: "obj-cart".to_string(), new_parent: Some("obj-orders".to_string()) },
        Command::Connect { connection: new_conn },
        Command::PatchConnection {
            id: "conn-pay".to_string(),
            patch: ConnectionPatch { name: Some("Pay 2".to_string()), ..Default::default() },
        },
        Command::CreateTag { tag: new_tag },
        Command::PatchTag { id: "tag-checkout".to_string(), name: Some("Checkout 2".to_string()), color: None, group_id: None },
        Command::CreateTagGroup { group: new_group },
        Command::CreateDomain { domain: new_domain },
        Command::CreateDiagram { diagram: new_diagram },
        Command::PatchDiagram { id: "diag-context".to_string(), name: Some("Ctx2".to_string()), description: None, order: None, pinned: None, domain_id: None },
        Command::AddToDiagram { diagram_id: "diag-context".to_string(), object_id: "obj-webapp".to_string(), rect: rect() },
        Command::MoveBoxes { diagram_id: "diag-context".to_string(), moves: BTreeMap::from([("obj-customer".to_string(), rect())]) },
        Command::ApplyLayout { diagram_id: "diag-context".to_string(), boxes: BTreeMap::from([("obj-customer".to_string(), rect())]) },
        Command::ShowConnection { diagram_id: "diag-context".to_string(), connection_id: "conn-browse".to_string(), layout: EdgeLayout::default() },
        Command::SetLanding { diagram_id: "diag-context".to_string(), object_id: "obj-payments".to_string(), target: Some("diag-store-a".to_string()) },
        Command::SetViewport { diagram_id: "diag-context".to_string(), viewport: Some(Viewport { x: 1.0, y: 2.0, zoom: 1.5 }) },
        Command::CreateFlow { flow: new_flow },
        Command::PatchFlow { id: "flow-checkout".to_string(), name: Some("C2".to_string()), description: None, pinned: None, show_all_connection_names: None, show_all_steps: None, diagram_id: None },
        Command::AddStep { flow_id: "flow-receipt".to_string(), path: vec![], index: 0, step: new_step },
        Command::PatchStep { flow_id: "flow-receipt".to_string(), step_id: "step-r1".to_string(), title: Some("T".to_string()), description: None, kind: None, reversed: None, origin_id: None, target_id: None, via_connection_id: None, object_id: None, go_to_flow_id: None },
        Command::AddPath { flow_id: "flow-receipt".to_string(), step_id: "step-r1".to_string(), path: new_path },
        Command::Batch(vec![Command::PatchFlow { id: "flow-receipt".to_string(), name: Some("R2".to_string()), description: None, pinned: None, show_all_connection_names: None, show_all_steps: None, diagram_id: None }]),
    ];
    for cmd in cmds {
        apply_invert_restores(doc.clone(), cmd);
    }
    // destructive variants with their own setup (need fresh doc each time)
    apply_invert_restores(doc.clone(), Command::DeleteObject { id: "obj-cart".to_string() });
    apply_invert_restores(doc.clone(), Command::DeleteConnection { id: "conn-browse".to_string() });
    apply_invert_restores(doc.clone(), Command::DeleteTag { id: "tag-pci".to_string() });
    apply_invert_restores(doc.clone(), Command::DeleteTagGroup { id: "tg-risk".to_string() });
    apply_invert_restores(doc.clone(), Command::DeleteDomain { id: "dom-shop".to_string() });
    apply_invert_restores(doc.clone(), Command::DeleteDiagram { id: "diag-store-b".to_string() });
    apply_invert_restores(doc.clone(), Command::DeleteFlow { id: "flow-receipt".to_string() });
    apply_invert_restores(doc.clone(), Command::DeleteStep { flow_id: "flow-checkout".to_string(), step_id: "step-browse".to_string() });
    apply_invert_restores(doc.clone(), Command::RemoveFromDiagram { diagram_id: "diag-context".to_string(), object_id: "obj-customer".to_string() });
    apply_invert_restores(doc.clone(), Command::HideConnection { diagram_id: "diag-context".to_string(), connection_id: "conn-pay".to_string() });
    apply_invert_restores(doc.clone(), Command::MoveStep { flow_id: "flow-checkout".to_string(), step_id: "step-browse".to_string(), to_path: vec![], to_index: 0 });
    apply_invert_restores(doc.clone(), Command::DeletePath { flow_id: "flow-checkout".to_string(), step_id: "step-choice".to_string(), path_id: "path-save".to_string() });
    apply_invert_restores(doc.clone(), Command::SetLanding { diagram_id: "diag-context".to_string(), object_id: "obj-storefront".to_string(), target: None });
}

#[test]
fn delete_object_subtree_with_connections_and_steps_restores() {
    let mut doc = sample_document();
    let before = doc.clone();
    // delete Web App subtree (webapp + cart) — touches conn-browse, conn-pay, flow steps
    let inv = Command::DeleteObject { id: "obj-webapp".to_string() }
        .apply(&mut doc)
        .unwrap();
    assert!(!doc.model.objects.contains_key("obj-webapp"));
    assert!(!doc.model.objects.contains_key("obj-cart"));
    assert!(!doc.model.connections.contains_key("conn-browse"));
    // restore
    inv.apply(&mut doc).unwrap();
    assert_eq!(doc, before);
}

#[test]
fn reparent_cycle_rejected_doc_unchanged() {
    let mut doc = sample_document();
    let before = doc.clone();
    let res = Command::Reparent {
        id: "obj-storefront".to_string(),
        new_parent: Some("obj-cart".to_string()),
    }
    .apply(&mut doc);
    assert_eq!(res, Err(CoreError::WouldCreateCycle));
    assert_eq!(doc, before);
    // self-parent also rejected
    let res2 = Command::Reparent {
        id: "obj-webapp".to_string(),
        new_parent: Some("obj-webapp".to_string()),
    }
    .apply(&mut doc);
    assert_eq!(res2, Err(CoreError::WouldCreateCycle));
    assert_eq!(doc, before);
}

#[test]
fn remove_from_diagram_leaves_model_object() {
    let mut doc = sample_document();
    Command::RemoveFromDiagram {
        diagram_id: "diag-context".to_string(),
        object_id: "obj-customer".to_string(),
    }
    .apply(&mut doc)
    .unwrap();
    assert!(!doc.diagrams["diag-context"].boxes.contains_key("obj-customer"));
    assert!(doc.model.objects.contains_key("obj-customer"));
}

#[test]
fn remove_from_diagram_drops_touching_shown_connections() {
    let mut doc = sample_document();
    // show conn-browse (customer->webapp touches customer) then remove customer box
    Command::ShowConnection {
        diagram_id: "diag-context".to_string(),
        connection_id: "conn-browse".to_string(),
        layout: EdgeLayout::default(),
    }
    .apply(&mut doc)
    .unwrap();
    assert!(doc.diagrams["diag-context"].connections.contains_key("conn-browse"));
    Command::RemoveFromDiagram {
        diagram_id: "diag-context".to_string(),
        object_id: "obj-customer".to_string(),
    }
    .apply(&mut doc)
    .unwrap();
    assert!(!doc.diagrams["diag-context"].connections.contains_key("conn-browse"));
}

#[test]
fn move_step_into_and_out_of_path() {
    let mut doc = sample_document();
    let before = doc.clone();
    // move top-level step-browse into path-pay at index 0
    let inv = Command::MoveStep {
        flow_id: "flow-checkout".to_string(),
        step_id: "step-browse".to_string(),
        to_path: vec!["path-pay".to_string()],
        to_index: 0,
    }
    .apply(&mut doc)
    .unwrap();
    let flow = &doc.model.flows["flow-checkout"];
    assert!(flow.find_step(&"step-browse".to_string()).is_some());
    let pay = flow
        .find_step(&"step-choice".to_string())
        .unwrap()
        .paths
        .iter()
        .find(|p| p.id == "path-pay")
        .unwrap();
    assert!(pay.steps.iter().any(|s| s.id == "step-browse"));
    // move it back out to top level
    let inv2 = Command::MoveStep {
        flow_id: "flow-checkout".to_string(),
        step_id: "step-browse".to_string(),
        to_path: vec![],
        to_index: 1,
    }
    .apply(&mut doc)
    .unwrap();
    assert!(doc.model.flows["flow-checkout"].find_step(&"step-browse".to_string()).is_some());
    // undo both restores original
    inv2.apply(&mut doc).unwrap();
    inv.apply(&mut doc).unwrap();
    assert_eq!(doc, before);
}

#[test]
fn delete_connection_restores_steps_and_diagram_entries() {
    let mut doc = sample_document();
    let before = doc.clone();
    let inv = Command::DeleteConnection { id: "conn-pay".to_string() }
        .apply(&mut doc)
        .unwrap();
    assert!(!doc.model.connections.contains_key("conn-pay"));
    assert!(!doc.diagrams["diag-context"].connections.contains_key("conn-pay"));
    // flow steps via conn-pay removed (nested)
    assert!(doc.model.flows["flow-checkout"].find_step(&"step-pay".to_string()).is_none());
    inv.apply(&mut doc).unwrap();
    assert_eq!(doc, before);
}

#[test]
fn intelligent_step_connection_case() {
    use speculum_core::intelligent_step;
    let doc = sample_document();
    let s = intelligent_step(&doc, &"flow-checkout".to_string(), &["conn-browse".to_string()]).unwrap();
    assert_eq!(s.kind, StepKind::Message);
    assert_eq!(s.via_connection_id, Some("conn-browse".to_string()));
    assert_eq!(s.origin_id, Some("obj-customer".to_string()));
    assert_eq!(s.target_id, Some("obj-webapp".to_string()));
    assert_eq!(s.title, "Browse store");
}

#[test]
fn intelligent_step_two_objects_case_and_reversed() {
    use speculum_core::intelligent_step;
    let doc = sample_document();
    let fwd = intelligent_step(
        &doc,
        &"flow-checkout".to_string(),
        &["obj-webapp".to_string(), "obj-payments-api".to_string()],
    )
    .unwrap();
    assert_eq!(fwd.via_connection_id, Some("conn-pay".to_string()));
    assert!(!fwd.reversed);
    let rev = intelligent_step(
        &doc,
        &"flow-checkout".to_string(),
        &["obj-payments-api".to_string(), "obj-webapp".to_string()],
    )
    .unwrap();
    assert!(rev.reversed);
    assert_eq!(rev.origin_id, Some("obj-payments-api".to_string()));
}

#[test]
fn intelligent_step_single_object_case() {
    use speculum_core::intelligent_step;
    let doc = sample_document();
    let s = intelligent_step(&doc, &"flow-checkout".to_string(), &["obj-cart".to_string()]).unwrap();
    assert_eq!(s.kind, StepKind::Process);
    assert_eq!(s.object_id, Some("obj-cart".to_string()));
    assert_eq!(s.title, "Cart Service");
    assert!(intelligent_step(&doc, &"flow-checkout".to_string(), &[]).is_none());
    assert!(intelligent_step(&doc, &"flow-checkout".to_string(), &["ghost".to_string()]).is_none());
}

#[test]
fn batch_is_atomic_and_inverse_reversed() {
    let mut doc = sample_document();
    let before = doc.clone();
    // second command fails (duplicate) -> whole batch fails, doc unchanged
    let bad = Command::Batch(vec![
        Command::PatchFlow {
            id: "flow-receipt".to_string(),
            name: Some("X".to_string()),
            description: None,
            pinned: None,
            show_all_connection_names: None,
            show_all_steps: None,
            diagram_id: None,
        },
        Command::CreateFlow {
            flow: Flow { id: "flow-checkout".to_string(), ..Default::default() },
        },
    ]);
    assert!(bad.apply(&mut doc).is_err());
    assert_eq!(doc, before);
}

#[test]
fn errors_not_found_duplicate_invalid_index() {
    let mut doc = sample_document();
    let before = doc.clone();
    assert_eq!(
        Command::DeleteObject { id: "ghost".to_string() }.apply(&mut doc),
        Err(CoreError::NotFound("ghost".to_string()))
    );
    assert_eq!(doc, before);
    assert!(matches!(
        Command::AddStep {
            flow_id: "flow-checkout".to_string(),
            path: vec![],
            index: 999,
            step: FlowStep { id: "s-x".to_string(), ..Default::default() },
        }
        .apply(&mut doc),
        Err(CoreError::InvalidIndex)
    ));
    assert_eq!(doc, before);
}

#[test]
fn patch_object_icon_and_domain_double_option() {
    let mut doc = sample_document();
    let before = doc.clone();
    let inv = Command::PatchObject {
        id: "obj-webapp".to_string(),
        patch: ObjectPatch {
            icon: Some(Some("star".to_string())),
            domain_id: Some(None),
            ..Default::default()
        },
    }
    .apply(&mut doc)
    .unwrap();
    assert_eq!(doc.model.objects["obj-webapp"].icon, Some("star".to_string()));
    assert_eq!(doc.model.objects["obj-webapp"].domain_id, None);
    inv.apply(&mut doc).unwrap();
    assert_eq!(doc, before);
}

#[test]
fn delete_tag_group_removes_its_tags_and_restores() {
    let mut doc = sample_document();
    let before = doc.clone();
    let inv = Command::DeleteTagGroup { id: "tg-team".to_string() }
        .apply(&mut doc)
        .unwrap();
    assert!(!doc.model.tag_groups.contains_key("tg-team"));
    assert!(!doc.model.tags.contains_key("tag-checkout"));
    assert!(!doc.model.objects["obj-webapp"].tag_ids.contains(&"tag-checkout".to_string()));
    inv.apply(&mut doc).unwrap();
    assert_eq!(doc, before);
}

#[test]
fn add_and_delete_path_round_trip() {
    let mut doc = sample_document();
    let before = doc.clone();
    let path = FlowPath { id: "path-extra".to_string(), name: "Extra".to_string(), ..Default::default() };
    let inv = Command::AddPath {
        flow_id: "flow-checkout".to_string(),
        step_id: "step-choice".to_string(),
        path,
    }
    .apply(&mut doc)
    .unwrap();
    assert!(doc.model.flows["flow-checkout"].find_step(&"step-choice".to_string()).unwrap().paths.iter().any(|p| p.id == "path-extra"));
    inv.apply(&mut doc).unwrap();
    assert_eq!(doc, before);
    // delete non-last path restores order exactly
    let inv2 = Command::DeletePath {
        flow_id: "flow-checkout".to_string(),
        step_id: "step-choice".to_string(),
        path_id: "path-pay".to_string(),
    }
    .apply(&mut doc)
    .unwrap();
    assert_eq!(doc.model.flows["flow-checkout"].find_step(&"step-choice".to_string()).unwrap().paths.len(), 1);
    inv2.apply(&mut doc).unwrap();
    assert_eq!(doc, before);
}
