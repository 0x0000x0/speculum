use speculum_core::{
    Connection, Diagram, DiagramLevel, Direction, Document, Domain, EdgeLayout, Flow, FlowPath,
    FlowStep, LineShape, Object, ObjectKind, Rect, Status, StepKind, Tag, TagGroup,
};
use std::collections::BTreeMap;

fn rect(x: f64, y: f64) -> Rect {
    Rect {
        x,
        y,
        w: 200.0,
        h: 120.0,
    }
}

fn obj(
    id: &str,
    name: &str,
    kind: ObjectKind,
    parent: Option<&str>,
) -> Object {
    Object {
        id: id.to_string(),
        name: name.to_string(),
        kind,
        parent_id: parent.map(|s| s.to_string()),
        status: Status::Live,
        external: false,
        icon: None,
        caption: format!("{name} caption"),
        description: format!("{name} description"),
        tag_ids: vec![],
        technologies: vec![],
        links: vec![],
        group_ids: vec![],
        domain_id: None,
        labels: BTreeMap::new(),
        extra: BTreeMap::new(),
    }
}

fn conn(id: &str, name: &str, origin: &str, target: &str) -> Connection {
    Connection {
        id: id.to_string(),
        origin_id: origin.to_string(),
        target_id: target.to_string(),
        name: name.to_string(),
        description: format!("{name} description"),
        direction: Direction::Outgoing,
        status: Status::Live,
        line_shape: LineShape::Curved,
        label_position: None,
        via_id: None,
        tag_ids: vec![],
        technologies: vec![],
        links: vec![],
        extra: BTreeMap::new(),
    }
}

/// Build the standard made-up sample document used by all tests.
///
/// Domain "Shop"; actor "Customer"; group "Cloud Region"; systems
/// "Storefront" (in group) + "Payments"; apps "Web App", "Payments API";
/// store "Orders Store"; components "Cart Service", "Card Tokenizer".
pub fn sample_document() -> Document {
    let mut doc = Document::new("Shop Sample".to_string());

    // domain
    doc.model.domains.insert(
        "dom-shop".to_string(),
        Domain {
            id: "dom-shop".to_string(),
            name: "Shop".to_string(),
            description: "Shop domain".to_string(),
            extra: BTreeMap::new(),
        },
    );

    // tag groups + tags
    doc.model.tag_groups.insert(
        "tg-team".to_string(),
        TagGroup {
            id: "tg-team".to_string(),
            name: "Team".to_string(),
            icon: "users".to_string(),
            index: 0,
            extra: BTreeMap::new(),
        },
    );
    doc.model.tag_groups.insert(
        "tg-risk".to_string(),
        TagGroup {
            id: "tg-risk".to_string(),
            name: "Risk".to_string(),
            icon: "shield".to_string(),
            index: 1,
            extra: BTreeMap::new(),
        },
    );
    doc.model.tags.insert(
        "tag-checkout".to_string(),
        Tag {
            id: "tag-checkout".to_string(),
            name: "Checkout".to_string(),
            color: "blue".to_string(),
            group_id: Some("tg-team".to_string()),
            index: 0,
            extra: BTreeMap::new(),
        },
    );
    doc.model.tags.insert(
        "tag-pci".to_string(),
        Tag {
            id: "tag-pci".to_string(),
            name: "PCI".to_string(),
            color: "red".to_string(),
            group_id: Some("tg-risk".to_string()),
            index: 0,
            extra: BTreeMap::new(),
        },
    );

    // objects
    let mut objects = vec![
        obj("obj-customer", "Customer", ObjectKind::Actor, None),
        obj("obj-region", "Cloud Region", ObjectKind::Group, None),
        obj(
            "obj-storefront",
            "Storefront",
            ObjectKind::System,
            Some("obj-region"),
        ),
        obj("obj-payments", "Payments", ObjectKind::System, None),
        obj(
            "obj-webapp",
            "Web App",
            ObjectKind::App,
            Some("obj-storefront"),
        ),
        obj(
            "obj-payments-api",
            "Payments API",
            ObjectKind::App,
            Some("obj-payments"),
        ),
        obj(
            "obj-orders",
            "Orders Store",
            ObjectKind::Store,
            Some("obj-storefront"),
        ),
        obj(
            "obj-queue",
            "Order Queue",
            ObjectKind::Store,
            Some("obj-storefront"),
        ),
        obj(
            "obj-cart",
            "Cart Service",
            ObjectKind::Component,
            Some("obj-webapp"),
        ),
        obj(
            "obj-tokenizer",
            "Card Tokenizer",
            ObjectKind::Component,
            Some("obj-payments-api"),
        ),
    ];
    // tag one object, put Web App in the region group (many-to-many)
    if let Some(o) = objects.iter_mut().find(|o| o.id == "obj-webapp") {
        o.tag_ids = vec!["tag-checkout".to_string()];
        o.group_ids = vec!["obj-region".to_string()];
        o.domain_id = Some("dom-shop".to_string());
    }
    if let Some(o) = objects.iter_mut().find(|o| o.id == "obj-payments-api") {
        o.tag_ids = vec!["tag-pci".to_string()];
    }
    for o in objects {
        doc.model.objects.insert(o.id.clone(), o);
    }

    // connections
    let mut c_browse = conn("conn-browse", "Browse store", "obj-customer", "obj-webapp");
    c_browse.tag_ids = vec!["tag-checkout".to_string()];
    let c_browse2 = conn(
        "conn-browse2",
        "View cart",
        "obj-customer",
        "obj-cart",
    );
    let mut c_pay = conn("conn-pay", "Pay", "obj-webapp", "obj-payments-api");
    c_pay.direction = Direction::Bidirectional;
    let mut c_order = conn(
        "conn-order",
        "Place order",
        "obj-webapp",
        "obj-orders",
    );
    c_order.via_id = Some("obj-queue".to_string());
    let c_hosts = conn(
        "conn-hosts",
        "Hosts",
        "obj-storefront",
        "obj-webapp",
    );
    let c_charge = conn(
        "conn-charge",
        "Charge card",
        "obj-payments-api",
        "obj-orders",
    );
    for c in [c_browse, c_browse2, c_pay, c_order, c_hosts, c_charge] {
        doc.model.connections.insert(c.id.clone(), c);
    }

    // diagrams: 1 context + 2 app-level scoped to Storefront
    let mut ctx = Diagram {
        id: "diag-context".to_string(),
        name: "Shop Context".to_string(),
        level: DiagramLevel::Context,
        scope_object_id: None,
        domain_id: Some("dom-shop".to_string()),
        description: "Top level".to_string(),
        order: 0,
        pinned: false,
        boxes: BTreeMap::new(),
        connections: BTreeMap::new(),
        viewport: None,
        landing: BTreeMap::new(),
        auto_placed: false,
        created: "2026-01-01".to_string(),
        modified: "2026-01-02".to_string(),
        extra: BTreeMap::new(),
    };
    ctx.boxes.insert("obj-customer".to_string(), rect(0.0, 0.0));
    ctx.boxes.insert("obj-region".to_string(), rect(300.0, 0.0));
    ctx.boxes
        .insert("obj-storefront".to_string(), rect(0.0, 300.0));
    ctx.boxes
        .insert("obj-payments".to_string(), rect(400.0, 300.0));
    ctx.connections.insert(
        "conn-pay".to_string(),
        EdgeLayout {
            label_position: None,
            waypoints: vec![],
        },
    );
    // custom landing: from context, clicking Storefront goes to diag-store-b
    ctx.landing.insert(
        "obj-storefront".to_string(),
        "diag-store-b".to_string(),
    );

    let mut store_a = Diagram {
        id: "diag-store-a".to_string(),
        name: "Storefront App".to_string(),
        level: DiagramLevel::App,
        scope_object_id: Some("obj-storefront".to_string()),
        domain_id: None,
        description: "Storefront detail".to_string(),
        order: 0,
        pinned: false,
        boxes: BTreeMap::new(),
        connections: BTreeMap::new(),
        viewport: None,
        landing: BTreeMap::new(),
        auto_placed: false,
        created: "2026-01-01".to_string(),
        modified: "2026-01-02".to_string(),
        extra: BTreeMap::new(),
    };
    store_a.boxes.insert("obj-webapp".to_string(), rect(0.0, 0.0));
    store_a.boxes.insert("obj-orders".to_string(), rect(300.0, 0.0));
    store_a.boxes.insert("obj-queue".to_string(), rect(150.0, 200.0));
    store_a.boxes.insert("obj-cart".to_string(), rect(0.0, 300.0));
    store_a.connections.insert(
        "conn-order".to_string(),
        EdgeLayout {
            label_position: Some(0.5),
            waypoints: vec![],
        },
    );

    let mut store_b = Diagram {
        id: "diag-store-b".to_string(),
        name: "Storefront Alt".to_string(),
        level: DiagramLevel::App,
        scope_object_id: Some("obj-storefront".to_string()),
        domain_id: None,
        description: "Second view".to_string(),
        order: 1,
        pinned: false,
        boxes: BTreeMap::new(),
        connections: BTreeMap::new(),
        viewport: None,
        landing: BTreeMap::new(),
        auto_placed: false,
        created: "2026-01-01".to_string(),
        modified: "2026-01-02".to_string(),
        extra: BTreeMap::new(),
    };
    store_b.boxes.insert("obj-webapp".to_string(), rect(10.0, 10.0));
    store_b
        .boxes
        .insert("obj-orders".to_string(), rect(310.0, 10.0));

    doc.diagrams.insert(ctx.id.clone(), ctx);
    doc.diagrams.insert(store_a.id.clone(), store_a);
    doc.diagrams.insert(store_b.id.clone(), store_b);

    // flows
    let pay_path = FlowPath {
        id: "path-pay".to_string(),
        name: "Pay now".to_string(),
        steps: vec![
            FlowStep {
                id: "step-pay".to_string(),
                kind: StepKind::Message,
                title: "Pay".to_string(),
                description: "Pay for the cart".to_string(),
                origin_id: Some("obj-webapp".to_string()),
                target_id: Some("obj-payments-api".to_string()),
                via_connection_id: Some("conn-pay".to_string()),
                reversed: false,
                object_id: None,
                go_to_flow_id: None,
                paths: vec![],
                extra: BTreeMap::new(),
            },
            FlowStep {
                id: "step-pay-resp".to_string(),
                kind: StepKind::Message,
                title: "Payment ok".to_string(),
                description: "Response".to_string(),
                origin_id: Some("obj-payments-api".to_string()),
                target_id: Some("obj-webapp".to_string()),
                via_connection_id: Some("conn-pay".to_string()),
                reversed: true,
                object_id: None,
                go_to_flow_id: None,
                paths: vec![],
                extra: BTreeMap::new(),
            },
        ],
        extra: BTreeMap::new(),
    };
    let save_path = FlowPath {
        id: "path-save".to_string(),
        name: "Save cart".to_string(),
        steps: vec![FlowStep {
            id: "step-save".to_string(),
            kind: StepKind::Process,
            title: "Save cart".to_string(),
            description: "Save for later".to_string(),
            origin_id: None,
            target_id: None,
            via_connection_id: None,
            reversed: false,
            object_id: Some("obj-cart".to_string()),
            go_to_flow_id: None,
            paths: vec![],
            extra: BTreeMap::new(),
        }],
        extra: BTreeMap::new(),
    };
    let flow_checkout = Flow {
        id: "flow-checkout".to_string(),
        name: "Checkout".to_string(),
        description: "Checkout flow".to_string(),
        diagram_id: Some("diag-context".to_string()),
        pinned: false,
        show_all_connection_names: false,
        show_all_steps: false,
        steps: vec![
            FlowStep {
                id: "step-intro".to_string(),
                kind: StepKind::Introduction,
                title: "Welcome".to_string(),
                description: "Intro".to_string(),
                origin_id: None,
                target_id: None,
                via_connection_id: None,
                reversed: false,
                object_id: None,
                go_to_flow_id: None,
                paths: vec![],
                extra: BTreeMap::new(),
            },
            FlowStep {
                id: "step-browse".to_string(),
                kind: StepKind::Message,
                title: "Browse store".to_string(),
                description: "Customer browses".to_string(),
                origin_id: Some("obj-customer".to_string()),
                target_id: Some("obj-webapp".to_string()),
                via_connection_id: Some("conn-browse".to_string()),
                reversed: false,
                object_id: None,
                go_to_flow_id: None,
                paths: vec![],
                extra: BTreeMap::new(),
            },
            FlowStep {
                id: "step-choice".to_string(),
                kind: StepKind::AlternatePaths,
                title: "Pay or save".to_string(),
                description: "Choice".to_string(),
                origin_id: None,
                target_id: None,
                via_connection_id: None,
                reversed: false,
                object_id: None,
                go_to_flow_id: None,
                paths: vec![pay_path, save_path],
                extra: BTreeMap::new(),
            },
            FlowStep {
                id: "step-goto".to_string(),
                kind: StepKind::GoToFlow,
                title: "See receipt".to_string(),
                description: "".to_string(),
                origin_id: None,
                target_id: None,
                via_connection_id: None,
                reversed: false,
                object_id: None,
                go_to_flow_id: Some("flow-receipt".to_string()),
                paths: vec![],
                extra: BTreeMap::new(),
            },
        ],
        extra: BTreeMap::new(),
    };
    let flow_receipt = Flow {
        id: "flow-receipt".to_string(),
        name: "Receipt".to_string(),
        description: "Receipt flow".to_string(),
        diagram_id: None,
        pinned: false,
        show_all_connection_names: false,
        show_all_steps: false,
        steps: vec![
            FlowStep {
                id: "step-r1".to_string(),
                kind: StepKind::Process,
                title: "Print receipt".to_string(),
                description: "".to_string(),
                origin_id: None,
                target_id: None,
                via_connection_id: None,
                reversed: false,
                object_id: Some("obj-cart".to_string()),
                go_to_flow_id: None,
                paths: vec![],
                extra: BTreeMap::new(),
            },
            FlowStep {
                id: "step-r2".to_string(),
                kind: StepKind::Conclusion,
                title: "Done".to_string(),
                description: "".to_string(),
                origin_id: None,
                target_id: None,
                via_connection_id: None,
                reversed: false,
                object_id: None,
                go_to_flow_id: None,
                paths: vec![],
                extra: BTreeMap::new(),
            },
        ],
        extra: BTreeMap::new(),
    };
    doc.model
        .flows
        .insert(flow_checkout.id.clone(), flow_checkout);
    doc.model.flows.insert(flow_receipt.id.clone(), flow_receipt);

    doc
}
