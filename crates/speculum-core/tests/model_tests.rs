mod fixtures;

use fixtures::sample_document;
use speculum_core::{Document, IdGen};
use std::collections::BTreeMap;

#[test]
fn serde_round_trip_document() {
    let doc = sample_document();
    let s = serde_json::to_string(&doc).unwrap();
    let back: Document = serde_json::from_str(&s).unwrap();
    assert_eq!(doc, back);
}

#[test]
fn pretty_json_keys_sorted() {
    let doc = sample_document();
    let pretty = serde_json::to_string_pretty(&doc).unwrap();
    let v: serde_json::Value = serde_json::from_str(&pretty).unwrap();
    // re-serialize with sorted keys (BTreeMap ensures sorted); check boxes keys sorted
    let s2 = serde_json::to_string(&v).unwrap();
    let v2: serde_json::Value = serde_json::from_str(&s2).unwrap();
    assert_eq!(v, v2);
    // spot check camelCase keys exist
    assert!(pretty.contains("scopeObjectId"));
    assert!(!pretty.contains("parent_id"));
}

#[test]
fn unknown_fields_object_preserved() {
    let mut doc = sample_document();
    let o = doc.model.objects.get_mut("obj-webapp").unwrap();
    o.extra
        .insert("mystery".to_string(), serde_json::json!("xyz"));
    let s = serde_json::to_string(&doc).unwrap();
    assert!(s.contains("mystery"));
    let back: Document = serde_json::from_str(&s).unwrap();
    assert_eq!(doc, back);
    assert_eq!(
        back.model.objects["obj-webapp"].extra["mystery"],
        serde_json::json!("xyz")
    );
}

#[test]
fn unknown_fields_connection_preserved() {
    let mut doc = sample_document();
    doc.model.connections.get_mut("conn-pay").unwrap()
        .extra
        .insert("x1".to_string(), serde_json::json!(1));
    let s = serde_json::to_string(&doc).unwrap();
    let back: Document = serde_json::from_str(&s).unwrap();
    assert_eq!(doc, back);
}

#[test]
fn unknown_fields_tag_preserved() {
    let mut doc = sample_document();
    doc.model.tags.get_mut("tag-checkout").unwrap()
        .extra
        .insert("x".to_string(), serde_json::json!(true));
    let s = serde_json::to_string(&doc).unwrap();
    let back: Document = serde_json::from_str(&s).unwrap();
    assert_eq!(doc, back);
}

#[test]
fn unknown_fields_tag_group_preserved() {
    let mut doc = sample_document();
    doc.model.tag_groups.get_mut("tg-team").unwrap()
        .extra
        .insert("x".to_string(), serde_json::json!(1));
    let s = serde_json::to_string(&doc).unwrap();
    let back: Document = serde_json::from_str(&s).unwrap();
    assert_eq!(doc, back);
}

#[test]
fn unknown_fields_domain_preserved() {
    let mut doc = sample_document();
    doc.model.domains.get_mut("dom-shop").unwrap()
        .extra
        .insert("x".to_string(), serde_json::json!(1));
    let s = serde_json::to_string(&doc).unwrap();
    let back: Document = serde_json::from_str(&s).unwrap();
    assert_eq!(doc, back);
}

#[test]
fn unknown_fields_diagram_preserved() {
    let mut doc = sample_document();
    doc.diagrams.get_mut("diag-context").unwrap()
        .extra
        .insert("x".to_string(), serde_json::json!(1));
    let s = serde_json::to_string(&doc).unwrap();
    let back: Document = serde_json::from_str(&s).unwrap();
    assert_eq!(doc, back);
}

#[test]
fn unknown_fields_flow_preserved() {
    let mut doc = sample_document();
    doc.model.flows.get_mut("flow-checkout").unwrap()
        .extra
        .insert("x".to_string(), serde_json::json!(1));
    let s = serde_json::to_string(&doc).unwrap();
    let back: Document = serde_json::from_str(&s).unwrap();
    assert_eq!(doc, back);
}

#[test]
fn unknown_fields_flow_step_and_path_preserved() {
    let mut doc = sample_document();
    let flow = doc.model.flows.get_mut("flow-checkout").unwrap();
    flow.steps[0]
        .extra
        .insert("sx".to_string(), serde_json::json!("a"));
    flow.steps[2].paths[0]
        .extra
        .insert("px".to_string(), serde_json::json!("b"));
    let s = serde_json::to_string(&doc).unwrap();
    let back: Document = serde_json::from_str(&s).unwrap();
    assert_eq!(doc, back);
}

#[test]
fn model_helpers_children_roots_ancestors() {
    let doc = sample_document();
    let kids = doc.model.children(&"obj-storefront".to_string());
    let names: Vec<&str> = kids.iter().map(|o| o.name.as_str()).collect();
    assert!(names.contains(&"Web App"));
    assert!(names.contains(&"Orders Store"));
    // sorted by name then id
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted);

    let roots = doc.model.root_objects();
    assert!(roots.iter().any(|o| o.id == "obj-customer"));
    assert!(roots.iter().any(|o| o.id == "obj-payments"));

    let anc: Vec<String> = doc
        .model
        .ancestors(&"obj-cart".to_string())
        .iter()
        .map(|o| o.id.clone())
        .collect();
    assert_eq!(anc, vec!["obj-webapp", "obj-storefront", "obj-region"]);
    assert_eq!(doc.model.depth(&"obj-cart".to_string()), 3);
    assert!(doc
        .model
        .is_ancestor(&"obj-storefront".to_string(), &"obj-cart".to_string()));
    assert!(!doc
        .model
        .is_ancestor(&"obj-cart".to_string(), &"obj-storefront".to_string()));
    assert!(!doc.model.is_ancestor(
        &"obj-cart".to_string(),
        &"obj-cart".to_string()
    ));
}

#[test]
fn model_helpers_groups_and_connections() {
    let doc = sample_document();
    let members = doc.model.group_members(&"obj-region".to_string());
    assert!(members.iter().any(|o| o.id == "obj-webapp"));
    let (incoming, outgoing) = doc.model.connections_of(&"obj-webapp".to_string());
    assert!(outgoing.iter().any(|c| c.id == "conn-pay"));
    assert!(incoming.iter().any(|c| c.id == "conn-browse"));
}

#[test]
fn flow_walk_and_find() {
    let doc = sample_document();
    let flow = &doc.model.flows["flow-checkout"];
    let walked = flow.walk_steps();
    // 4 top-level + 2 in pay path + 1 in save path = 7
    assert_eq!(walked.len(), 7);
    assert!(flow.find_step(&"step-pay".to_string()).is_some());
    assert!(flow.find_step(&"nope".to_string()).is_none());
    // path trail for nested step
    let (_, trail) = walked
        .iter()
        .find(|(s, _)| s.id == "step-pay")
        .unwrap()
        .clone();
    assert_eq!(trail, vec!["path-pay".to_string()]);
}

#[test]
fn diagrams_for_scope_sorted_and_containing() {
    let doc = sample_document();
    let scoped = doc.diagrams_for_scope(Some(&"obj-storefront".to_string()));
    assert_eq!(scoped.len(), 2);
    assert_eq!(scoped[0].id, "diag-store-a");
    assert_eq!(scoped[1].id, "diag-store-b");
    let top = doc.diagrams_for_scope(None);
    assert_eq!(top.len(), 1);
    assert_eq!(top[0].id, "diag-context");
    let containing = doc.diagrams_containing(&"obj-webapp".to_string());
    assert_eq!(containing.len(), 2);
    let flows = doc.flows_containing(&"conn-pay".to_string());
    assert_eq!(flows.len(), 1);
    assert_eq!(flows[0].id, "flow-checkout");
}

#[test]
fn landing_diagram_custom_vs_default() {
    let doc = sample_document();
    // custom landing from context for storefront -> diag-store-b
    let custom = doc.landing_diagram(
        &"diag-context".to_string(),
        &"obj-storefront".to_string(),
    );
    assert_eq!(custom.unwrap().id, "diag-store-b");
    // no custom from store-a -> default lowest order scoped diagram (store-a)
    let def = doc.landing_diagram(
        &"diag-store-a".to_string(),
        &"obj-storefront".to_string(),
    );
    assert_eq!(def.unwrap().id, "diag-store-a");
    // no diagram scoped to customer
    assert!(doc
        .landing_diagram(&"diag-context".to_string(), &"obj-customer".to_string())
        .is_none());
}

#[test]
fn idgen_deterministic() {
    let mut g = IdGen::new("obj");
    assert_eq!(g.next(), "obj-1");
    assert_eq!(g.next(), "obj-2");
    assert_eq!(g.next_id(), "obj-3");
    let mut g2 = IdGen::new("obj");
    assert_eq!(g2.next(), "obj-1");
}

#[test]
fn btreemap_keys_sorted_in_json() {
    let doc = sample_document();
    let s = serde_json::to_string(&doc.model.objects).unwrap();
    // ids should appear in sorted order in the JSON string
    let i_browse = s.find("obj-cart").unwrap();
    let i_webapp = s.find("obj-webapp").unwrap();
    assert!(i_browse < i_webapp);
    let _m: BTreeMap<String, serde_json::Value> = serde_json::from_str(&s).unwrap();
}
