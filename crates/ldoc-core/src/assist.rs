//! The first piece of the AI assistant: filling the form from pasted text.
//! The core masks the text before anything leaves the device and reads the
//! values a model points at. It knows nothing of models, networks or the
//! harness process. Types follow docs/harness-sketch.ts.

use crate::form::{Answer, Answers, Field, FieldKind, Form, parse_date};
use crate::money::Won;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::LazyLock;
use ts_rs::TS;

/// Whether a field's answer may go to a model. A `pii` answer never does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Sensitivity {
    Public,
    Pii,
}

/// A field's answer is personal when this holds a category: what the
/// answer is when it turns up in pasted text. It serializes as the
/// `Sensitivity` alone, so the category never reaches the screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Personal(pub Option<MaskCategory>);

impl Personal {
    pub fn sensitivity(self) -> Sensitivity {
        match self.0 {
            Some(_) => Sensitivity::Pii,
            None => Sensitivity::Public,
        }
    }
}

impl Serialize for Personal {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.sensitivity().serialize(serializer)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MaskCategory {
    Person,
    Organization,
    ResidentNo,
    CorporateNo,
    BusinessNo,
    Phone,
    Address,
    Account,
    Plate,
    /// A word the person masked, whatever it is.
    Other,
}

impl MaskCategory {
    fn label(self) -> &'static str {
        match self {
            MaskCategory::Person => "인물",
            MaskCategory::Organization => "단체",
            MaskCategory::ResidentNo => "주민등록번호",
            MaskCategory::CorporateNo => "법인등록번호",
            MaskCategory::BusinessNo => "사업자등록번호",
            MaskCategory::Phone => "전화번호",
            MaskCategory::Address => "주소",
            MaskCategory::Account => "계좌번호",
            MaskCategory::Plate => "차량번호",
            MaskCategory::Other => "가린말",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MaskSource {
    /// A value already in a personal answer of the form.
    Answers,
    /// An identifier recognised by its shape.
    Pattern,
    /// A word the person chose to mask.
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Masked {
    pub placeholder: String,
    pub category: MaskCategory,
    pub by: MaskSource,
}

/// What the screen shows before the person approves a text.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct MaskPreview {
    pub text_id: String,
    pub masked: String,
    pub found: Vec<Masked>,
}

/// A pasted text with its personal parts replaced by placeholders. The
/// originals behind the placeholders stay here: this type does not
/// serialize, so they cannot cross a boundary by accident.
#[derive(Debug, Clone)]
pub struct MaskedText {
    text: String,
    found: Vec<Masked>,
    originals: BTreeMap<String, String>,
}

impl MaskedText {
    /// The text that may leave the device once approved.
    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn preview(&self, text_id: String) -> MaskPreview {
        MaskPreview {
            text_id,
            masked: self.text.clone(),
            found: self.found.clone(),
        }
    }

    /// Puts the originals back, for showing a quote to the person who wrote it.
    fn restore(&self, text: &str) -> String {
        self.originals
            .iter()
            .fold(text.to_string(), |text, (placeholder, original)| {
                text.replace(placeholder.as_str(), original)
            })
    }
}

const COMPANY: &str = r"(?:주식회사|\(\s*주\s*\)|㈜)";

static COMPANY_FORM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(COMPANY).expect("a valid pattern"));

/// `(주)가나푸드`, `㈜ 가나 푸드` and `가나푸드 주식회사` all name 주식회사 가나푸드.
fn spelling_free(value: &str) -> String {
    COMPANY_FORM
        .replace_all(value, "")
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect()
}

/// Finds `value` however it is spaced and whichever company form it carries.
fn spellings_of(value: &str) -> Option<Regex> {
    let bare = spelling_free(value);
    if bare.chars().count() < 2 {
        return None;
    }
    let body: Vec<String> = bare
        .chars()
        .map(|c| regex::escape(&c.to_string()))
        .collect();
    let body = body.join(r"\s*");
    Regex::new(&format!(r"(?:{COMPANY}\s*)?{body}(?:\s*{COMPANY})?")).ok()
}

/// Digits joined by hyphens or dots: one candidate identifier.
static NUMBER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d+(?:[-.]\d+)*").expect("a valid pattern"));

static PLATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)?\d{2,3}[가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호육해공국합]\s?\d{4}",
    )
    .expect("a valid pattern")
});

/// What a run of digits is, by the lengths of its groups. Dates, amounts and
/// short numbers are none of these.
fn classify_number(number: &str) -> Option<MaskCategory> {
    let groups: Vec<&str> = number.split(['-', '.']).collect();
    let lengths: Vec<usize> = groups.iter().map(|group| group.len()).collect();
    let digits: usize = lengths.iter().sum();
    let all: String = groups.concat();
    let starts_with_zero = all.starts_with('0');
    match lengths.as_slice() {
        [6, 7] | [13] => Some(if looks_like_birth(&all) {
            MaskCategory::ResidentNo
        } else {
            MaskCategory::CorporateNo
        }),
        [3, 2, 5] => Some(MaskCategory::BusinessNo),
        [2 | 3, 3 | 4, 4] if starts_with_zero => Some(MaskCategory::Phone),
        [10 | 11] if all.starts_with("01") => Some(MaskCategory::Phone),
        _ if groups.len() >= 2 && (10..=14).contains(&digits) => Some(MaskCategory::Account),
        [10..=14] => Some(MaskCategory::Account),
        _ => None,
    }
}

/// A resident registration number opens with a birth date and a digit for
/// sex and century. A corporate registration number does not.
fn looks_like_birth(digits: &str) -> bool {
    let two = |at: usize| digits[at..at + 2].parse::<u8>().unwrap_or(0);
    let marker = digits.as_bytes()[6];
    (1..=12).contains(&two(2)) && (1..=31).contains(&two(4)) && (b'1'..=b'8').contains(&marker)
}

struct Span {
    start: usize,
    end: usize,
    category: MaskCategory,
    by: MaskSource,
    /// The answer field the span repeats, for answer spans.
    field: Option<String>,
}

/// Masks personal answers already given, identifiers recognised by shape,
/// and the words the person chose. An answer's value becomes its field's
/// placeholder, `{{ creditor_name }}`; anything else becomes a numbered
/// placeholder such as `⟦전화번호1⟧`, the same one each time it recurs.
pub fn mask(text: &str, form: &Form, answers: &Answers, extra: &[String]) -> MaskedText {
    let mut spans = Vec::new();

    for field in form.steps.iter().flat_map(|step| &step.fields) {
        let (Some(category), Some(Answer::One(value))) = (field.pii.0, answers.get(&field.id))
        else {
            continue;
        };
        let category = refine(category, value);
        for found in spellings_of(value)
            .iter()
            .flat_map(|regex| regex.find_iter(text))
        {
            spans.push(Span {
                start: found.start(),
                end: found.end(),
                category,
                by: MaskSource::Answers,
                field: Some(field.id.clone()),
            });
        }
    }
    for found in PLATE.find_iter(text) {
        spans.push(pattern(found.start(), found.end(), MaskCategory::Plate));
    }
    for found in NUMBER.find_iter(text) {
        if let Some(category) = classify_number(found.as_str()) {
            spans.push(pattern(found.start(), found.end(), category));
        }
    }
    for word in extra {
        for found in spellings_of(word)
            .iter()
            .flat_map(|regex| regex.find_iter(text))
        {
            spans.push(Span {
                start: found.start(),
                end: found.end(),
                category: MaskCategory::Other,
                by: MaskSource::User,
                field: None,
            });
        }
    }

    // Earliest first, then the longest, then answers before patterns before
    // the person's words. A span inside one already taken is dropped.
    spans.sort_by_key(|span| {
        (
            span.start,
            std::cmp::Reverse(span.end),
            source_rank(span.by),
        )
    });
    let mut masked = String::with_capacity(text.len());
    let mut found: Vec<Masked> = Vec::new();
    let mut originals = BTreeMap::new();
    let mut placeholders: BTreeMap<(MaskCategory, String), String> = BTreeMap::new();
    let mut counts: BTreeMap<MaskCategory, usize> = BTreeMap::new();
    let mut at = 0;
    for span in spans {
        if span.start < at {
            continue;
        }
        let original = &text[span.start..span.end];
        let placeholder = match &span.field {
            Some(field) => format!("{{{{ {field} }}}}"),
            None => placeholders
                .entry((span.category, spelling_free(original)))
                .or_insert_with(|| {
                    let count = counts.entry(span.category).or_default();
                    *count += 1;
                    format!("⟦{}{count}⟧", span.category.label())
                })
                .clone(),
        };
        masked.push_str(&text[at..span.start]);
        masked.push_str(&placeholder);
        at = span.end;
        if !found.iter().any(|entry| entry.placeholder == placeholder) {
            found.push(Masked {
                placeholder: placeholder.clone(),
                category: span.category,
                by: span.by,
            });
        }
        originals
            .entry(placeholder)
            .or_insert_with(|| original.to_string());
    }
    masked.push_str(&text[at..]);

    MaskedText {
        text: masked,
        found,
        originals,
    }
}

fn pattern(start: usize, end: usize, category: MaskCategory) -> Span {
    Span {
        start,
        end,
        category,
        by: MaskSource::Pattern,
        field: None,
    }
}

fn source_rank(by: MaskSource) -> u8 {
    match by {
        MaskSource::Answers => 0,
        MaskSource::Pattern => 1,
        MaskSource::User => 2,
    }
}

/// A name field holds a company as often as a person, and an identifier
/// field holds whichever number the party has.
fn refine(category: MaskCategory, value: &str) -> MaskCategory {
    match category {
        MaskCategory::Person if COMPANY_FORM.is_match(value) => MaskCategory::Organization,
        MaskCategory::ResidentNo => classify_number(value.trim()).unwrap_or(category),
        _ => category,
    }
}

/// A field as a model may see it: what is asked, never an answer. A
/// personal field goes out as its label alone, without its help.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct FieldSpec {
    pub id: String,
    pub label: String,
    pub help: Option<String>,
    pub kind: FieldKind,
    pub sensitivity: Sensitivity,
}

impl From<&Field> for FieldSpec {
    fn from(field: &Field) -> FieldSpec {
        let sensitivity = field.pii.sensitivity();
        FieldSpec {
            id: field.id.clone(),
            label: field.label.clone(),
            help: field
                .help
                .clone()
                .filter(|_| sensitivity == Sensitivity::Public),
            kind: field.kind.clone(),
            sensitivity,
        }
    }
}

/// The fields with no answer yet that the form shows now, or hides only
/// behind a choice it shows now and the person has not made. One paste can
/// then answer 공급일 before 거래 형태 is chosen; its candidate waits until
/// the choice shows the field. A field the person's choice hides is not
/// offered.
pub fn open_fields(form: &Form, answers: &Answers) -> Vec<FieldSpec> {
    let answered = |id: &str| match answers.get(id) {
        Some(Answer::One(text)) => !text.trim().is_empty(),
        Some(Answer::Many(values)) => !values.is_empty(),
        None => false,
    };
    let fields: Vec<&Field> = form.steps.iter().flat_map(|step| &step.fields).collect();
    let shown = |id: &str| {
        fields
            .iter()
            .any(|field| field.id == id && field.is_shown(answers))
    };
    let may_be_asked = |field: &Field| {
        field.is_shown(answers)
            || field
                .show_when
                .as_ref()
                .is_some_and(|condition| !answered(&condition.field) && shown(&condition.field))
    };
    fields
        .iter()
        .filter(|field| may_be_asked(field) && !answered(&field.id))
        .map(|field| FieldSpec::from(*field))
        .collect()
}

/// Where a model says an answer is. There is no way to write a value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "by", rename_all = "snake_case")]
#[ts(export)]
pub enum Pointer {
    /// One of the field's choices.
    Option { value: String },
    /// Part of the approved masked text that states a whole value there
    /// exactly once. See `states_whole_value`.
    Quote { text: String },
    /// A masked name or number itself.
    Placeholder { token: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProposedAnswer {
    pub field: String,
    pub pointer: Pointer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Rejection {
    FieldNotOffered,
    NotAChoice,
    QuoteNotInText,
    QuoteAmbiguous,
    /// The source is cut from a longer figure, or is an amount without 원.
    NotWholeValue,
    ValueUnreadable,
}

/// A proposed answer after the core read it. A readable one waits beside
/// its field until the person accepts it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
#[ts(export)]
pub enum Candidate {
    Readable {
        field: String,
        value: Answer,
        /// The source as the person wrote it, placeholders restored.
        quoted: String,
    },
    Rejected {
        field: String,
        reason: Rejection,
    },
}

/// Reads each pointer against the approved text with the parsing the form
/// uses. A pointer the core cannot read becomes a rejection, never a value.
pub fn resolve(
    masked: &MaskedText,
    offered: &[FieldSpec],
    proposed: &[ProposedAnswer],
) -> Vec<Candidate> {
    proposed
        .iter()
        .map(|answer| {
            let field = answer.field.clone();
            match read(masked, offered, answer) {
                Ok((value, quoted)) => Candidate::Readable {
                    field,
                    value,
                    quoted,
                },
                Err(reason) => Candidate::Rejected { field, reason },
            }
        })
        .collect()
}

fn read(
    masked: &MaskedText,
    offered: &[FieldSpec],
    answer: &ProposedAnswer,
) -> Result<(Answer, String), Rejection> {
    let spec = offered
        .iter()
        .find(|spec| spec.id == answer.field)
        .ok_or(Rejection::FieldNotOffered)?;
    let source = match &answer.pointer {
        Pointer::Option { value } => {
            let options = options(&spec.kind).ok_or(Rejection::NotAChoice)?;
            let option = options
                .iter()
                .find(|option| option.value == *value)
                .ok_or(Rejection::NotAChoice)?;
            return Ok((
                choice_answer(&spec.kind, &option.value),
                option.label.clone(),
            ));
        }
        Pointer::Quote { text } => {
            if text.trim().is_empty() {
                return Err(Rejection::QuoteNotInText);
            }
            let places: Vec<usize> = masked
                .text
                .match_indices(text.as_str())
                .map(|(start, _)| start)
                .collect();
            let whole = places
                .iter()
                .filter(|&&start| {
                    let (before, after) =
                        (&masked.text[..start], &masked.text[start + text.len()..]);
                    states_whole_value(&spec.kind, before, text, after)
                })
                .count();
            match (places.len(), whole) {
                (0, _) => return Err(Rejection::QuoteNotInText),
                (_, 0) => return Err(Rejection::NotWholeValue),
                (_, 1) => {}
                _ => return Err(Rejection::QuoteAmbiguous),
            }
            masked.restore(text)
        }
        Pointer::Placeholder { token } => {
            let original = masked
                .originals
                .get(token)
                .ok_or(Rejection::QuoteNotInText)?;
            if !states_whole_value(&spec.kind, "", original, "") {
                return Err(Rejection::NotWholeValue);
            }
            original.clone()
        }
    };
    let value = value_of(&spec.kind, &source).ok_or(Rejection::ValueUnreadable)?;
    Ok((value, source))
}

/// A figure that goes on before the source: a digit, a comma or point right
/// after a digit, or a digit and 만, 억 or 조 (`1억 2,000원`).
static FIGURE_BEFORE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:\d[,.]?|\d\s*[만억조]\s*)$").expect("a valid pattern"));

/// A figure that goes on after the source: a digit, or a comma or point
/// and a digit.
static FIGURE_AFTER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[,.]?\d").expect("a valid pattern"));

/// The rule for every value the core reads out of text: the source is the
/// whole value the text states. The text right before and after it does not
/// go on with the same figure, so `7,000,000원` cut from `17,000,000원` or
/// `2026. 3. 3` cut from `2026. 3. 31.` is refused. An amount names its
/// unit, so a figure counted in 천원, 달러 or 박스 is never read as won.
/// Only an occurrence that keeps this rule counts as the quote's one place.
fn states_whole_value(kind: &FieldKind, before: &str, source: &str, after: &str) -> bool {
    let unit_named = !matches!(kind, FieldKind::Money) || source.trim_end().ends_with('원');
    unit_named && !FIGURE_BEFORE.is_match(before) && !FIGURE_AFTER.is_match(after)
}

fn options(kind: &FieldKind) -> Option<&[crate::form::ChoiceOption]> {
    match kind {
        FieldKind::Choice { options } | FieldKind::MultiChoice { options } => Some(options),
        _ => None,
    }
}

fn choice_answer(kind: &FieldKind, value: &str) -> Answer {
    match kind {
        FieldKind::MultiChoice { .. } => Answer::Many(vec![value.to_string()]),
        _ => Answer::One(value.to_string()),
    }
}

/// The answer a quote gives a field, read as the form reads that kind.
fn value_of(kind: &FieldKind, source: &str) -> Option<Answer> {
    let source = source.trim();
    let one = |text: String| Some(Answer::One(text));
    match kind {
        FieldKind::Money => one(Won::parse(source)?.with_commas()),
        FieldKind::Date => one(parse_date(source)?.to_string()),
        FieldKind::Text if !source.is_empty() && !source.contains('\n') => one(source.to_string()),
        FieldKind::LongText if !source.is_empty() => one(source.to_string()),
        FieldKind::Choice { options } | FieldKind::MultiChoice { options } => options
            .iter()
            .find(|option| option.label == source)
            .map(|option| choice_answer(kind, &option.value)),
        FieldKind::Text | FieldKind::LongText => None,
    }
}

/// What the harness process is asked to do: one turn, one request. Only the
/// masked text and the open fields go in.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TurnRequest {
    Fill {
        id: String,
        model: String,
        doc: String,
        text: String,
        fields: Vec<FieldSpec>,
    },
}

/// The arguments a model gave its closing tool. Nothing is accepted yet.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TurnProposal {
    Fill { answers: Vec<ProposedAnswer> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "why", rename_all = "snake_case")]
#[ts(export)]
pub enum TurnFailure {
    /// The replay stand-in has no recorded result for this text.
    NoRecording,
}

/// What the harness process returns for one turn.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct TurnResult {
    pub id: String,
    #[serde(flatten)]
    pub end: TurnEnd,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum TurnEnd {
    Proposed { proposal: TurnProposal },
    Failed { failure: TurnFailure },
}

/// What the screen sees of a turn, after the core checked it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum TurnOutcome {
    Fill { candidates: Vec<Candidate> },
    Failed { failure: TurnFailure },
}

pub fn outcome(result: TurnResult, masked: &MaskedText, offered: &[FieldSpec]) -> TurnOutcome {
    match result.end {
        TurnEnd::Proposed {
            proposal: TurnProposal::Fill { answers },
        } => TurnOutcome::Fill {
            candidates: resolve(masked, offered, &answers),
        },
        TurnEnd::Failed { failure } => TurnOutcome::Failed { failure },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::form::{ChoiceOption, Step};

    fn form() -> Form {
        let choice = FieldKind::Choice {
            options: vec![
                ChoiceOption {
                    value: "included".into(),
                    label: "대금에 포함".into(),
                },
                ChoiceOption {
                    value: "none".into(),
                    label: "해당 없음".into(),
                },
            ],
        };
        let mut vat = Field::text("vat", "부가가치세");
        vat.kind = choice;
        Form {
            steps: vec![Step {
                title: "거래".into(),
                fields: vec![
                    Field::text("creditor_name", "채권자 이름").pii(MaskCategory::Person),
                    Field::text("creditor_id", "번호")
                        .pii(MaskCategory::ResidentNo)
                        .help("법인은 법인등록번호"),
                    Field::text("goods", "품목"),
                    Field::money("total", "대금 총액").help("계약서의 총액"),
                    Field::date("due_on", "지급기일"),
                    vat,
                    Field::date("supplied_on", "공급일").show_when("vat", &["none"]),
                ],
            }],
        }
    }

    fn answers(pairs: &[(&str, &str)]) -> Answers {
        pairs
            .iter()
            .map(|(field, value)| (field.to_string(), Answer::One(value.to_string())))
            .collect()
    }

    fn masked(text: &str) -> MaskedText {
        mask(text, &form(), &Answers::new(), &[])
    }

    #[test]
    fn identifiers_are_masked_by_their_shape() {
        let cases = [
            ("주민번호 900101-1234567", "주민번호 ⟦주민등록번호1⟧"),
            ("법인번호 110111-0000001", "법인번호 ⟦법인등록번호1⟧"),
            ("사업자 123-45-67890", "사업자 ⟦사업자등록번호1⟧"),
            ("휴대폰 010-1234-5678", "휴대폰 ⟦전화번호1⟧"),
            ("사무실 02-000-0000", "사무실 ⟦전화번호1⟧"),
            ("계좌 110-123-456789", "계좌 ⟦계좌번호1⟧"),
            ("차량 12가3456", "차량 ⟦차량번호1⟧"),
            ("차량 서울 123나 4567", "차량 서울 ⟦차량번호1⟧"),
        ];
        for (text, expected) in cases {
            assert_eq!(masked(text).text(), expected, "{text:?}");
        }
    }

    #[test]
    fn dates_and_amounts_are_not_identifiers() {
        let text = "2026-03-02에 10,000,000원, 2026. 3. 31.까지 3,000,000원";
        assert_eq!(masked(text).text(), text);
    }

    #[test]
    fn a_personal_answer_is_masked_however_the_text_spells_it() {
        let given = answers(&[
            ("creditor_name", "주식회사 가나푸드"),
            ("goods", "냉동 수산물"),
        ]);
        let text = "(주)가나푸드, ㈜ 가나 푸드, 가나푸드 주식회사가 냉동 수산물을 공급";
        let masked = mask(text, &form(), &given, &[]);
        assert_eq!(
            masked.text(),
            "{{ creditor_name }}, {{ creditor_name }}, {{ creditor_name }}가 냉동 수산물을 공급"
        );
        assert_eq!(
            masked.found,
            [Masked {
                placeholder: "{{ creditor_name }}".into(),
                category: MaskCategory::Organization,
                by: MaskSource::Answers,
            }]
        );
    }

    #[test]
    fn words_the_person_adds_are_masked_and_numbered_by_appearance() {
        let extra = ["박한빛".to_string(), "김가나".to_string()];
        let masked = mask(
            "김가나가 박한빛에게, 김 가나가 다시",
            &form(),
            &Answers::new(),
            &extra,
        );
        assert_eq!(masked.text(), "⟦가린말1⟧가 ⟦가린말2⟧에게, ⟦가린말1⟧가 다시");
        assert!(
            masked
                .found
                .iter()
                .all(|entry| entry.by == MaskSource::User)
        );
        assert_eq!(masked.found.len(), 2);
    }

    #[test]
    fn open_fields_are_the_unanswered_ones_shown_or_behind_a_choice_not_made() {
        let given = answers(&[("goods", "냉동 수산물"), ("total", " ")]);
        let open: Vec<(String, Sensitivity)> = open_fields(&form(), &given)
            .into_iter()
            .map(|spec| (spec.id, spec.sensitivity))
            .collect();
        assert_eq!(
            open,
            [
                ("creditor_name".to_string(), Sensitivity::Pii),
                ("creditor_id".to_string(), Sensitivity::Pii),
                ("total".to_string(), Sensitivity::Public),
                ("due_on".to_string(), Sensitivity::Public),
                ("vat".to_string(), Sensitivity::Public),
                ("supplied_on".to_string(), Sensitivity::Public),
            ]
        );
    }

    fn resolve_one(text: &str, field: &str, pointer: Pointer) -> Candidate {
        let masked = mask(text, &form(), &Answers::new(), &["김가나".to_string()]);
        let offered = open_fields(&form(), &Answers::new());
        let proposed = [ProposedAnswer {
            field: field.into(),
            pointer,
        }];
        resolve(&masked, &offered, &proposed).remove(0)
    }

    fn quote(text: &str) -> Pointer {
        Pointer::Quote { text: text.into() }
    }

    fn readable(field: &str, value: &str, quoted: &str) -> Candidate {
        Candidate::Readable {
            field: field.into(),
            value: Answer::One(value.into()),
            quoted: quoted.into(),
        }
    }

    fn rejected(field: &str, reason: Rejection) -> Candidate {
        Candidate::Rejected {
            field: field.into(),
            reason,
        }
    }

    #[test]
    fn a_quote_is_read_as_the_form_reads_its_field() {
        let text = "대금 10,000,000원을 2026. 3. 31.까지 지급";
        assert_eq!(
            resolve_one(text, "total", quote("10,000,000원")),
            readable("total", "10,000,000", "10,000,000원")
        );
        assert_eq!(
            resolve_one(text, "due_on", quote("2026. 3. 31.")),
            readable("due_on", "2026-03-31", "2026. 3. 31.")
        );
    }

    #[test]
    fn a_quote_cut_from_a_longer_value_is_not_read() {
        let cases = [
            ("총액은 17,000,000원입니다", "total", "7,000,000원"),
            ("합계 1,250,000원 발행", "total", "250,000원"),
            ("공급가액 5,000천원", "total", "5,000"),
            ("미화 5,000달러", "total", "5,000"),
            ("냉동 수산물 200박스", "total", "200"),
            ("금 1억 2,000원", "total", "2,000원"),
            ("2024년 11월 30일", "due_on", "1월 30일"),
            ("2024년 11월 30일", "due_on", "2024년 11월 3"),
            ("대금을 2026. 3. 31.까지", "due_on", "2026. 3. 3"),
        ];
        let wrong: Vec<String> = cases
            .iter()
            .filter_map(|(text, field, cut)| {
                let got = resolve_one(text, field, quote(cut));
                (got != rejected(field, Rejection::NotWholeValue))
                    .then(|| format!("{cut:?} from {text:?} gave {got:?}"))
            })
            .collect();
        assert!(wrong.is_empty(), "{wrong:#?}");
    }

    #[test]
    fn a_quote_of_a_whole_value_is_read() {
        assert_eq!(
            resolve_one("총액은 17,000,000원입니다", "total", quote("17,000,000원")),
            readable("total", "17,000,000", "17,000,000원")
        );
        assert_eq!(
            resolve_one("대금을 2026. 3. 31.까지", "due_on", quote("2026. 3. 31.")),
            readable("due_on", "2026-03-31", "2026. 3. 31.")
        );
        assert_eq!(
            resolve_one(
                "계약금 7,000,000원, 총액 17,000,000원",
                "total",
                quote("7,000,000원")
            ),
            readable("total", "7,000,000", "7,000,000원")
        );
    }

    #[test]
    fn a_quote_the_core_cannot_read_is_not_a_candidate() {
        let text = "대금 700만 원을 3월 말까지";
        assert_eq!(
            resolve_one(text, "total", quote("700만 원")),
            rejected("total", Rejection::ValueUnreadable)
        );
        assert_eq!(
            resolve_one(text, "due_on", quote("3월 말")),
            rejected("due_on", Rejection::ValueUnreadable)
        );
    }

    #[test]
    fn a_quote_must_occur_exactly_once() {
        let text = "1,000원 그리고 1,000원";
        assert_eq!(
            resolve_one(text, "total", quote("1,000원")),
            rejected("total", Rejection::QuoteAmbiguous)
        );
        assert_eq!(
            resolve_one(text, "total", quote("2,000원")),
            rejected("total", Rejection::QuoteNotInText)
        );
        assert_eq!(
            resolve_one(text, "total", quote("")),
            rejected("total", Rejection::QuoteNotInText)
        );
    }

    #[test]
    fn a_placeholder_gives_back_the_masked_original() {
        let text = "채권자 김가나";
        assert_eq!(
            resolve_one(
                text,
                "creditor_name",
                Pointer::Placeholder {
                    token: "⟦가린말1⟧".into()
                }
            ),
            readable("creditor_name", "김가나", "김가나")
        );
        assert_eq!(
            resolve_one(
                text,
                "creditor_name",
                Pointer::Placeholder {
                    token: "⟦가린말9⟧".into()
                }
            ),
            rejected("creditor_name", Rejection::QuoteNotInText)
        );
    }

    #[test]
    fn a_masked_number_is_not_an_amount() {
        let account = Pointer::Placeholder {
            token: "⟦계좌번호1⟧".into(),
        };
        assert_eq!(
            resolve_one("계좌 12345678901", "total", account),
            rejected("total", Rejection::NotWholeValue)
        );
    }

    #[test]
    fn a_quote_around_a_placeholder_is_shown_as_written() {
        assert_eq!(
            resolve_one("채권자 김가나의 냉동 수산물", "goods", quote("냉동 수산물")),
            readable("goods", "냉동 수산물", "냉동 수산물")
        );
        assert_eq!(
            resolve_one("상호 김가나상회", "creditor_name", quote("⟦가린말1⟧상회")),
            readable("creditor_name", "김가나상회", "김가나상회")
        );
    }

    #[test]
    fn options_must_be_the_fields_own() {
        assert_eq!(
            resolve_one(
                "부가세 포함",
                "vat",
                Pointer::Option {
                    value: "included".into()
                }
            ),
            readable("vat", "included", "대금에 포함")
        );
        assert_eq!(
            resolve_one(
                "부가세 포함",
                "vat",
                Pointer::Option {
                    value: "maybe".into()
                }
            ),
            rejected("vat", Rejection::NotAChoice)
        );
        assert_eq!(
            resolve_one(
                "부가세 포함",
                "total",
                Pointer::Option {
                    value: "included".into()
                }
            ),
            rejected("total", Rejection::NotAChoice)
        );
    }

    #[test]
    fn a_field_hidden_behind_a_choice_not_made_yet_gets_its_candidate() {
        assert_eq!(
            resolve_one("공급일 2026-03-02", "supplied_on", quote("2026-03-02")),
            readable("supplied_on", "2026-03-02", "2026-03-02")
        );
    }

    #[test]
    fn a_field_the_persons_choice_hides_gets_nothing() {
        let given = answers(&[("vat", "included")]);
        let masked = mask("공급일 2026-03-02", &form(), &given, &[]);
        let proposed = [ProposedAnswer {
            field: "supplied_on".into(),
            pointer: quote("2026-03-02"),
        }];
        assert_eq!(
            resolve(&masked, &open_fields(&form(), &given), &proposed),
            [rejected("supplied_on", Rejection::FieldNotOffered)]
        );
    }

    #[test]
    fn a_personal_field_goes_out_as_its_label_without_its_help() {
        let request = serde_json::to_value(open_fields(&form(), &Answers::new())).unwrap();
        let help = |id: &str| {
            request
                .as_array()
                .unwrap()
                .iter()
                .find(|spec| spec["id"] == id)
                .unwrap()["help"]
                .clone()
        };
        assert_eq!(help("creditor_id"), serde_json::Value::Null);
        assert_eq!(help("total"), "계약서의 총액");
    }

    #[test]
    fn the_screen_sees_whether_a_field_is_personal_and_nothing_more() {
        let field = Field::text("creditor_name", "이름").pii(MaskCategory::Person);
        let json = serde_json::to_value(&field).unwrap();
        assert_eq!(json["sensitivity"], "pii");
        assert_eq!(
            serde_json::to_value(Field::text("goods", "품목")).unwrap()["sensitivity"],
            "public"
        );
    }
}
