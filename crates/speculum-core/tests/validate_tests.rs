mod fixtures;

use fixtures::sample_document;
use speculum_core::{repair, repair_document, validate, validate_document, Severity};
use std::collections::{BTreeMap, BTreeSet};

fn codes_of(doc: &speculum_core::Document) -> BTreeSet<String> {
    validate_document(doc).iter().map(|i| i.code.clone()).collect()
}

#[test]
fn validate_clean_sample_has_no_errors() {
    let doc = sample_document();
    let issues = validate_document(&doc);
    let errors: Vec<_> = issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .collect();
    assert!(errors.is_empty(), "unexpected errors: {errors:?}");
}

#[test]
fn validate_missing_parent() {
    let mut doc = sample_document();
    doc.model.objects.get_mut("obj-cart").unwrap().parent_id = Some("nope".to_string());
    let issues = validate(&doc.model);
    assert!(issues.iter().any(|i| i.code == "missing-parent"));
}

#[test]
fn validate_parent_cycle() {
    let mut doc = sample_document();
    doc.model.objects.get_mut("obj-webapp").unwrap().parent_id =
        Some("obj-cart".to_string());
    let issues = validate(&doc.model);
    assert!(issues.iter().any(|i| i.code == "parent-cycle"));
}

#[test]
fn validate_missing_connection_endpoint() {
    let mut doc = sample_document();
    doc.model.connections.get_mut("conn-pay").unwrap().target_id = "ghost".to_string();
    let issues = validate(&doc.model);
    assert!(issues
        .iter()
        .any(|i| i.code == "missing-connection-endpoint"));
}

#[test]
fn validate_self_loop_warning() {
    let mut doc = sample_document();
    doc.model.connections.get_mut("conn-pay").unwrap().origin_id = "obj-webapp".to_string();
    doc.model.connections.get_mut("conn-pay").unwrap().target_id = "obj-webapp".to_string();
    let issues = validate(&doc.model);
    let hit = issues
        .iter()
        .find(|i| i.code == "connection-self-loop")
        .unwrap();
    assert_eq!(hit.severity, Severity::Warning);
}

#[test]
fn validate_missing_tag_and_group() {
    let mut doc = sample_document();
    doc.model.objects.get_mut("obj-webapp").unwrap().tag_ids = vec!["no-tag".to_string()];
    doc.model.tags.get_mut("tag-checkout").unwrap().group_id = Some("no-group".to_string());
    let issues = validate(&doc.model);
    assert!(issues.iter().any(|i| i.code == "missing-tag"));
    assert!(issues.iter().any(|i| i.code == "missing-tag-group"));
}

#[test]
fn validate_missing_step_refs_nested() {
    let mut doc = sample_document();
    let flow = doc.model.flows.get_mut("flow-checkout").unwrap();
    // nested step in path references missing connection
    flow.steps[2].paths[0].steps[0].via_connection_id = Some("ghost-conn".to_string());
    let issues = validate(&doc.model);
    assert!(issues.iter().any(|i| i.code == "missing-step-ref"));
}

#[test]
fn validate_step_endpoint_mismatch_warning() {
    let mut doc = sample_document();
    let flow = doc.model.flows.get_mut("flow-checkout").unwrap();
    // step-browse claims conn-pay but endpoints are customer->webapp (mismatch)
    flow.steps[1].via_connection_id = Some("conn-pay".to_string());
    let issues = validate(&doc.model);
    let hit = issues
        .iter()
        .find(|i| i.code == "step-endpoint-mismatch")
        .unwrap();
    assert_eq!(hit.severity, Severity::Warning);
}

#[test]
fn validate_process_missing_object_error() {
    let mut doc = sample_document();
    let flow = doc.model.flows.get_mut("flow-receipt").unwrap();
    flow.steps[0].object_id = None;
    let issues = validate(&doc.model);
    assert!(issues.iter().any(|i| i.code == "step-missing-object"));
}

#[test]
fn validate_flow_no_paths_and_self_goto_and_empty() {
    let mut doc = sample_document();
    {
        let flow = doc.model.flows.get_mut("flow-checkout").unwrap();
        flow.steps[2].paths.clear();
    }
    let issues = validate(&doc.model);
    assert!(issues.iter().any(|i| i.code == "flow-no-paths"));
    // self goto
    {
        let flow = doc.model.flows.get_mut("flow-checkout").unwrap();
        flow.steps[3].go_to_flow_id = Some("flow-checkout".to_string());
    }
    let issues2 = validate(&doc.model);
    assert!(issues2.iter().any(|i| i.code == "flow-self-goto"));
    // empty flow
    doc.model.flows.get_mut("flow-receipt").unwrap().steps.clear();
    let issues3 = validate(&doc.model);
    assert!(issues3.iter().any(|i| i.code == "empty-flow"));
}

#[test]
fn validate_diagram_issues() {
    let mut doc = sample_document();
    doc.diagrams
        .get_mut("diag-context")
        .unwrap()
        .boxes
        .insert("ghost-obj".to_string(), speculum_core::Rect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 });
    doc.diagrams
        .get_mut("diag-context")
        .unwrap()
        .connections
        .insert("ghost-conn".to_string(), speculum_core::EdgeLayout::default());
    doc.diagrams
        .get_mut("diag-context")
        .unwrap()
        .landing
        .insert("obj-webapp".to_string(), "ghost-diag".to_string());
    doc.diagrams.get_mut("diag-store-a").unwrap().scope_object_id = Some("ghost".to_string());
    let issues = validate_document(&doc);
    for code in [
        "missing-diagram-box",
        "missing-diagram-connection",
        "missing-landing",
        "missing-diagram-scope",
    ] {
        assert!(issues.iter().any(|i| i.code == code), "missing {code}");
    }
    let _ = codes_of(&doc);
}

#[test]
fn validate_group_ref_and_via_and_parent_kind() {
    let mut doc = sample_document();
    // group_ids pointing to non-group
    doc.model.objects.get_mut("obj-webapp").unwrap().group_ids = vec!["obj-payments".to_string()];
    // via missing
    doc.model.connections.get_mut("conn-order").unwrap().via_id = Some("ghost".to_string());
    // kind violation: component parented to system
    doc.model.objects.get_mut("obj-cart").unwrap().parent_id =
        Some("obj-storefront".to_string());
    let issues = validate(&doc.model);
    assert!(issues.iter().any(|i| i.code == "invalid-group-ref"));
    assert!(issues.iter().any(|i| i.code == "missing-via-object"));
    assert!(issues.iter().any(|i| i.code == "invalid-parent-kind"));
    // parent-kind is warning
    let hit = issues
        .iter()
        .find(|i| i.code == "invalid-parent-kind")
        .unwrap();
    assert_eq!(hit.severity, Severity::Warning);
}

#[test]
fn validate_never_panics_on_empty() {
    let m = speculum_core::Model::default();
    let issues = validate(&m);
    assert!(issues.is_empty() || !issues.is_empty());
    let d = speculum_core::Document::default();
    let _ = validate_document(&d);
}

#[test]
fn repair_clears_all_errors() {
    let mut doc = sample_document();
    // break lots of things
    doc.model.objects.get_mut("obj-cart").unwrap().parent_id = Some("ghost".to_string());
    doc.model.objects.get_mut("obj-webapp").unwrap().parent_id =
        Some("obj-cart".to_string());
    doc.model.objects.get_mut("obj-cart").unwrap().parent_id = Some("obj-webapp".to_string());
    doc.model.connections.get_mut("conn-pay").unwrap().target_id = "ghost".to_string();
    doc.model.connections.get_mut("conn-order").unwrap().via_id = Some("ghost".to_string());
    doc.model.objects.get_mut("obj-webapp").unwrap().tag_ids = vec!["ghost-tag".to_string()];
    doc.model.objects.get_mut("obj-webapp").unwrap().group_ids = vec!["obj-payments".to_string()];
    {
        let flow = doc.model.flows.get_mut("flow-checkout").unwrap();
        flow.steps[2].paths[0].steps[0].via_connection_id = Some("ghost".to_string());
        flow.steps[2].paths[0].steps[0].origin_id = Some("ghost".to_string());
    }
    doc.diagrams
        .get_mut("diag-context")
        .unwrap()
        .boxes
        .insert("ghost".to_string(), speculum_core::Rect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 });
    doc.diagrams
        .get_mut("diag-context")
        .unwrap()
        .connections
        .insert("ghost".to_string(), speculum_core::EdgeLayout::default());
    doc.diagrams
        .get_mut("diag-context")
        .unwrap()
        .landing
        .insert("obj-cart".to_string(), "ghost".to_string());
    doc.diagrams.get_mut("diag-store-a").unwrap().scope_object_id = Some("ghost".to_string());
    let _fixed = repair_document(&mut doc);
    let issues = validate_document(&doc);
    let errors: Vec<_> = issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .collect();
    assert!(errors.is_empty(), "leftover errors: {errors:?}");
}

#[test]
fn repair_model_only_never_panics() {
    let mut m = speculum_core::Model::default();
    let _ = repair(&mut m);
    let _ = validate(&m);
    let _m2: BTreeMap<String, String> = BTreeMap::new();
}

#[test]
fn scope_object_boxed_warns_and_repairs() {
    let mut doc = sample_document();
    // Boxing the scope object on its own diagram is a Warning (not Error).
    doc.diagrams
        .get_mut("diag-store-a")
        .unwrap()
        .boxes
        .insert(
            "obj-storefront".to_string(),
            speculum_core::Rect { x: 0.0, y: 0.0, w: 240.0, h: 120.0 },
        );
    let issues = validate_document(&doc);
    let warn = issues
        .iter()
        .find(|i| i.code == "scope-object-boxed")
        .expect("scope-object-boxed warning");
    assert_eq!(warn.severity, Severity::Warning);
    assert!(warn.message.contains("scope object boxed on its own diagram"));

    // One-off repair removes the box; undoable removal commands match.
    let cmds = speculum_core::scope_box_removal_commands(&doc);
    assert_eq!(cmds.len(), 1);
    let before = doc.clone();
    let inv = speculum_core::Command::Batch { commands: cmds }
        .apply(&mut doc)
        .expect("repair batch applies");
    assert!(!doc.diagrams["diag-store-a"].boxes.contains_key("obj-storefront"));
    assert!(validate_document(&doc)
        .iter()
        .all(|i| i.code != "scope-object-boxed"));
    inv.apply(&mut doc).expect("repair undoes");
    assert_eq!(doc, before);

    // repair_document also clears it (reporting the same code).
    let mut doc2 = before.clone();
    let fixed = repair_document(&mut doc2);
    assert!(fixed.iter().any(|i| i.code == "scope-object-boxed"));
    assert!(!doc2.diagrams["diag-store-a"].boxes.contains_key("obj-storefront"));
}
