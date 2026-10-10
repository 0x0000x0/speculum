pub const APP_NAME: &str = "Speculum";

pub mod command;
pub mod history;
pub mod model;
pub mod rollup;
pub mod search;
pub mod validate;

pub use command::{intelligent_step, Command, ConnectionPatch, CoreError, ObjectPatch};
pub use history::{Entry, History};
pub use model::{
    Connection, Diagram, DiagramLevel, Direction, Document, Domain, EdgeLayout, Flow, FlowPath,
    FlowStep, Id, IdGen, LineShape, Link, Meta, Model, Object, ObjectKind, Point, Rect, Status,
    StepKind, Tag, TagGroup, Viewport,
};
pub use rollup::{diagram_edges, hover_set, step_location, Endpoint, HoverSet, StepLocation, ViewEdge};
pub use search::{search, search_model, Hit};
pub use validate::{repair, repair_document, validate, validate_document, Issue, Severity};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_name_is_speculum() {
        assert_eq!(APP_NAME, "Speculum");
    }
}
