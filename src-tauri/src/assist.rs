//! The assistant's commands. The screen never talks to the harness process:
//! it asks for a masked preview, approves it by id, and reads back what left.
//! In this build the harness process is a replay stand-in that answers from
//! recorded results and calls no model.

use ldoc_core::{
    Answers, FieldSpec, MaskPreview, MaskedText, TurnEnd, TurnFailure, TurnOutcome, TurnRequest,
    TurnResult,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};
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
    issued: u64,
    pending: Option<Pending>,
    sent: HashMap<String, Vec<SentBody>>,
}

#[derive(Default)]
pub struct Assist(Mutex<Session>);

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
pub fn assist_preview(
    assist: State<Assist>,
    text: String,
    doc: String,
    answers: Answers,
    extra_masks: Vec<String>,
) -> Result<MaskPreview, AssistError> {
    assist
        .0
        .lock()
        .expect("the assist session")
        .preview(&text, doc, &answers, &extra_masks)
}

/// Sends the approved text, and only that, as one fill turn.
#[tauri::command]
pub fn assist_run(
    assist: State<Assist>,
    plan: TurnPlan,
    approved_text_id: String,
) -> Result<AssistRun, AssistError> {
    assist
        .0
        .lock()
        .expect("the assist session")
        .run(plan, &approved_text_id)
}

impl Session {
    /// Masks the text and makes it the one preview awaiting approval. A word
    /// too short to mask refuses the preview and leaves the shown one pending.
    fn preview(
        &mut self,
        text: &str,
        doc: String,
        answers: &Answers,
        extra_masks: &[String],
    ) -> Result<MaskPreview, AssistError> {
        let form = ldoc_core::form(&doc).ok_or(AssistError::UnknownDocument)?;
        if let Some(word) = extra_masks.iter().find(|word| !ldoc_core::maskable(word)) {
            return Err(AssistError::WordTooShort { word: word.clone() });
        }
        let masked = ldoc_core::mask(text, &form, answers, extra_masks);
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
        let TurnPlan::Fill { doc } = plan;
        let pending = match self.pending.take() {
            Some(pending) if pending.text_id == approved_text_id && pending.doc == doc => pending,
            other => {
                self.pending = other;
                return Err(AssistError::NotApproved);
            }
        };
        self.issued += 1;
        let turn = format!("turn-{}", self.issued);
        let request = TurnRequest::Fill {
            id: turn.clone(),
            model: MODEL.to_string(),
            doc,
            text: pending.masked.text().to_string(),
            fields: pending.offered.clone(),
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
        Ok(AssistRun {
            outcome: ldoc_core::outcome(result, &pending.masked, &pending.offered),
            turn,
        })
    }
}

#[tauri::command]
pub fn assist_sent(assist: State<Assist>, id: String) -> Vec<SentBody> {
    let session = assist.0.lock().expect("the assist session");
    session.sent.get(&id).cloned().unwrap_or_default()
}

/// A recorded turn result, and the text that identifies the paste it was
/// recorded for. The anchor is never personal, so it survives masking.
#[derive(Deserialize)]
struct Recording {
    anchor: String,
    result: TurnResult,
}

const RECORDINGS: [&str; 3] = [
    include_str!("../replay/contract.json"),
    include_str!("../replay/statement.json"),
    include_str!("../replay/messages.json"),
];

/// Stands where the harness process will: it sees only the turn request.
fn replay(request: &TurnRequest) -> TurnResult {
    let TurnRequest::Fill { id, text, .. } = request;
    let recorded = RECORDINGS
        .iter()
        .map(|json| serde_json::from_str::<Recording>(json).expect("a valid recording"))
        .find(|recording| text.contains(&recording.anchor));
    TurnResult {
        id: id.clone(),
        end: match recorded {
            Some(recording) => recording.result.end,
            None => TurnEnd::Failed {
                failure: TurnFailure::NoRecording,
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ldoc_core::Candidate;

    fn fill(text: &str) -> TurnRequest {
        TurnRequest::Fill {
            id: "turn-1".into(),
            model: MODEL.into(),
            doc: "payment-order-goods".into(),
            text: text.into(),
            fields: Vec::new(),
        }
    }

    #[test]
    fn every_recording_parses() {
        for json in RECORDINGS {
            serde_json::from_str::<Recording>(json).unwrap();
        }
    }

    #[test]
    fn an_unrecorded_text_is_a_clear_failure() {
        assert_eq!(
            replay(&fill("처음 보는 글")).end,
            TurnEnd::Failed {
                failure: TurnFailure::NoRecording
            }
        );
    }

    #[test]
    fn a_recorded_text_gets_its_recorded_proposal_under_this_turn() {
        let result = replay(&fill("거래명세서\n합계: 1,000만 원"));
        assert_eq!(result.id, "turn-1");
        assert!(matches!(result.end, TurnEnd::Proposed { .. }));
    }

    const DOC: &str = "payment-order-goods";
    const CONTRACT: &str = "물품공급계약서\n공급자 주식회사 가나푸드 (대표이사 김가나)";

    fn plan() -> TurnPlan {
        TurnPlan::Fill { doc: DOC.into() }
    }

    #[test]
    fn only_the_latest_preview_is_approved_and_it_carries_the_new_mask() {
        let mut session = Session::default();
        let answers = Answers::new();
        let earlier = session
            .preview(CONTRACT, DOC.into(), &answers, &[])
            .unwrap();
        let latest = session
            .preview(CONTRACT, DOC.into(), &answers, &["김가나".into()])
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
        let mut session = Session::default();
        let answers = Answers::new();
        let shown = session
            .preview(CONTRACT, DOC.into(), &answers, &[])
            .unwrap();
        assert!(matches!(
            session.preview(CONTRACT, DOC.into(), &answers, &["김".into()]),
            Err(AssistError::WordTooShort { word }) if word == "김"
        ));
        assert!(session.run(plan(), &shown.text_id).is_ok());
    }

    #[test]
    fn candidates_are_read_by_the_core() {
        let form = ldoc_core::form("payment-order-goods").unwrap();
        let answers = Answers::new();
        let masked = ldoc_core::mask("거래명세서\n합계: 1,000만 원", &form, &answers, &[]);
        let offered = ldoc_core::open_fields(&form, &answers);
        let TurnOutcome::Fill { candidates } =
            ldoc_core::outcome(replay(&fill(masked.text())), &masked, &offered)
        else {
            panic!("not a fill outcome");
        };
        assert!(candidates.iter().any(|candidate| matches!(
            candidate,
            Candidate::Rejected { field, .. } if field == "total"
        )));
    }
}
