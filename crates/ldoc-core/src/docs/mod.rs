//! The documents LDoc can draft. Each one is a form and a function from the
//! answers to a finished draft.

mod payment_order_goods;

use crate::document::Document;
use crate::form::{Answers, FieldError, Form};
use crate::money::Won;
use serde::Serialize;
use ts_rs::TS;

struct DocKind {
    id: &'static str,
    title: &'static str,
    category: &'static str,
    form: fn() -> Form,
    draft: fn(&Answers) -> Result<Draft, Vec<FieldError>>,
}

const KINDS: &[DocKind] = &[payment_order_goods::KIND];

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct DocSummary {
    pub id: String,
    pub title: String,
    pub category: String,
}

/// What drafting produces: the document, what filing it costs, and what the
/// person should know before using it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct Draft {
    pub document: Document,
    pub costs: Vec<CostLine>,
    pub notices: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CostLine {
    pub label: String,
    #[ts(type = "number")]
    pub amount: Won,
    /// How the amount was worked out, in words.
    pub basis: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum DraftError {
    UnknownDocument,
    InvalidFields { errors: Vec<FieldError> },
}

fn kind(id: &str) -> Option<&'static DocKind> {
    KINDS.iter().find(|kind| kind.id == id)
}

pub fn catalog() -> Vec<DocSummary> {
    KINDS
        .iter()
        .map(|kind| DocSummary {
            id: kind.id.to_string(),
            title: kind.title.to_string(),
            category: kind.category.to_string(),
        })
        .collect()
}

pub fn form(id: &str) -> Option<Form> {
    kind(id).map(|kind| (kind.form)())
}

pub fn draft(id: &str, answers: &Answers) -> Result<Draft, DraftError> {
    let kind = kind(id).ok_or(DraftError::UnknownDocument)?;
    (kind.draft)(answers).map_err(|errors| DraftError::InvalidFields { errors })
}
