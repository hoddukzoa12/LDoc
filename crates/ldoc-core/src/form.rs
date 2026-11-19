//! The questions a document asks, and the reader that turns the raw answers
//! into typed values.

use crate::money::Won;
use jiff::civil::Date;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct Form {
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct Step {
    pub title: String,
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct Field {
    pub id: String,
    pub label: String,
    pub help: Option<String>,
    pub kind: FieldKind,
    pub required: bool,
    /// The field is asked only while this holds. `None` means always.
    pub show_when: Option<Condition>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum FieldKind {
    Text,
    LongText,
    Money,
    Date,
    Choice { options: Vec<ChoiceOption> },
    MultiChoice { options: Vec<ChoiceOption> },
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ChoiceOption {
    pub value: String,
    pub label: String,
}

/// Holds when the answer to `field` is, or includes, one of `is_one_of`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct Condition {
    pub field: String,
    pub is_one_of: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum Answer {
    One(String),
    Many(Vec<String>),
}

/// Raw answers keyed by field id, exactly as the form collected them.
pub type Answers = BTreeMap<String, Answer>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

impl Field {
    fn new(id: &str, label: &str, kind: FieldKind) -> Field {
        Field {
            id: id.to_string(),
            label: label.to_string(),
            help: None,
            kind,
            required: true,
            show_when: None,
        }
    }

    pub fn text(id: &str, label: &str) -> Field {
        Field::new(id, label, FieldKind::Text)
    }

    pub fn money(id: &str, label: &str) -> Field {
        Field::new(id, label, FieldKind::Money)
    }

    pub fn date(id: &str, label: &str) -> Field {
        Field::new(id, label, FieldKind::Date)
    }

    pub fn choice<T>(id: &str, label: &str, choices: Choices<T>) -> Field {
        Field::new(
            id,
            label,
            FieldKind::Choice {
                options: options(choices),
            },
        )
    }

    pub fn multi_choice<T>(id: &str, label: &str, choices: Choices<T>) -> Field {
        Field::new(
            id,
            label,
            FieldKind::MultiChoice {
                options: options(choices),
            },
        )
    }

    pub fn optional(mut self) -> Field {
        self.required = false;
        self
    }

    pub fn help(mut self, help: &str) -> Field {
        self.help = Some(help.to_string());
        self
    }

    pub fn show_when(mut self, field: &str, is_one_of: &[&str]) -> Field {
        self.show_when = Some(Condition {
            field: field.to_string(),
            is_one_of: is_one_of.iter().map(|value| value.to_string()).collect(),
        });
        self
    }
}

/// The options of one choice field: the stored key, the label shown, and the
/// value the key stands for. The form and the reader both work from this, so
/// a key cannot be offered without being understood.
pub type Choices<T> = &'static [(&'static str, &'static str, T)];

fn options<T>(choices: Choices<T>) -> Vec<ChoiceOption> {
    choices
        .iter()
        .map(|(value, label, _)| ChoiceOption {
            value: value.to_string(),
            label: label.to_string(),
        })
        .collect()
}

const REQUIRED: &str = "필수 항목입니다.";

/// Reads typed values out of raw answers and collects every problem instead
/// of stopping at the first, so the form can mark all of them at once.
pub struct Reader<'a> {
    answers: &'a Answers,
    errors: Vec<FieldError>,
}

impl<'a> Reader<'a> {
    pub fn new(answers: &'a Answers) -> Self {
        Reader {
            answers,
            errors: Vec::new(),
        }
    }

    pub fn fail(&mut self, field: &str, message: &str) {
        self.errors.push(FieldError {
            field: field.to_string(),
            message: message.to_string(),
        });
    }

    fn one(&self, field: &str) -> Option<&'a str> {
        match self.answers.get(field)? {
            Answer::One(text) => Some(text.trim()).filter(|text| !text.is_empty()),
            Answer::Many(_) => None,
        }
    }

    fn require<T>(&mut self, field: &str, value: Option<T>) -> Option<T> {
        if value.is_none() && !self.errors.iter().any(|error| error.field == field) {
            self.fail(field, REQUIRED);
        }
        value
    }

    pub fn optional_text(&mut self, field: &str) -> Option<String> {
        self.one(field).map(str::to_string)
    }

    pub fn text(&mut self, field: &str) -> Option<String> {
        let value = self.optional_text(field);
        self.require(field, value)
    }

    pub fn optional_money(&mut self, field: &str) -> Option<Won> {
        let text = self.one(field)?;
        let amount = Won::parse(text);
        if amount.is_none() {
            self.fail(
                field,
                "금액은 숫자로 적어 주세요. 쉼표는 세 자리마다 찍습니다. 예: 7,000,000",
            );
        }
        amount
    }

    pub fn money(&mut self, field: &str) -> Option<Won> {
        let value = self.optional_money(field);
        self.require(field, value)
    }

    pub fn optional_date(&mut self, field: &str) -> Option<Date> {
        let text = self.one(field)?;
        let day = text.parse().ok();
        if day.is_none() {
            self.fail(field, "날짜 형식이 올바르지 않습니다.");
        }
        day
    }

    pub fn date(&mut self, field: &str) -> Option<Date> {
        let value = self.optional_date(field);
        self.require(field, value)
    }

    pub fn choice<T: Copy>(&mut self, field: &str, choices: Choices<T>) -> Option<T> {
        let value = self.one(field).and_then(|key| lookup(choices, key));
        self.require(field, value)
    }

    /// The selected values, in the order the choices are declared.
    pub fn choices<T: Copy>(&mut self, field: &str, choices: Choices<T>) -> Vec<T> {
        let selected: &[String] = match self.answers.get(field) {
            Some(Answer::Many(keys)) => keys,
            _ => &[],
        };
        choices
            .iter()
            .filter(|(key, _, _)| selected.iter().any(|picked| picked == key))
            .map(|(_, _, value)| *value)
            .collect()
    }

    /// The value when nothing went wrong, otherwise every problem found.
    pub fn finish<T>(mut self, value: Option<T>) -> Result<T, Vec<FieldError>> {
        match value {
            Some(value) if self.errors.is_empty() => Ok(value),
            _ => {
                if self.errors.is_empty() {
                    self.fail("", "입력을 읽지 못했습니다.");
                }
                Err(self.errors)
            }
        }
    }
}

fn lookup<T: Copy>(choices: Choices<T>, key: &str) -> Option<T> {
    choices
        .iter()
        .find(|(candidate, _, _)| *candidate == key)
        .map(|(_, _, value)| *value)
}
