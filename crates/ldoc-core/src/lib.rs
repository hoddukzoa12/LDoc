//! The domain core of LDoc: money, statutory fees, the form a document asks
//! for, and the document it produces. Nothing here knows about the desktop
//! shell or the editor.

mod assist;
mod docs;
mod document;
mod docx;
mod fees;
mod form;
mod josa;
mod money;
mod rates;

pub use assist::{
    Candidate, FieldSpec, MaskCategory, MaskPreview, MaskSource, Masked, MaskedText, Masking,
    Personal, Pointer, ProposedAnswer, Rejection, Sensitivity, Source, TurnEnd, TurnFailure,
    TurnOutcome, TurnProposal, TurnRequest, TurnResult, mask, maskable, open_fields, outcome,
    resolve,
};
pub use docs::{CostLine, DocSummary, Draft, DraftError, catalog, draft, form};
pub use document::{Align, Block, Document};
pub use docx::to_docx;
pub use fees::{Filing, complaint_stamp, payment_order_stamp, service_fee};
pub use form::{
    Answer, Answers, ChoiceOption, Condition, Field, FieldError, FieldKind, Form, Step,
};
pub use money::Won;
