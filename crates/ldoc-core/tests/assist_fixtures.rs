//! Holds the replay recordings in src-tauri/replay/ to the pasted texts in
//! e2e/assist-fixtures.json: masking the text with its personal strings
//! leaves none of them, the recording's anchor survives masking, and the
//! core reads each recorded pointer the way the fixture expects.

use ldoc_core::{
    Answer, Answers, Candidate, TurnOutcome, TurnResult, form, mask, open_fields, outcome,
};
use serde_json::Value;
use std::{fs, path::Path};

fn read(relative: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap()
}

fn shown(candidate: &Candidate) -> (String, String) {
    match candidate {
        Candidate::Readable { field, value, .. } => {
            let value = match value {
                Answer::One(text) => text.clone(),
                Answer::Many(values) => values.join(","),
            };
            (field.clone(), value)
        }
        Candidate::Rejected { field, reason } => {
            let reason = serde_json::to_value(reason).unwrap();
            (
                field.clone(),
                format!("rejected:{}", reason.as_str().unwrap()),
            )
        }
    }
}

#[test]
fn each_recording_reads_as_its_fixture_expects() {
    let form = form("payment-order-goods").unwrap();
    let answers = Answers::new();
    let offered = open_fields(&form, &answers);
    let fixtures = read("../../e2e/assist-fixtures.json");
    for fixture in fixtures.as_array().unwrap() {
        let id = fixture["id"].as_str().unwrap();
        let pii: Vec<String> = serde_json::from_value(fixture["pii"].clone()).unwrap();
        let masked = mask(fixture["pasted"].as_str().unwrap(), &form, &answers, &pii);
        for personal in &pii {
            assert!(
                !masked.text().contains(personal.as_str()),
                "{id}: {personal} left in {}",
                masked.text()
            );
        }

        let recording = read(&format!("../../src-tauri/replay/{id}.json"));
        let anchor = recording["anchor"].as_str().unwrap();
        assert!(
            masked.text().contains(anchor),
            "{id}: anchor {anchor} masked away"
        );
        let result: TurnResult = serde_json::from_value(recording["result"].clone()).unwrap();
        let TurnOutcome::Fill { candidates } = outcome(result, &masked, &offered) else {
            panic!("{id}: not a fill outcome");
        };

        let mut read: Vec<(String, String)> = candidates.iter().map(shown).collect();
        let mut expected: Vec<(String, String)> = fixture["expect"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(field, value)| (field.clone(), value.as_str().unwrap().to_string()))
            .collect();
        read.sort();
        expected.sort();
        assert_eq!(read, expected, "{id}");
    }
}
