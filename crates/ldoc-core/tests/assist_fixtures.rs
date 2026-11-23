//! Holds the masking levels to the pasted texts in e2e/assist-fixtures.json.
//! The shell's tests hold the replay recordings in src-tauri/replay/ to the
//! same texts.

use ldoc_core::{Answers, Masking, form, mask};
use serde_json::Value;
use std::{fs, path::Path};

fn fixtures() -> Vec<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../e2e/assist-fixtures.json");
    serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap()
}

fn strings(value: &Value) -> Vec<String> {
    serde_json::from_value(value.clone()).unwrap()
}

/// Masking identifiers removes the fixture's identifiers and nothing else on
/// its personal list: names and addresses go as written.
#[test]
fn identifiers_masking_removes_exactly_the_identifiers() {
    let form = form("payment-order-goods").unwrap();
    for fixture in fixtures() {
        let id = fixture["id"].as_str().unwrap();
        let masked = mask(
            fixture["pasted"].as_str().unwrap(),
            &form,
            &Answers::new(),
            Masking::Identifiers,
            &[],
        );
        let removed: Vec<String> = strings(&fixture["pii"])
            .into_iter()
            .filter(|personal| !masked.text().contains(personal.as_str()))
            .collect();
        assert_eq!(
            removed,
            strings(&fixture["identifiers"]),
            "{id}: {}",
            masked.text()
        );
    }
}

/// Reviewing with the fixture's personal strings added as the person's
/// words leaves none of them.
#[test]
fn reviewed_masking_with_the_personal_strings_leaves_none() {
    let form = form("payment-order-goods").unwrap();
    for fixture in fixtures() {
        let id = fixture["id"].as_str().unwrap();
        let pii = strings(&fixture["pii"]);
        let masked = mask(
            fixture["pasted"].as_str().unwrap(),
            &form,
            &Answers::new(),
            Masking::Reviewed,
            &pii,
        );
        for personal in &pii {
            assert!(
                !masked.text().contains(personal.as_str()),
                "{id}: {personal} left in {}",
                masked.text()
            );
        }
    }
}
