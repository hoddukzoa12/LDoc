//! Prints how the core masks each pasted text in e2e/assist-fixtures.json at
//! each level, with the fixture's personal strings added as the person's
//! words when they review it, and the fields a fill turn would offer. The
//! recorded replies in src-tauri/replay/ find their values in these texts by
//! what surrounds them.
//!
//!   cargo run -p ldoc-core --example mask

use ldoc_core::{Answers, Masking, form, mask, open_fields};
use serde_json::Value;
use std::{fs, path::Path};

fn main() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../e2e/assist-fixtures.json");
    let fixtures: Vec<Value> = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let form = form("payment-order-goods").unwrap();
    let answers = Answers::new();
    let offered: Vec<String> = open_fields(&form, &answers)
        .into_iter()
        .map(|spec| spec.id)
        .collect();
    println!("offered: {}\n", offered.join(", "));
    for fixture in fixtures {
        let words: Vec<String> = serde_json::from_value(fixture["pii"].clone()).unwrap();
        for masking in [Masking::Off, Masking::Identifiers, Masking::Reviewed] {
            let masked = mask(
                fixture["pasted"].as_str().unwrap(),
                &form,
                &answers,
                masking,
                &words,
            );
            println!("== {} {masking:?}\n{}\n", fixture["id"], masked.text());
        }
    }
}
