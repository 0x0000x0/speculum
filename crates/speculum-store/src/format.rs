use speculum_core::Document;

use crate::error::StoreError;

/// Serialize a document to the canonical on-disk form:
/// pretty JSON (2-space), LF endings, trailing newline.
///
/// `serde_json` is used without the `preserve_order` feature so all
/// `BTreeMap`s (which core uses everywhere) emit keys sorted.
pub fn to_bytes(doc: &Document) -> Vec<u8> {
    let mut s = serde_json::to_string_pretty(doc).expect("document is serializable");
    s.push('\n');
    // `to_string_pretty` uses `\n` already; normalize just in case.
    let normalized = s.replace("\r\n", "\n");
    normalized.into_bytes()
}

/// Parse bytes produced by [`to_bytes`]. Any `schema != 1` is rejected.
pub fn from_bytes(bytes: &[u8]) -> Result<Document, StoreError> {
    let doc: Document = serde_json::from_slice(bytes)?;
    if doc.schema != 1 {
        return Err(StoreError::UnsupportedSchema { found: doc.schema });
    }
    Ok(doc)
}
