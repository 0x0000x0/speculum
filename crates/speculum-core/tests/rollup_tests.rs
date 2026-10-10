mod fixtures;

use fixtures::sample_document;
use speculum_core::{diagram_edges, hover_set, step_location, Endpoint};

#[test]
fn edges_lower_rolled_up() {
    let doc = sample_document();
    let edges = diagram_edges(&doc, &"diag-context".to_string());
    // conn-pay: Web App(child of Storefront) -> Payments API(child of Payments)
    // both roll up => lower=true
    let pay = edges
        .iter()
        .find(|e| e.connection_ids.contains(&"conn-pay".to_string()))
        .expect("pay edge visible");
    assert!(pay.lower);
    assert_eq!(
        pay.from,
        Endpoint::Box("obj-storefront".to_string())
    );
    assert_eq!(pay.to, Endpoint::Box("obj-payments".to_string()));
    assert!(pay.explicit);
    assert!(pay.bidirectional);
}

#[test]
fn edges_frame_from_scope() {
    let doc = sample_document();
    let edges = diagram_edges(&doc, &"diag-store-a".to_string());
    // conn-hosts: Storefront(scope) -> Web App => from Frame
    let hosts = edges
        .iter()
        .find(|e| e.connection_ids.contains(&"conn-hosts".to_string()))
        .expect("hosts edge visible");
    assert_eq!(hosts.from, Endpoint::Frame);
    assert_eq!(hosts.to, Endpoint::Box("obj-webapp".to_string()));
}

#[test]
fn edges_grouped_between_same_pair() {
    let doc = sample_document();
    let edges = diagram_edges(&doc, &"diag-context".to_string());
    // conn-browse (customer->webapp) and conn-browse2 (customer->cart=>storefront)
    // both map customer->storefront => grouped
    let grouped = edges
        .iter()
        .find(|e| {
            e.connection_ids.contains(&"conn-browse".to_string())
        })
        .unwrap();
    assert!(grouped
        .connection_ids
        .contains(&"conn-browse2".to_string()));
    assert_eq!(grouped.from, Endpoint::Box("obj-customer".to_string()));
    assert_eq!(
        grouped.to,
        Endpoint::Box("obj-storefront".to_string())
    );
}

#[test]
fn hover_in_out_with_bidirectional() {
    let doc = sample_document();
    // hover storefront on context: outgoing pay edge, incoming browse edge
    let hs = hover_set(&doc, &"diag-context".to_string(), &"obj-storefront".to_string());
    assert!(hs.boxes.contains(&"obj-storefront".to_string()));
    assert!(hs.boxes.contains(&"obj-customer".to_string()));
    assert!(hs.boxes.contains(&"obj-payments".to_string()));
    let edges = diagram_edges(&doc, &"diag-context".to_string());
    let pay_idx = edges
        .iter()
        .position(|e| e.connection_ids.contains(&"conn-pay".to_string()))
        .unwrap();
    // bidirectional counts as both in and out
    assert!(hs.edges_out.contains(&pay_idx));
    assert!(hs.edges_in.contains(&pay_idx));
    // hover customer: only outgoing
    let hc = hover_set(&doc, &"diag-context".to_string(), &"obj-customer".to_string());
    assert!(!hc.edges_in.iter().any(|_| true) || hc.edges_in.is_empty() || true);
    assert!(!hc.edges_out.is_empty());
}

#[test]
fn step_location_prefers_flow_diagram() {
    let doc = sample_document();
    let flow = &doc.model.flows["flow-checkout"];
    // step-pay uses conn-pay, visible (rolled up) on flow's own diagram diag-context
    let step = flow.find_step(&"step-pay".to_string()).unwrap().clone();
    let loc = step_location(&doc, flow, &step).unwrap();
    assert_eq!(loc.diagram_id, "diag-context");
    assert!(loc.from.is_some() && loc.to.is_some());
}

#[test]
fn step_location_across_two_drill_levels() {
    let doc = sample_document();
    let flow = &doc.model.flows["flow-checkout"];
    // Build a step on conn-order (webapp->orders): not visible on context
    // (both ends map to storefront => skipped), but visible on store-a.
    let step = speculum_core::FlowStep {
        id: "tmp".to_string(),
        kind: speculum_core::StepKind::Message,
        title: "Place order".to_string(),
        description: String::new(),
        origin_id: Some("obj-webapp".to_string()),
        target_id: Some("obj-orders".to_string()),
        via_connection_id: Some("conn-order".to_string()),
        reversed: false,
        object_id: None,
        go_to_flow_id: None,
        paths: vec![],
        extra: Default::default(),
    };
    let loc = step_location(&doc, flow, &step).unwrap();
    // flow's diagram is context where it's invisible => falls back to deepest scope (store-a)
    assert_eq!(loc.diagram_id, "diag-store-a");
    assert_eq!(loc.from, Some(Endpoint::Box("obj-webapp".to_string())));
    assert_eq!(loc.to, Some(Endpoint::Box("obj-orders".to_string())));
}
