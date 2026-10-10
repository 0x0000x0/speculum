use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Stable string identifier.
pub type Id = String;

fn default_schema() -> u32 {
    1
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ObjectKind {
    Actor,
    System,
    Group,
    App,
    Store,
    #[default]
    Component,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    Live,
    Future,
    Deprecated,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    #[default]
    Outgoing,
    Bidirectional,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LineShape {
    #[default]
    Curved,
    Straight,
    Square,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DiagramLevel {
    #[default]
    Context,
    App,
    Component,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum StepKind {
    Introduction,
    #[default]
    Message,
    Process,
    #[serde(rename = "alternate-paths")]
    AlternatePaths,
    #[serde(rename = "parallel-paths")]
    ParallelPaths,
    #[serde(rename = "go-to-flow")]
    GoToFlow,
    Information,
    Conclusion,
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub url: String,
}

// ---------------------------------------------------------------------------
// Object
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Object {
    #[serde(default)]
    pub id: Id,
    #[serde(default)]
    pub name: String,
    #[serde(rename = "type", default)]
    pub kind: ObjectKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<Id>,
    #[serde(default)]
    pub status: Status,
    #[serde(default)]
    pub external: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub caption: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tag_ids: Vec<Id>,
    #[serde(default)]
    pub technologies: Vec<String>,
    #[serde(default)]
    pub links: Vec<Link>,
    #[serde(default)]
    pub group_ids: Vec<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_id: Option<Id>,
    #[serde(default)]
    pub labels: BTreeMap<String, String>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl Default for Object {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            kind: ObjectKind::Component,
            parent_id: None,
            status: Status::Live,
            external: false,
            icon: None,
            caption: String::new(),
            description: String::new(),
            tag_ids: Vec::new(),
            technologies: Vec::new(),
            links: Vec::new(),
            group_ids: Vec::new(),
            domain_id: None,
            labels: BTreeMap::new(),
            extra: BTreeMap::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    #[serde(default)]
    pub id: Id,
    #[serde(default)]
    pub origin_id: Id,
    #[serde(default)]
    pub target_id: Id,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub direction: Direction,
    #[serde(default)]
    pub status: Status,
    #[serde(default)]
    pub line_shape: LineShape,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label_position: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via_id: Option<Id>,
    #[serde(default)]
    pub tag_ids: Vec<Id>,
    #[serde(default)]
    pub technologies: Vec<String>,
    #[serde(default)]
    pub links: Vec<Link>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl Default for Connection {
    fn default() -> Self {
        Self {
            id: String::new(),
            origin_id: String::new(),
            target_id: String::new(),
            name: String::new(),
            description: String::new(),
            direction: Direction::Outgoing,
            status: Status::Live,
            line_shape: LineShape::Curved,
            label_position: None,
            via_id: None,
            tag_ids: Vec::new(),
            technologies: Vec::new(),
            links: Vec::new(),
            extra: BTreeMap::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Tag / TagGroup / Domain
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    #[serde(default)]
    pub id: Id,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<Id>,
    #[serde(default)]
    pub index: u32,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagGroup {
    #[serde(default)]
    pub id: Id,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub index: u32,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Domain {
    #[serde(default)]
    pub id: Id,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub w: f64,
    #[serde(default)]
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub zoom: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EdgeLayout {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label_position: Option<f64>,
    #[serde(default)]
    pub waypoints: Vec<Point>,
}

// ---------------------------------------------------------------------------
// Diagram
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagram {
    #[serde(default)]
    pub id: Id,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub level: DiagramLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_object_id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_id: Option<Id>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub order: u32,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub boxes: BTreeMap<Id, Rect>,
    #[serde(default)]
    pub connections: BTreeMap<Id, EdgeLayout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewport: Option<Viewport>,
    #[serde(default)]
    pub landing: BTreeMap<Id, Id>,
    #[serde(default)]
    pub auto_placed: bool,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl Default for Diagram {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            level: DiagramLevel::Context,
            scope_object_id: None,
            domain_id: None,
            description: String::new(),
            order: 0,
            pinned: false,
            boxes: BTreeMap::new(),
            connections: BTreeMap::new(),
            viewport: None,
            landing: BTreeMap::new(),
            auto_placed: false,
            created: String::new(),
            modified: String::new(),
            extra: BTreeMap::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowStep {
    #[serde(default)]
    pub id: Id,
    #[serde(default)]
    pub kind: StepKind,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via_connection_id: Option<Id>,
    #[serde(default)]
    pub reversed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub go_to_flow_id: Option<Id>,
    #[serde(default)]
    pub paths: Vec<FlowPath>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl Default for FlowStep {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: StepKind::Message,
            title: String::new(),
            description: String::new(),
            origin_id: None,
            target_id: None,
            via_connection_id: None,
            reversed: false,
            object_id: None,
            go_to_flow_id: None,
            paths: Vec::new(),
            extra: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowPath {
    #[serde(default)]
    pub id: Id,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub steps: Vec<FlowStep>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Flow {
    #[serde(default)]
    pub id: Id,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagram_id: Option<Id>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub show_all_connection_names: bool,
    #[serde(default)]
    pub show_all_steps: bool,
    #[serde(default)]
    pub steps: Vec<FlowStep>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl Flow {
    /// Depth-first walk of all steps including steps inside paths.
    pub fn walk_steps(&self) -> Vec<(&FlowStep, Vec<Id>)> {
        let mut out = Vec::new();
        fn rec<'a>(
            steps: &'a [FlowStep],
            trail: &mut Vec<Id>,
            out: &mut Vec<(&'a FlowStep, Vec<Id>)>,
        ) {
            for s in steps {
                out.push((s, trail.clone()));
                for p in &s.paths {
                    trail.push(p.id.clone());
                    rec(&p.steps, trail, out);
                    trail.pop();
                }
            }
        }
        let mut trail = Vec::new();
        rec(&self.steps, &mut trail, &mut out);
        out
    }

    /// Find a step anywhere in the flow (including inside paths).
    pub fn find_step(&self, id: &Id) -> Option<&FlowStep> {
        self.walk_steps()
            .into_iter()
            .find(|(s, _)| &s.id == id)
            .map(|(s, _)| s)
    }

    /// Mutable find.
    pub fn find_step_mut(&mut self, id: &Id) -> Option<&mut FlowStep> {
        fn rec<'a>(steps: &'a mut [FlowStep], id: &Id) -> Option<&'a mut FlowStep> {
            for s in steps.iter_mut() {
                if &s.id == id {
                    return Some(s);
                }
                for p in s.paths.iter_mut() {
                    if let Some(found) = rec(&mut p.steps, id) {
                        return Some(found);
                    }
                }
            }
            None
        }
        rec(&mut self.steps, id)
    }
}

// ---------------------------------------------------------------------------
// Model / Meta / Document
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[serde(default)]
    pub objects: BTreeMap<Id, Object>,
    #[serde(default)]
    pub connections: BTreeMap<Id, Connection>,
    #[serde(default)]
    pub tags: BTreeMap<Id, Tag>,
    #[serde(default)]
    pub tag_groups: BTreeMap<Id, TagGroup>,
    #[serde(default)]
    pub domains: BTreeMap<Id, Domain>,
    #[serde(default)]
    pub flows: BTreeMap<Id, Flow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    #[serde(default = "default_schema")]
    pub schema: u32,
    #[serde(default)]
    pub meta: Meta,
    #[serde(default)]
    pub model: Model,
    #[serde(default)]
    pub diagrams: BTreeMap<Id, Diagram>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            schema: 1,
            meta: Meta::default(),
            model: Model::default(),
            diagrams: BTreeMap::new(),
        }
    }
}

impl Document {
    pub fn new(name: String) -> Self {
        Self {
            schema: 1,
            meta: Meta {
                name,
                created: String::new(),
                modified: String::new(),
            },
            model: Model::default(),
            diagrams: BTreeMap::new(),
        }
    }

    /// Diagrams with the given scope, sorted by order then id.
    pub fn diagrams_for_scope(&self, scope: Option<&Id>) -> Vec<&Diagram> {
        let mut out: Vec<&Diagram> = self
            .diagrams
            .values()
            .filter(|d| d.scope_object_id.as_ref() == scope)
            .collect();
        out.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
        out
    }

    /// Custom landing if set on `from_diagram` for `object_id`, else the
    /// lowest-order diagram scoped to that object, else None.
    pub fn landing_diagram(&self, from_diagram_id: &Id, object_id: &Id) -> Option<&Diagram> {
        if let Some(from) = self.diagrams.get(from_diagram_id) {
            if let Some(target_id) = from.landing.get(object_id) {
                if let Some(target) = self.diagrams.get(target_id) {
                    return Some(target);
                }
            }
        }
        let mut candidates: Vec<&Diagram> = self
            .diagrams
            .values()
            .filter(|d| d.scope_object_id.as_ref() == Some(object_id))
            .collect();
        candidates.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
        candidates.into_iter().next()
    }

    /// All diagrams whose boxes contain the object.
    pub fn diagrams_containing(&self, object_id: &Id) -> Vec<&Diagram> {
        let mut out: Vec<&Diagram> = self
            .diagrams
            .values()
            .filter(|d| d.boxes.contains_key(object_id))
            .collect();
        out.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
        out
    }

    /// All flows with a step referencing the given object or connection id.
    pub fn flows_containing(&self, id: &Id) -> Vec<&Flow> {
        self.model
            .flows
            .values()
            .filter(|f| {
                f.walk_steps().iter().any(|(s, _)| {
                    s.origin_id.as_ref() == Some(id)
                        || s.target_id.as_ref() == Some(id)
                        || s.object_id.as_ref() == Some(id)
                        || s.via_connection_id.as_ref() == Some(id)
                })
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

impl Model {
    /// Direct children of `id`, sorted by name then id.
    pub fn children(&self, id: &Id) -> Vec<&Object> {
        let mut out: Vec<&Object> = self
            .objects
            .values()
            .filter(|o| o.parent_id.as_ref() == Some(id))
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        out
    }

    /// Top-level objects (no parent, or parent missing), sorted by name then id.
    pub fn root_objects(&self) -> Vec<&Object> {
        let mut out: Vec<&Object> = self
            .objects
            .values()
            .filter(|o| match &o.parent_id {
                None => true,
                Some(pid) => !self.objects.contains_key(pid),
            })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        out
    }

    /// Ancestors of `id`, nearest first. Cycle-safe.
    pub fn ancestors(&self, id: &Id) -> Vec<&Object> {
        let mut out = Vec::new();
        let mut seen: std::collections::BTreeSet<Id> = std::collections::BTreeSet::new();
        seen.insert(id.clone());
        let mut cur = self.objects.get(id).and_then(|o| o.parent_id.clone());
        while let Some(pid) = cur {
            if !seen.insert(pid.clone()) {
                break;
            }
            match self.objects.get(&pid) {
                Some(obj) => {
                    out.push(obj);
                    cur = obj.parent_id.clone();
                }
                None => break,
            }
        }
        out
    }

    /// Depth of `id` (number of ancestors). Cycle-safe.
    pub fn depth(&self, id: &Id) -> usize {
        self.ancestors(id).len()
    }

    /// True if `a` is an ancestor of `b`.
    pub fn is_ancestor(&self, a: &Id, b: &Id) -> bool {
        if a == b {
            return false;
        }
        let mut seen: std::collections::BTreeSet<Id> = std::collections::BTreeSet::new();
        seen.insert(b.clone());
        let mut cur = self.objects.get(b).and_then(|o| o.parent_id.clone());
        while let Some(pid) = cur {
            if &pid == a {
                return true;
            }
            if !seen.insert(pid.clone()) {
                break;
            }
            cur = self.objects.get(&pid).and_then(|o| o.parent_id.clone());
        }
        false
    }

    /// Members of a group: objects whose `group_ids` contain the group.
    /// Sorted by name then id.
    pub fn group_members(&self, group_id: &Id) -> Vec<&Object> {
        let mut out: Vec<&Object> = self
            .objects
            .values()
            .filter(|o| o.group_ids.iter().any(|g| g == group_id))
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        out
    }

    /// (incoming, outgoing) connections touching `id`, each sorted by id.
    pub fn connections_of(&self, id: &Id) -> (Vec<&Connection>, Vec<&Connection>) {
        let mut incoming: Vec<&Connection> = self
            .connections
            .values()
            .filter(|c| &c.target_id == id)
            .collect();
        let mut outgoing: Vec<&Connection> = self
            .connections
            .values()
            .filter(|c| &c.origin_id == id)
            .collect();
        incoming.sort_by(|a, b| a.id.cmp(&b.id));
        outgoing.sort_by(|a, b| a.id.cmp(&b.id));
        (incoming, outgoing)
    }
}

// ---------------------------------------------------------------------------
// IdGen
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdGen {
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub n: u64,
}

impl Default for IdGen {
    fn default() -> Self {
        Self {
            prefix: String::new(),
            n: 1,
        }
    }
}

impl IdGen {
    pub fn new(prefix: impl Into<String>) -> Self {
        Self {
            prefix: prefix.into(),
            n: 1,
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> Id {
        let id = format!("{}-{}", self.prefix, self.n);
        self.n += 1;
        id
    }

    /// Alias with a non-`next` name for clarity.
    pub fn next_id(&mut self) -> Id {
        self.next()
    }
}
