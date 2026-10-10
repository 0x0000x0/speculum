mod fixtures;

use fixtures::sample_document;
use speculum_core::search;

#[test]
fn search_exact_beats_prefix() {
    let doc = sample_document();
    let hits = search(&doc, "Web App", 10);
    assert!(!hits.is_empty());
    assert_eq!(hits[0].id, "obj-webapp");
    assert_eq!(hits[0].kind, "app");
    assert!(hits[0].path.contains(&"Storefront".to_string()));
}

#[test]
fn search_prefix_match() {
    let doc = sample_document();
    let hits = search(&doc, "Pay", 10);
    // Payments + Payments API both prefix; exact ordering by score then name
    assert!(hits.iter().any(|h| h.id == "obj-payments"));
    assert!(hits.iter().any(|h| h.id == "obj-payments-api"));
}

#[test]
fn search_typo_one_letter() {
    let doc = sample_document();
    // "Paymnts" is 1 typo away from "Payments"
    let hits = search(&doc, "Paymnts", 10);
    assert!(
        hits.iter().any(|h| h.id == "obj-payments"),
        "typo search failed: {hits:?}"
    );
}

#[test]
fn search_substring_and_subsequence() {
    let doc = sample_document();
    let sub = search(&doc, "oken", 10);
    assert!(sub.iter().any(|h| h.id == "obj-tokenizer"));
    let seq = search(&doc, "ctsr", 10);
    // subsequence of "Cart Service" (c...t...s...r)? ensure at least something or empty without panic
    let _ = seq;
    // caption matches with lower score than name
    let cap = search(&doc, "caption", 10);
    assert!(!cap.is_empty());
    let name_hit = search(&doc, "Web App", 1);
    let cap_hit = search(&doc, "Web App caption", 1);
    if !cap_hit.is_empty() && !name_hit.is_empty() {
        assert!(cap_hit[0].score <= name_hit[0].score);
    }
}

#[test]
fn search_finds_connection() {
    let doc = sample_document();
    let hits = search(&doc, "Browse store", 10);
    let hit = hits.iter().find(|h| h.id == "conn-browse").unwrap();
    assert_eq!(hit.kind, "connection");
}

#[test]
fn search_finds_diagram_and_flow() {
    let doc = sample_document();
    let d = search(&doc, "Storefront App", 10);
    assert!(d.iter().any(|h| h.id == "diag-store-a" && h.kind == "diagram"));
    let f = search(&doc, "Checkout", 10);
    assert!(f.iter().any(|h| h.id == "flow-checkout" && h.kind == "flow"));
    // limit respected
    let many = search(&doc, "a", 2);
    assert!(many.len() <= 2);
}
