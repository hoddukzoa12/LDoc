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
    let form = ldoc_core::form(&doc).ok_or(AssistError::UnknownDocument)?;
    let masked = ldoc_core::mask(&text, &form, &answers, &extra_masks);
    let offered = ldoc_core::open_fields(&form, &answers);
    let mut session = assist.0.lock().expect("the assist session");
    session.issued += 1;
    let text_id = format!("text-{}", session.issued);
    let preview = masked.preview(text_id.clone());
    session.pending = Some(Pending {
        text_id,
        doc,
        masked,
        offered,
    });
    Ok(preview)
}

/// Sends the approved text, and only that, as one fill turn.
#[tauri::command]
pub fn assist_run(
    assist: State<Assist>,
    plan: TurnPlan,
    approved_text_id: String,
) -> Result<AssistRun, AssistError> {
    let mut session = assist.0.lock().expect("the assist session");
    let TurnPlan::Fill { doc } = plan;
    let pending = match session.pending.take() {
        Some(pending) if pending.text_id == approved_text_id && pending.doc == doc => pending,
        other => {
            session.pending = other;
            return Err(AssistError::NotApproved);
        }
    };
    session.issued += 1;
    let turn = format!("turn-{}", session.issued);
    let request = TurnRequest::Fill {
        id: turn.clone(),
        model: MODEL.to_string(),
        doc,
        text: pending.masked.text().to_string(),
        fields: pending.offered.clone(),
    };
    let body = serde_json::to_string(&request).expect("a turn request serializes");
    session.sent.insert(
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
