use crate::model::{Document, Id, Model};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    #[serde(default)]
    pub id: Id,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub score: i32,
    #[serde(default)]
    pub path: Vec<String>,
}

/// Global search over objects, connections, diagrams and flows.
pub fn search(doc: &Document, query: &str, limit: usize) -> Vec<Hit> {
    search_inner(&doc.model, Some(&doc.diagrams), query, limit)
}

/// Search a model without diagrams.
pub fn search_model(model: &Model, query: &str, limit: usize) -> Vec<Hit> {
    search_inner(model, None, query, limit)
}

fn search_inner(
    model: &Model,
    diagrams: Option<&BTreeMap<Id, crate::model::Diagram>>,
    query: &str,
    limit: usize,
) -> Vec<Hit> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<Hit> = Vec::new();

    for (id, obj) in &model.objects {
        let kind = format!("{:?}", obj.kind).to_lowercase();
        let path: Vec<String> = {
            let mut anc = model.ancestors(id);
            anc.reverse();
            anc.into_iter().map(|a| a.name.clone()).collect()
        };
        if let Some(score) = match_text(&obj.name, &q) {
            hits.push(Hit {
                id: id.clone(),
                name: obj.name.clone(),
                kind: kind.clone(),
                score,
                path: path.clone(),
            });
        } else if let Some(score) = match_text(&obj.caption, &q) {
            // caption scores always lower than any name match
            hits.push(Hit {
                id: id.clone(),
                name: obj.name.clone(),
                kind,
                score: caption_score(score),
                path,
            });
        }
    }

    for (id, c) in &model.connections {
        if let Some(score) = match_text(&c.name, &q) {
            hits.push(Hit {
                id: id.clone(),
                name: c.name.clone(),
                kind: "connection".to_string(),
                score,
                path: Vec::new(),
            });
        } else if let Some(score) = match_text(&c.description, &q) {
            hits.push(Hit {
                id: id.clone(),
                name: c.name.clone(),
                kind: "connection".to_string(),
                score: caption_score(score),
                path: Vec::new(),
            });
        }
    }

    for (id, f) in &model.flows {
        if let Some(score) = match_text(&f.name, &q) {
            hits.push(Hit {
                id: id.clone(),
                name: f.name.clone(),
                kind: "flow".to_string(),
                score,
                path: Vec::new(),
            });
        } else if let Some(score) = match_text(&f.description, &q) {
            hits.push(Hit {
                id: id.clone(),
                name: f.name.clone(),
                kind: "flow".to_string(),
                score: caption_score(score),
                path: Vec::new(),
            });
        }
    }

    if let Some(diagrams) = diagrams {
        for (id, d) in diagrams.iter() {
            let path = match &d.scope_object_id {
                Some(scope) => {
                    let mut anc = model.ancestors(scope);
                    anc.reverse();
                    let mut p: Vec<String> = anc.into_iter().map(|a| a.name.clone()).collect();
                    if let Some(s) = model.objects.get(scope) {
                        p.push(s.name.clone());
                    }
                    p
                }
                None => Vec::new(),
            };
            if let Some(score) = match_text(&d.name, &q) {
                hits.push(Hit {
                    id: id.clone(),
                    name: d.name.clone(),
                    kind: "diagram".to_string(),
                    score,
                    path,
                });
            } else if let Some(score) = match_text(&d.description, &q) {
                hits.push(Hit {
                    id: id.clone(),
                    name: d.name.clone(),
                    kind: "diagram".to_string(),
                    score: caption_score(score),
                    path,
                });
            }
        }
    }

    // Sort by score desc, then name, then id.
    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
    hits.truncate(limit);
    hits
}

fn caption_score(name_tier_score: i32) -> i32 {
    // Map name-tier score to a caption score strictly below any name score.
    // Name tiers: 100 / 80 / 60 / 40 / 30. Caption: 25 / 20 / 15 / 10 / 5.
    match name_tier_score {
        100 => 25,
        80 => 20,
        60 => 15,
        40 => 10,
        30 => 5,
        _ => 0,
    }
}

/// Score a single text field against the query. Returns name-tier score.
fn match_text(text: &str, q: &str) -> Option<i32> {
    let t = text.to_lowercase();
    if t.is_empty() {
        return None;
    }
    if t == *q {
        return Some(100);
    }
    if t.starts_with(q) {
        return Some(80);
    }
    if t.contains(q) {
        return Some(60);
    }
    if is_subsequence(&t, q) {
        return Some(40);
    }
    if is_one_typo(&t, q) {
        return Some(30);
    }
    None
}

fn is_subsequence(haystack: &str, needle: &str) -> bool {
    let mut ni = needle.chars();
    let mut cur = ni.next();
    if cur.is_none() {
        return false;
    }
    for c in haystack.chars() {
        if Some(c) == cur {
            cur = ni.next();
            if cur.is_none() {
                return true;
            }
        }
    }
    false
}

fn is_one_typo(haystack: &str, query: &str) -> bool {
    // Only for single-word queries; compare against each word of haystack.
    if query.contains(' ') {
        return false;
    }
    for word in haystack.split(|c: char| !c.is_alphanumeric()) {
        if word.is_empty() {
            continue;
        }
        if levenshtein_le1(word, query) {
            return true;
        }
    }
    false
}

fn levenshtein_le1(a: &str, b: &str) -> bool {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let n = a.len();
    let m = b.len();
    if n.abs_diff(m) > 1 {
        return false;
    }
    // Full DP but small strings; early exit if > 1.
    let mut prev: Vec<usize> = (0..=m).collect();
    for i in 1..=n {
        let mut cur = vec![i; m + 1];
        for j in 1..=m {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        if cur.iter().all(|&x| x > 1) {
            return false;
        }
        prev = cur;
    }
    prev[m] <= 1
}
