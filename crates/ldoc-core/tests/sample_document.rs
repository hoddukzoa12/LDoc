//! Drafts the example answers and writes the document as JSON for the
//! frontend's editor adapter test, the way ts-rs writes the bindings.

use ldoc_core::{Answers, draft};
use std::{fs, path::Path};

#[test]
fn writes_the_sample_document() {
    let answers: Answers =
        serde_json::from_str(include_str!("../examples/payment-order-goods.json")).unwrap();
    let drafted = draft("payment-order-goods", &answers).unwrap();
    let json = serde_json::to_string_pretty(&drafted.document).unwrap() + "\n";
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src/fixtures");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("payment-order-goods.document.json"), json).unwrap();
}
