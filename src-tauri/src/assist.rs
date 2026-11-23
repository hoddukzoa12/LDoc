//! The assistant's commands. The screen never talks to the harness process.
//! How much of a pasted text is hidden is the person's setting, and the shell
//! holds it: under `Off` and `Identifiers` the screen hands over the pasted
//! text and the shell masks it and runs the turn; under `Reviewed` the screen
//! asks for a masked preview and approves it by id. The screen never says
//! how much to mask, so it cannot send a text less masked than the setting.
//! It reads back what left with `assist_sent`. In this build the harness
//! process is a replay stand-in that answers from recorded replies and calls
//! no model.

use ldoc_core::{
    Answers, FieldSpec, MaskPreview, Masked, MaskedText, Masking, Pointer, ProposedAnswer, TurnEnd,
    TurnFailure, TurnOutcome, TurnProposal, TurnRequest, TurnResult,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};
use tauri::State;
use ts_rs::TS;

/// How this build answers a turn. Replay is the only mode so far.
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AssistMode {
    Replay,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct AssistStatus {
    pub enabled: bool,
    pub signed_in: bool,
    pub models: Vec<String>,
    pub paused: Option<TurnFailure>,
    pub mode: AssistMode,
}

/// What the screen asks for. The turn kind follows from where the person is.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum TurnPlan {
    Fill { doc: String },
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct AssistRun {
    /// The id to ask `assist_sent` about.
    pub turn: String,
    /// What the text that left hid, one entry per placeholder.
    pub masked: Vec<Masked>,
    pub outcome: TurnOutcome,
}

/// One request body as it would have left the device, and the same request
/// as fields, so the screen can say in words what it held.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SentBody {
    pub to: String,
    pub body: String,
    pub request: TurnRequest,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum AssistError {
    UnknownDocument,
    /// The id is not the preview the person last saw, so it was not approved.
    NotApproved,
    /// A word the person added is one letter, which cannot be masked alone.
    WordTooShort {
        word: String,
    },
    /// The command does not go with the setting: a text goes without a
    /// preview only under `Off` or `Identifiers`, and through one only under
    /// `Reviewed`.
    MaskingMismatch {
        masking: Masking,
    },
}

/// The one masked text awaiting approval. A newer preview replaces it, and
/// running it uses it up.
struct Pending {
    text_id: String,
    doc: String,
    masked: MaskedText,
    offered: Vec<FieldSpec>,
}

#[derive(Default)]
struct Session {
    /// In memory only, so the app starts at the default each time.
    masking: Masking,
    issued: u64,
    pending: Option<Pending>,
    sent: HashMap<String, Vec<SentBody>>,
}

#[derive(Default)]
pub struct Assist(Mutex<Session>);

impl Assist {
    fn session(&self) -> std::sync::MutexGuard<'_, Session> {
        self.0.lock().expect("the assist session")
    }
}

const MODEL: &str = "replay";

#[tauri::command]
pub fn assist_status() -> AssistStatus {
    AssistStatus {
        enabled: true,
        signed_in: false,
        models: vec![MODEL.to_string()],
        paused: None,
        mode: AssistMode::Replay,
    }
}

#[tauri::command]
pub fn assist_masking(assist: State<Assist>) -> Masking {
    assist.session().masking
}

#[tauri::command]
pub fn assist_set_masking(assist: State<Assist>, masking: Masking) {
    assist.session().set_masking(masking);
}

/// Masks the text as the setting says and runs one fill turn on it.
#[tauri::command]
pub fn assist_send(
    assist: State<Assist>,
    text: String,
    doc: String,
    answers: Answers,
) -> Result<AssistRun, AssistError> {
    assist.session().send(&text, doc, &answers)
}

#[tauri::command]
pub fn assist_preview(
    assist: State<Assist>,
    text: String,
    doc: String,
    answers: Answers,
    extra_masks: Vec<String>,
) -> Result<MaskPreview, AssistError> {
    assist.session().preview(&text, doc, &answers, &extra_masks)
}

/// Sends the approved text, and only that, as one fill turn.
#[tauri::command]
pub fn assist_run(
    assist: State<Assist>,
    plan: TurnPlan,
    approved_text_id: String,
) -> Result<AssistRun, AssistError> {
    assist.session().run(plan, &approved_text_id)
}

#[tauri::command]
pub fn assist_sent(assist: State<Assist>, id: String) -> Vec<SentBody> {
    assist.session().sent.get(&id).cloned().unwrap_or_default()
}

impl Session {
    /// A preview awaiting approval was masked for the old setting, so it goes.
    fn set_masking(&mut self, masking: Masking) {
        self.masking = masking;
        self.pending = None;
    }

    /// Masks the text as the setting says and runs the turn, with no
    /// preview. Refused when the person chose to review each text.
    fn send(
        &mut self,
        text: &str,
        doc: String,
        answers: &Answers,
    ) -> Result<AssistRun, AssistError> {
        if self.masking == Masking::Reviewed {
            return Err(AssistError::MaskingMismatch {
                masking: self.masking,
            });
        }
        let form = ldoc_core::form(&doc).ok_or(AssistError::UnknownDocument)?;
        let masked = ldoc_core::mask(text, &form, answers, self.masking, &[]);
        let offered = ldoc_core::open_fields(&form, answers);
        Ok(self.turn(doc, masked, offered))
    }

    /// Masks the text and makes it the one preview awaiting approval. A word
    /// too short to mask refuses the preview and leaves the shown one pending.
    fn preview(
        &mut self,
        text: &str,
        doc: String,
        answers: &Answers,
        extra_masks: &[String],
    ) -> Result<MaskPreview, AssistError> {
        self.reviewing()?;
        let form = ldoc_core::form(&doc).ok_or(AssistError::UnknownDocument)?;
        if let Some(word) = extra_masks.iter().find(|word| !ldoc_core::maskable(word)) {
            return Err(AssistError::WordTooShort { word: word.clone() });
        }
        let masked = ldoc_core::mask(text, &form, answers, self.masking, extra_masks);
        let offered = ldoc_core::open_fields(&form, answers);
        self.issued += 1;
        let text_id = format!("text-{}", self.issued);
        let preview = masked.preview(text_id.clone());
        self.pending = Some(Pending {
            text_id,
            doc,
            masked,
            offered,
        });
        Ok(preview)
    }

    fn run(&mut self, plan: TurnPlan, approved_text_id: &str) -> Result<AssistRun, AssistError> {
        self.reviewing()?;
        let TurnPlan::Fill { doc } = plan;
        let pending = match self.pending.take() {
            Some(pending) if pending.text_id == approved_text_id && pending.doc == doc => pending,
            other => {
                self.pending = other;
                return Err(AssistError::NotApproved);
            }
        };
        Ok(self.turn(doc, pending.masked, pending.offered))
    }

    fn reviewing(&self) -> Result<(), AssistError> {
        match self.masking {
            Masking::Reviewed => Ok(()),
            masking => Err(AssistError::MaskingMismatch { masking }),
        }
    }

    /// Records the request body and runs one fill turn on the masked text.
    fn turn(&mut self, doc: String, masked: MaskedText, offered: Vec<FieldSpec>) -> AssistRun {
        self.issued += 1;
        let turn = format!("turn-{}", self.issued);
        let request = TurnRequest::Fill {
            id: turn.clone(),
            model: MODEL.to_string(),
            doc,
            text: masked.text().to_string(),
            fields: offered.clone(),
        };
        let body = serde_json::to_string(&request).expect("a turn request serializes");
        self.sent.insert(
            turn.clone(),
            vec![SentBody {
                to: "openai".to_string(),
                body,
                request: request.clone(),
            }],
        );
        let result = replay(&request);
        AssistRun {
            outcome: ldoc_core::outcome(result, &masked, &offered),
            masked: masked.found().to_vec(),
            turn,
        }
    }
}

/// What a model answered for one pasted text, written so that it reads the
/// text at every masking level: an answer finds its value by what surrounds
/// it, so a name the person masked comes back as its placeholder and a name
/// sent as written as a quote.
#[derive(Deserialize)]
struct Recording {
    /// Text that identifies the paste. It is never personal, so every level
    /// leaves it.
    anchor: String,
    answers: Vec<Recorded>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Recorded {
    /// One of the field's choices.
    Choice { field: String, option: String },
    /// What the pattern's one group finds in the text that was sent.
    Found { field: String, find: String },
}

/// A placeholder the core put in, whole: `⟦전화번호1⟧` or `{{ creditor_name }}`.
static PLACEHOLDER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:⟦[^⟧]+⟧|\{\{ \S+ \}\})$").expect("a valid pattern"));

impl Recorded {
    fn field(&self) -> &str {
        match self {
            Recorded::Choice { field, .. } | Recorded::Found { field, .. } => field,
        }
    }

    /// Points as a model would: at a placeholder by its token, at anything
    /// else by quoting it. None when the text does not hold the value.
    fn point(&self, text: &str) -> Option<ProposedAnswer> {
        let pointer = match self {
            Recorded::Choice { option, .. } => Pointer::Option {
                value: option.clone(),
            },
            Recorded::Found { find, .. } => {
                let found = Regex::new(find)
                    .expect("a valid pattern")
                    .captures(text)?
                    .get(1)?
                    .as_str()
                    .to_string();
                if PLACEHOLDER.is_match(&found) {
                    Pointer::Placeholder { token: found }
                } else {
                    Pointer::Quote { text: found }
                }
            }
        };
        Some(ProposedAnswer {
            field: self.field().to_string(),
            pointer,
        })
    }
}

const RECORDINGS: [&str; 3] = [
    include_str!("../replay/contract.json"),
    include_str!("../replay/statement.json"),
    include_str!("../replay/messages.json"),
];

/// Stands where the harness process will: it sees only the turn request, and
/// answers only the fields the request offers.
fn replay(request: &TurnRequest) -> TurnResult {
    let TurnRequest::Fill {
        id, text, fields, ..
    } = request;
    let recorded = RECORDINGS
        .iter()
        .map(|json| serde_json::from_str::<Recording>(json).expect("a valid recording"))
        .find(|recording| text.contains(&recording.anchor));
    TurnResult {
        id: id.clone(),
        end: match recorded {
            Some(recording) => TurnEnd::Proposed {
                proposal: TurnProposal::Fill {
                    answers: recording
                        .answers
                        .iter()
                        .filter(|answer| fields.iter().any(|spec| spec.id == answer.field()))
                        .filter_map(|answer| answer.point(text))
                        .collect(),
                },
            },
            None => TurnEnd::Failed {
                failure: TurnFailure::NoRecording,
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ldoc_core::{Answer, Candidate};
    use serde_json::Value;

    const DOC: &str = "payment-order-goods";

    fn fixture(id: &str) -> Value {
        fixtures()
            .into_iter()
            .find(|fixture| fixture["id"] == id)
            .unwrap()
    }

    fn fixtures() -> Vec<Value> {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../e2e/assist-fixtures.json");
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn strings(value: &Value) -> Vec<String> {
        serde_json::from_value(value.clone()).unwrap()
    }

    fn session(masking: Masking) -> Session {
        let mut session = Session::default();
        session.set_masking(masking);
        session
    }

    fn plan() -> TurnPlan {
        TurnPlan::Fill { doc: DOC.into() }
    }

    /// Runs the pasted text through the path its level takes, masking the
    /// given words when the person reviews it.
    fn run_at(masking: Masking, pasted: &str, words: &[String]) -> (AssistRun, SentBody) {
        let mut session = session(masking);
        let answers = Answers::new();
        let run = match masking {
            Masking::Reviewed => {
                let preview = session
                    .preview(pasted, DOC.into(), &answers, words)
                    .unwrap();
                session.run(plan(), &preview.text_id).unwrap()
            }
            _ => session.send(pasted, DOC.into(), &answers).unwrap(),
        };
        let sent = session.sent[&run.turn][0].clone();
        (run, sent)
    }

    /// Each candidate as the fixture writes it: the value, or why it was refused.
    fn shown(outcome: &TurnOutcome) -> Vec<(String, String)> {
        let TurnOutcome::Fill { candidates } = outcome else {
            panic!("not a fill outcome: {outcome:?}");
        };
        let mut shown: Vec<(String, String)> = candidates
            .iter()
            .map(|candidate| match candidate {
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
            })
            .collect();
        shown.sort();
        shown
    }

    #[test]
    fn the_default_is_identifiers() {
        assert_eq!(Session::default().masking, Masking::Identifiers);
    }

    #[test]
    fn sending_without_a_preview_is_refused_under_reviewed() {
        let mut session = session(Masking::Reviewed);
        assert!(matches!(
            session.send("물품공급계약서", DOC.into(), &Answers::new()),
            Err(AssistError::MaskingMismatch {
                masking: Masking::Reviewed
            })
        ));
        assert!(session.sent.is_empty());
    }

    #[test]
    fn the_preview_path_is_refused_unless_reviewed() {
        for masking in [Masking::Off, Masking::Identifiers] {
            let mut session = session(masking);
            assert!(matches!(
                session.preview("물품공급계약서", DOC.into(), &Answers::new(), &[]),
                Err(AssistError::MaskingMismatch { masking: refused }) if refused == masking
            ));
            assert!(matches!(
                session.run(plan(), "text-1"),
                Err(AssistError::MaskingMismatch { masking: refused }) if refused == masking
            ));
        }
    }

    #[test]
    fn under_off_the_sent_body_holds_the_pasted_text_unchanged() {
        let contract = fixture("contract");
        let pasted = contract["pasted"].as_str().unwrap();
        let (run, sent) = run_at(Masking::Off, pasted, &[]);
        let body: Value = serde_json::from_str(&sent.body).unwrap();
        assert_eq!(body["text"].as_str().unwrap().as_bytes(), pasted.as_bytes());
        assert!(run.masked.is_empty());
    }

    #[test]
    fn under_identifiers_no_identifier_leaves_names_do_and_the_identifier_fields_still_fill() {
        let contract = fixture("contract");
        let (run, sent) = run_at(
            Masking::Identifiers,
            contract["pasted"].as_str().unwrap(),
            &[],
        );
        for identifier in strings(&contract["identifiers"]) {
            assert!(!sent.body.contains(&identifier), "{identifier} left");
        }
        assert!(sent.body.contains("김가나"), "{}", sent.body);
        assert_eq!(run.masked.len(), 3);
        let shown = shown(&run.outcome);
        for (field, value) in [
            ("creditor_id", "110111-0000001"),
            ("creditor_phone", "02-000-0000"),
        ] {
            assert!(
                shown.contains(&(field.to_string(), value.to_string())),
                "{shown:?}"
            );
        }
    }

    #[test]
    fn changing_the_setting_drops_a_pending_preview() {
        let mut session = session(Masking::Reviewed);
        let preview = session
            .preview("물품공급계약서", DOC.into(), &Answers::new(), &[])
            .unwrap();
        session.set_masking(Masking::Identifiers);
        session.set_masking(Masking::Reviewed);
        assert!(matches!(
            session.run(plan(), &preview.text_id),
            Err(AssistError::NotApproved)
        ));
    }

    /// Every level reads the recorded reply as the fixture expects, and under
    /// `Reviewed` with the personal strings masked none of them leaves.
    #[test]
    fn each_recording_reads_as_its_fixture_expects_at_every_level() {
        for fixture in fixtures() {
            let id = fixture["id"].as_str().unwrap();
            let pii = strings(&fixture["pii"]);
            let mut expected: Vec<(String, String)> = fixture["expect"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(field, value)| (field.clone(), value.as_str().unwrap().to_string()))
                .collect();
            expected.sort();
            for masking in [Masking::Off, Masking::Identifiers, Masking::Reviewed] {
                let (run, sent) = run_at(masking, fixture["pasted"].as_str().unwrap(), &pii);
                assert_eq!(shown(&run.outcome), expected, "{id} at {masking:?}");
                if masking == Masking::Reviewed {
                    for personal in &pii {
                        assert!(
                            !sent.body.contains(personal.as_str()),
                            "{id}: {personal} left"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn every_recording_parses_and_its_patterns_compile() {
        for json in RECORDINGS {
            for answer in serde_json::from_str::<Recording>(json).unwrap().answers {
                if let Recorded::Found { find, .. } = answer {
                    Regex::new(&find).unwrap();
                }
            }
        }
    }

    #[test]
    fn an_unrecorded_text_is_a_clear_failure() {
        let mut session = Session::default();
        let run = session
            .send("처음 보는 글", DOC.into(), &Answers::new())
            .unwrap();
        assert_eq!(
            run.outcome,
            TurnOutcome::Failed {
                failure: TurnFailure::NoRecording
            }
        );
    }

    #[test]
    fn the_stand_in_answers_only_the_fields_it_is_asked() {
        let statement = fixture("statement");
        let answers: Answers = [("total".to_string(), Answer::One("10,000,000".into()))]
            .into_iter()
            .collect();
        let mut session = Session::default();
        let run = session
            .send(statement["pasted"].as_str().unwrap(), DOC.into(), &answers)
            .unwrap();
        assert!(
            shown(&run.outcome)
                .iter()
                .all(|(field, _)| field != "total"),
            "{:?}",
            run.outcome
        );
    }

    #[test]
    fn only_the_latest_preview_is_approved_and_it_carries_the_new_mask() {
        let contract = fixture("contract");
        let pasted = contract["pasted"].as_str().unwrap();
        let mut session = session(Masking::Reviewed);
        let answers = Answers::new();
        let earlier = session.preview(pasted, DOC.into(), &answers, &[]).unwrap();
        let latest = session
            .preview(pasted, DOC.into(), &answers, &["김가나".into()])
            .unwrap();
        assert!(matches!(
            session.run(plan(), &earlier.text_id),
            Err(AssistError::NotApproved)
        ));
        let run = session.run(plan(), &latest.text_id).unwrap();
        let sent = &session.sent[&run.turn];
        assert_eq!(sent.len(), 1);
        assert!(!sent[0].body.contains("김가나"), "{}", sent[0].body);
        assert!(sent[0].body.contains("⟦가린말1⟧"), "{}", sent[0].body);
    }

    #[test]
    fn a_one_letter_word_is_refused_and_the_shown_preview_stays_approvable() {
        let mut session = session(Masking::Reviewed);
        let answers = Answers::new();
        let shown = session
            .preview("물품공급계약서", DOC.into(), &answers, &[])
            .unwrap();
        assert!(matches!(
            session.preview("물품공급계약서", DOC.into(), &answers, &["김".into()]),
            Err(AssistError::WordTooShort { word }) if word == "김"
        ));
        assert!(session.run(plan(), &shown.text_id).is_ok());
    }
}
