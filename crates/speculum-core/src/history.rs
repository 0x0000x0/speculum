use crate::command::{Command, CoreError};
use crate::model::Document;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub inverse: Command,
    pub forward: Command,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merge_key: Option<String>,
    #[serde(default)]
    pub at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    #[serde(default)]
    pub undo: Vec<Entry>,
    #[serde(default)]
    pub redo: Vec<Entry>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    500
}

impl Default for History {
    fn default() -> Self {
        Self {
            undo: Vec::new(),
            redo: Vec::new(),
            limit: 500,
        }
    }
}

impl History {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_limit(limit: usize) -> Self {
        Self {
            undo: Vec::new(),
            redo: Vec::new(),
            limit,
        }
    }

    pub fn dispatch(&mut self, doc: &mut Document, cmd: Command, now_ms: u64) -> Result<(), CoreError> {
        let merge_key = merge_key_for(&cmd);
        // Clone cmd for forward storage (we need forward after apply consumes it).
        let forward = cmd.clone();
        let inverse = cmd.apply(doc)?;
        // new dispatch clears redo
        self.redo.clear();

        // Merging: consecutive PatchObject/PatchConnection/PatchStep/PatchFlow/PatchDiagram
        // on the same id touching the same single text field within 1000ms merge.
        if let Some(key) = merge_key.clone() {
            if let Some(last) = self.undo.last() {
                if last.merge_key.as_ref() == Some(&key) && now_ms.saturating_sub(last.at_ms) <= 1000 {
                    // Merge: keep oldest inverse, update forward to newest, update timestamp.
                    let last_mut = self.undo.last_mut().unwrap();
                    last_mut.forward = forward;
                    last_mut.at_ms = now_ms;
                    // keep oldest inverse (do nothing)
                    self.trim();
                    return Ok(());
                }
            }
        }

        self.undo.push(Entry {
            inverse,
            forward,
            merge_key,
            at_ms: now_ms,
        });
        self.trim();
        Ok(())
    }

    pub fn undo(&mut self, doc: &mut Document) -> Result<bool, CoreError> {
        match self.undo.pop() {
            None => Ok(false),
            Some(entry) => {
                let forward = entry.forward.clone();
                // Apply inverse; it returns the re-inverse (should equal forward, modulo Batch wrapping).
                let re_forward = entry.inverse.clone().apply(doc)?;
                let _ = re_forward;
                self.redo.push(Entry {
                    inverse: entry.inverse,
                    forward,
                    merge_key: entry.merge_key,
                    at_ms: entry.at_ms,
                });
                Ok(true)
            }
        }
    }

    pub fn redo(&mut self, doc: &mut Document) -> Result<bool, CoreError> {
        match self.redo.pop() {
            None => Ok(false),
            Some(entry) => {
                let inverse = entry.forward.clone().apply(doc)?;
                let _ = inverse;
                // Push back onto undo with the original inverse? Actually the new inverse
                // from re-applying forward should match original inverse; keep original
                // to preserve merge keys.
                self.undo.push(Entry {
                    inverse: entry.inverse,
                    forward: entry.forward,
                    merge_key: None,
                    at_ms: entry.at_ms,
                });
                self.trim();
                Ok(true)
            }
        }
    }

    fn trim(&mut self) {
        while self.undo.len() > self.limit {
            self.undo.remove(0);
        }
        while self.redo.len() > self.limit {
            self.redo.remove(0);
        }
    }
}

/// Merge key: only for single-text-field patches. Returns Some(key) if mergeable.
fn merge_key_for(cmd: &Command) -> Option<String> {
    match cmd {
        Command::PatchObject { id, patch } => {
            single_field(patch).map(|f| format!("patchObject:{id}:{f}"))
        }
        Command::PatchConnection { id, patch } => {
            single_field_conn(patch).map(|f| format!("patchConnection:{id}:{f}"))
        }
        Command::PatchStep { flow_id, step_id, title, description, kind, reversed, origin_id, target_id, via_connection_id, object_id, go_to_flow_id } => {
            let mut count = 0;
            let mut field = "";
            if title.is_some() { count += 1; field = "title"; }
            if description.is_some() { count += 1; field = "description"; }
            if kind.is_some() { count += 1; }
            if reversed.is_some() { count += 1; }
            if origin_id.is_some() { count += 1; }
            if target_id.is_some() { count += 1; }
            if via_connection_id.is_some() { count += 1; }
            if object_id.is_some() { count += 1; }
            if go_to_flow_id.is_some() { count += 1; }
            if count == 1 && (field == "title" || field == "description") {
                Some(format!("patchStep:{flow_id}:{step_id}:{field}"))
            } else {
                None
            }
        }
        Command::PatchFlow { id, name, description, pinned, show_all_connection_names, show_all_steps, diagram_id } => {
            let mut count = 0;
            let mut field = "";
            if name.is_some() { count += 1; field = "name"; }
            if description.is_some() { count += 1; field = "description"; }
            if pinned.is_some() { count += 1; }
            if show_all_connection_names.is_some() { count += 1; }
            if show_all_steps.is_some() { count += 1; }
            if diagram_id.is_some() { count += 1; }
            if count == 1 && (field == "name" || field == "description") {
                Some(format!("patchFlow:{id}:{field}"))
            } else {
                None
            }
        }
        Command::PatchDiagram { id, name, description, order, pinned, domain_id } => {
            let mut count = 0;
            let mut field = "";
            if name.is_some() { count += 1; field = "name"; }
            if description.is_some() { count += 1; field = "description"; }
            if order.is_some() { count += 1; }
            if pinned.is_some() { count += 1; }
            if domain_id.is_some() { count += 1; }
            if count == 1 && (field == "name" || field == "description") {
                Some(format!("patchDiagram:{id}:{field}"))
            } else {
                None
            }
        }
        _ => None,
    }
}

fn single_field(patch: &crate::command::ObjectPatch) -> Option<&'static str> {
    let mut count = 0;
    let mut field = "";
    if patch.name.is_some() { count += 1; field = "name"; }
    if patch.caption.is_some() { count += 1; field = "caption"; }
    if patch.description.is_some() { count += 1; field = "description"; }
    if patch.status.is_some() { count += 1; }
    if patch.external.is_some() { count += 1; }
    if patch.icon.is_some() { count += 1; }
    if patch.tag_ids.is_some() { count += 1; }
    if patch.technologies.is_some() { count += 1; }
    if patch.links.is_some() { count += 1; }
    if patch.group_ids.is_some() { count += 1; }
    if patch.domain_id.is_some() { count += 1; }
    if patch.labels.is_some() { count += 1; }
    if count == 1 && (field == "name" || field == "caption" || field == "description") {
        Some(match field {
            "name" => "name",
            "caption" => "caption",
            "description" => "description",
            _ => field,
        })
    } else {
        None
    }
}

fn single_field_conn(patch: &crate::command::ConnectionPatch) -> Option<&'static str> {
    let mut count = 0;
    let mut field = "";
    if patch.name.is_some() { count += 1; field = "name"; }
    if patch.description.is_some() { count += 1; field = "description"; }
    if patch.direction.is_some() { count += 1; }
    if patch.status.is_some() { count += 1; }
    if patch.line_shape.is_some() { count += 1; }
    if patch.label_position.is_some() { count += 1; }
    if patch.via_id.is_some() { count += 1; }
    if patch.tag_ids.is_some() { count += 1; }
    if patch.technologies.is_some() { count += 1; }
    if patch.links.is_some() { count += 1; }
    if patch.origin_id.is_some() { count += 1; }
    if patch.target_id.is_some() { count += 1; }
    if count == 1 && (field == "name" || field == "description") {
        Some(field)
    } else {
        None
    }
}
