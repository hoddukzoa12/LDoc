//! 지급명령 신청서(물품대금 청구). Wording and branches follow drafting
//! guide doc-125 of korean-legal-doc-drafter.

use super::{CostLine, DocKind, Draft};
use crate::document::{Align, Block, Document};
use crate::fees::{self, Filing};
use crate::form::{Answers, Choices, Field, FieldError, Form, Reader, Step};
use crate::josa;
use crate::money::Won;
use crate::rates;
use jiff::ToSpan;
use jiff::civil::Date;

pub(super) const KIND: DocKind = DocKind {
    id: "payment-order-goods",
    title: "지급명령 신청서(물품대금 청구)",
    category: "지급명령",
    form,
    draft,
};

#[derive(Clone, Copy)]
enum PartyType {
    Corporation,
    SoleProprietor,
    Individual,
}

#[derive(Clone, Copy)]
enum TradeType {
    OneTime,
    Continuous,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Evidence {
    Contract,
    Statement,
    TaxInvoice,
    Receipt,
    Deposit,
    Admission,
    CertifiedMail,
}

const FILING: Choices<Filing> = &[
    (
        "electronic",
        "전자소송 (인지대 10% 할인)",
        Filing::Electronic,
    ),
    ("paper", "법원 방문·우편 제출", Filing::Paper),
];

const PARTY_TYPE: Choices<PartyType> = &[
    ("corporation", "법인", PartyType::Corporation),
    ("sole_proprietor", "개인사업자", PartyType::SoleProprietor),
    ("individual", "개인", PartyType::Individual),
];

const TRADE_TYPE: Choices<TradeType> = &[
    ("one_time", "1회성 공급", TradeType::OneTime),
    (
        "continuous",
        "계속적 거래 (반복 납품·월 정산)",
        TradeType::Continuous,
    ),
];

const VAT: Choices<bool> = &[
    ("included", "대금에 포함", true),
    ("none", "해당 없음", false),
];

const EVIDENCE: Choices<Evidence> = &[
    ("contract", "계약서·발주서", Evidence::Contract),
    ("statement", "거래명세서", Evidence::Statement),
    ("tax_invoice", "세금계산서", Evidence::TaxInvoice),
    ("receipt", "인수증·배송 완료 기록", Evidence::Receipt),
    ("deposit", "입금 내역(일부 변제)", Evidence::Deposit),
    (
        "admission",
        "채무자의 잔액 인정 문자·확인서",
        Evidence::Admission,
    ),
    (
        "certified_mail",
        "내용증명 및 배달증명",
        Evidence::CertifiedMail,
    ),
];

impl Evidence {
    fn title(self) -> &'static str {
        match self {
            Evidence::Contract => "계약서(발주서)",
            Evidence::Statement => "거래명세서",
            Evidence::TaxInvoice => "세금계산서",
            Evidence::Receipt => "인수증(배송 기록)",
            Evidence::Deposit => "입금 내역",
            Evidence::Admission => "채무자의 잔액 인정 확인서",
            Evidence::CertifiedMail => "내용증명 및 배달증명",
        }
    }
}

const BUSINESS: [&str; 2] = ["corporation", "sole_proprietor"];

fn form() -> Form {
    let party_fields = |side: &str, role: &str| {
        let id = |name: &str| format!("{side}_{name}");
        vec![
            Field::text(&id("name"), &format!("{role} 성명 또는 법인명")),
            Field::text(&id("representative"), "대표이사 성명")
                .show_when(&id("type"), &["corporation"]),
            Field::text(&id("trade_name"), "상호").show_when(&id("type"), &["sole_proprietor"]),
            Field::text(&id("business"), "업종")
                .help("예: 식자재 도매")
                .show_when(&id("type"), &BUSINESS),
        ]
    };

    let mut creditor = party_fields("creditor", "채권자");
    creditor.extend([
        Field::text("creditor_id", "주민등록번호 (법인은 법인등록번호)"),
        Field::text("creditor_address", "주소 (법인은 본점 소재지)"),
        Field::text("creditor_phone", "연락처").help("법원의 보정명령을 받을 번호입니다."),
    ]);

    let mut debtor = party_fields("debtor", "채무자");
    debtor.extend([
        Field::text("debtor_id", "주민등록번호 (법인은 법인등록번호)")
            .optional()
            .help("모르면 비워 두세요. 사업자등록번호처럼 확보한 식별 정보를 적어도 됩니다."),
        Field::text("debtor_address", "송달 가능한 주소")
            .help("사업장이나 본점 주소입니다. 지급명령은 공시송달이 되지 않습니다."),
    ]);

    let step = |title: &str, fields: Vec<Field>| Step {
        title: title.to_string(),
        fields,
    };

    Form {
        steps: vec![
            step(
                "제출 방법",
                vec![Field::choice("filing", "제출 방법", FILING), Field::date("filed_on", "신청일")],
            ),
            step(
                "당사자 유형",
                vec![
                    Field::choice("creditor_type", "채권자(공급자)", PARTY_TYPE),
                    Field::choice("debtor_type", "채무자(매수인)", PARTY_TYPE)
                        .help("어느 한쪽이라도 법인이나 개인사업자이면 지연손해금 이율은 연 6%입니다."),
                ],
            ),
            step(
                "거래 내용",
                vec![
                    Field::choice("trade_type", "거래 형태", TRADE_TYPE),
                    Field::date("supplied_on", "공급일").show_when("trade_type", &["one_time"]),
                    Field::date("trade_from", "거래 시작일").show_when("trade_type", &["continuous"]),
                    Field::date("trade_to", "거래 종료일").show_when("trade_type", &["continuous"]),
                    Field::text("goods", "품목과 수량").help("예: 냉동 수산물 200박스"),
                    Field::money("total", "대금 총액"),
                    Field::choice("vat", "부가가치세", VAT),
                    Field::money("paid", "이미 받은 금액").optional().help("받은 돈이 없으면 비워 두세요."),
                    Field::date("due_on", "약정 지급기일")
                        .optional()
                        .help("약정이 없으면 비워 두세요. 그 경우 지연손해금은 지급명령 송달 다음 날부터 청구합니다."),
                ],
            ),
            step(
                "입증방법",
                vec![
                    Field::multi_choice("evidence", "보유한 증거", EVIDENCE)
                        .help("고른 순서와 관계없이 이 목록 순서대로 갑 제1호증부터 번호가 붙습니다."),
                    Field::date("demand_sent_on", "내용증명 발송일").show_when("evidence", &["certified_mail"]),
                ],
            ),
            step(
                "관할법원",
                vec![Field::text("court", "관할법원").help(
                    "채무자 주소지 또는 채권자 주소지의 지방법원입니다. 예: 서울중앙지방법원. 계약서에 관할 합의가 있어도 이 두 곳 중에서 정합니다.",
                )],
            ),
            step("채권자", creditor),
            step("채무자", debtor),
        ],
    }
}

enum PartyKind {
    Corporation {
        representative: String,
        business: String,
    },
    SoleProprietor {
        trade_name: String,
        business: String,
    },
    Individual,
}

struct Party {
    name: String,
    kind: PartyKind,
    id_number: Option<String>,
    address: String,
    phone: Option<String>,
}

impl Party {
    fn is_merchant(&self) -> bool {
        !matches!(self.kind, PartyKind::Individual)
    }
}

enum Trade {
    OneTime { on: Date },
    Continuous { from: Date, to: Date },
}

struct Request {
    filing: Filing,
    filed_on: Date,
    creditor: Party,
    debtor: Party,
    trade: Trade,
    goods: String,
    total: Won,
    paid: Won,
    balance: Won,
    vat_included: bool,
    due_on: Option<Date>,
    evidence: Vec<Evidence>,
    demand_sent_on: Option<Date>,
    court: String,
    service_unit: Won,
    litigation_percent: u32,
}

/// "식자재 도매업" and "식자재 도매" both read as "식자재 도매" so the
/// sentence can add "업" itself.
fn business(text: String) -> String {
    text.strip_suffix('업').map(str::to_string).unwrap_or(text)
}

enum Side {
    Creditor,
    Debtor,
}

fn party(r: &mut Reader, side: Side) -> Option<Party> {
    let prefix = match side {
        Side::Creditor => "creditor",
        Side::Debtor => "debtor",
    };
    let id = |name: &str| format!("{prefix}_{name}");

    let name = r.text(&id("name"));
    let kind = match r.choice(&id("type"), PARTY_TYPE) {
        Some(PartyType::Corporation) => {
            let representative = r.text(&id("representative"));
            let business_name = r.text(&id("business"));
            representative
                .zip(business_name)
                .map(|(representative, business_name)| PartyKind::Corporation {
                    representative,
                    business: business(business_name),
                })
        }
        Some(PartyType::SoleProprietor) => {
            let trade_name = r.text(&id("trade_name"));
            let business_name = r.text(&id("business"));
            trade_name
                .zip(business_name)
                .map(|(trade_name, business_name)| PartyKind::SoleProprietor {
                    trade_name,
                    business: business(business_name),
                })
        }
        Some(PartyType::Individual) => Some(PartyKind::Individual),
        None => None,
    };
    let address = r.text(&id("address"));
    let (id_number, phone) = match side {
        Side::Creditor => (r.text(&id("id")).map(Some), r.text(&id("phone")).map(Some)),
        Side::Debtor => (Some(r.optional_text(&id("id"))), Some(None)),
    };

    Some(Party {
        name: name?,
        kind: kind?,
        id_number: id_number?,
        address: address?,
        phone: phone?,
    })
}

fn parse(answers: &Answers) -> Result<Request, Vec<FieldError>> {
    let mut r = Reader::new(answers);

    let filing = r.choice("filing", FILING);
    let filed_on = r.date("filed_on");
    let service_unit = filed_on.and_then(|day| rates::SERVICE_UNIT.on(day));
    let litigation_percent = filed_on.and_then(|day| rates::LITIGATION_DELAY_PERCENT.on(day));
    if filed_on.is_some() && (service_unit.is_none() || litigation_percent.is_none()) {
        r.fail(
            "filed_on",
            "이 날짜에 적용할 송달료 단가나 법정이율 자료가 없습니다.",
        );
    }

    let creditor = party(&mut r, Side::Creditor);
    let debtor = party(&mut r, Side::Debtor);

    let trade = match r.choice("trade_type", TRADE_TYPE) {
        Some(TradeType::OneTime) => r.date("supplied_on").map(|on| Trade::OneTime { on }),
        Some(TradeType::Continuous) => {
            let span = r.date("trade_from").zip(r.date("trade_to"));
            if let Some((from, to)) = span
                && to < from
            {
                r.fail("trade_to", "거래 종료일이 시작일보다 빠릅니다.");
            }
            span.map(|(from, to)| Trade::Continuous { from, to })
        }
        None => None,
    };
    let goods = r.text("goods");
    let total = r.money("total");
    let paid = r.optional_money("paid").unwrap_or(Won::new(0));
    let balance = match total.map(|total| (total, total.checked_sub(paid))) {
        Some((total, _)) if total.amount() == 0 => {
            r.fail("total", "대금 총액은 0원보다 커야 합니다.");
            None
        }
        Some((_, Some(balance))) if balance.amount() > 0 => Some(balance),
        Some(_) => {
            r.fail(
                "paid",
                "이미 받은 금액이 대금 총액 이상이라 청구할 잔액이 없습니다.",
            );
            None
        }
        None => None,
    };
    let vat_included = r.choice("vat", VAT);
    let due_on = r.optional_date("due_on");

    let evidence = r.choices("evidence", EVIDENCE);
    if evidence.is_empty() {
        r.fail("evidence", "입증방법을 하나 이상 선택해 주세요.");
    }
    let demand_sent_on = if evidence.contains(&Evidence::CertifiedMail) {
        r.date("demand_sent_on").map(Some)
    } else {
        Some(None)
    };
    let court = r.text("court");

    // What happened before filing must be dated on or before the filing
    // date, and the price must have fallen due before it.
    if let Some(filed_on) = filed_on {
        let (supply, field) = match &trade {
            Some(Trade::OneTime { on }) => (Some(*on), "supplied_on"),
            Some(Trade::Continuous { to, .. }) => (Some(*to), "trade_to"),
            None => (None, ""),
        };
        let past = [
            (field, supply),
            ("demand_sent_on", demand_sent_on.flatten()),
        ];
        for (field, day) in past {
            if day.is_some_and(|day| day > filed_on) {
                r.fail(
                    field,
                    "신청일보다 늦은 날짜입니다. 신청일 이전의 날짜를 적어 주세요.",
                );
            }
        }
        if due_on.is_some_and(|due| due >= filed_on) {
            r.fail(
                "due_on",
                "지급기일이 신청일 전이어야 합니다. 지급기일이 지나지 않은 대금은 지급명령으로 청구할 수 없습니다.",
            );
        }
    }

    let request = (|| {
        Some(Request {
            filing: filing?,
            filed_on: filed_on?,
            creditor: creditor?,
            debtor: debtor?,
            trade: trade?,
            goods: goods?,
            total: total?,
            paid,
            balance: balance?,
            vat_included: vat_included?,
            due_on,
            evidence,
            demand_sent_on: demand_sent_on?,
            court: court?,
            service_unit: service_unit?,
            litigation_percent: litigation_percent?,
        })
    })();
    r.finish(request)
}

fn draft(answers: &Answers) -> Result<Draft, Vec<FieldError>> {
    let request = parse(answers)?;
    Ok(Draft {
        document: document(&request),
        costs: costs(&request),
        notices: notices(&request),
    })
}

/// `2026. 3. 31.`
fn day(date: Date) -> String {
    format!("{}. {}. {}.", date.year(), date.month(), date.day())
}

/// `금 7,000,000원 (칠백만 원)`
fn money(amount: Won) -> String {
    format!("금 {}원 ({} 원)", amount.with_commas(), amount.in_korean())
}

fn exhibit(evidence: &[Evidence], item: Evidence) -> Option<String> {
    let position = evidence.iter().position(|held| *held == item)?;
    Some(format!("갑 제{}호증", position + 1))
}

const INDENT: &str = "          ";

fn party_lines(label: &str, party: &Party, unknown_id: &str) -> Vec<Block> {
    let id_number = party.id_number.as_deref();
    let mut lines = Vec::new();
    match &party.kind {
        PartyKind::Corporation { representative, .. } => {
            lines.push(format!(
                "{label}  {} (대표이사 {representative})",
                party.name
            ));
            if let Some(id_number) = id_number {
                lines.push(format!("{INDENT}법인등록번호 {id_number}"));
            }
        }
        PartyKind::SoleProprietor { trade_name, .. } => {
            let id_number = id_number.unwrap_or(unknown_id);
            lines.push(format!(
                "{label}  {} (상호: {trade_name}) ({id_number})",
                party.name
            ));
        }
        PartyKind::Individual => {
            let id_number = id_number.unwrap_or(unknown_id);
            lines.push(format!("{label}  {} ({id_number})", party.name));
        }
    }
    lines.push(format!("{INDENT}{}", party.address));
    if let Some(phone) = &party.phone {
        lines.push(format!("{INDENT}{phone}"));
    }
    lines.into_iter().map(Block::left).collect()
}

fn pre_service_percent(request: &Request) -> u32 {
    if request.creditor.is_merchant() || request.debtor.is_merchant() {
        rates::COMMERCIAL_PERCENT
    } else {
        rates::CIVIL_PERCENT
    }
}

fn claim(request: &Request) -> String {
    let amount = money(request.balance);
    let after_service = request.litigation_percent;
    // Interest starts the day after the due date. A due date at the end of
    // the calendar has no next day, and then the claim falls back to the
    // form used when no due date was agreed.
    match request.due_on.and_then(|due| due.tomorrow().ok()) {
        Some(start) => format!(
            "채무자는 채권자에게 {amount} 및 이에 대하여 {}부터 이 사건 지급명령 정본 송달일까지는 연 {}%의, 그 다음 날부터 다 갚는 날까지는 연 {after_service}%의 각 비율로 계산한 돈을 지급하라.",
            day(start),
            pre_service_percent(request),
        ),
        None => format!(
            "채무자는 채권자에게 {amount} 및 이에 대하여 이 사건 지급명령 정본 송달 다음 날부터 다 갚는 날까지 연 {after_service}%의 비율로 계산한 돈을 지급하라."
        ),
    }
}

fn describe(party: &Party, as_individual: &str) -> String {
    match &party.kind {
        PartyKind::Corporation { business, .. } => format!("{business}업을 영위하는 법인"),
        PartyKind::SoleProprietor {
            trade_name,
            business,
        } => {
            format!(
                "{trade_name}{} 상호로 {business}업을 영위하는 자",
                josa::called(trade_name)
            )
        }
        PartyKind::Individual => as_individual.to_string(),
    }
}

fn grounds(request: &Request) -> Vec<String> {
    let Request {
        goods,
        total,
        paid,
        balance,
        evidence,
        ..
    } = request;
    let object = josa::object(goods);
    let vat = if request.vat_included {
        "(부가가치세 포함)"
    } else {
        ""
    };
    let price = money(*total);

    let parties = format!(
        "채권자는 {}이고, 채무자는 {}입니다.",
        describe(&request.creditor, "채무자에게 아래 물품을 공급한 자"),
        describe(&request.debtor, "이를 공급받은 자"),
    );

    let supply = match request.trade {
        Trade::OneTime { on } => format!(
            "채권자는 {}에 채무자에게 {goods}{object} 대금 {price}{vat}에 공급하였고, 채무자는 같은 날 이를 이의 없이 인수하였습니다.",
            day(on),
        ),
        Trade::Continuous { from, to } => {
            let cited: Vec<String> = [Evidence::Statement, Evidence::TaxInvoice]
                .into_iter()
                .filter_map(|item| Some(format!("{} {}", exhibit(evidence, item)?, item.title())))
                .collect();
            let cited = if cited.is_empty() {
                String::new()
            } else {
                format!("({})", cited.join(", "))
            };
            format!(
                "채권자는 {}부터 {}까지 채무자에게 {goods}{object} 계속 공급하였고 그 대금 합계는 {price}{vat}입니다{cited}.",
                day(from),
                day(to),
            )
        }
    };

    let agreed = match request.due_on {
        Some(due) => format!(
            "위 대금의 지급기일은 {}로 약정되었으나, 채무자는 ",
            day(due)
        ),
        None => "채무자는 ".to_string(),
    };
    let unpaid = if paid.amount() > 0 {
        format!(
            "위 대금 중 {}만 지급하였을 뿐 잔액 {}을 현재까지 지급하지 아니하고 있습니다.",
            money(*paid),
            money(*balance),
        )
    } else {
        "위 대금을 현재까지 지급하지 아니하고 있습니다.".to_string()
    };

    let mut paragraphs = vec![parties, supply, format!("{agreed}{unpaid}")];
    if let Some(sent_on) = request.demand_sent_on {
        let cited = exhibit(evidence, Evidence::CertifiedMail)
            .map(|label| format!("({label})"))
            .unwrap_or_default();
        paragraphs.push(format!(
            "채권자는 {} 내용증명으로 지급을 최고하였으나{cited}, 채무자는 이에 응하지 아니하였습니다.",
            day(sent_on),
        ));
    }
    paragraphs
        .push("이에 채권자는 청구취지 기재와 같은 지급명령을 구하기에 이르렀습니다.".to_string());
    paragraphs
}

fn numbered(items: impl IntoIterator<Item = String>) -> Vec<Block> {
    items
        .into_iter()
        .enumerate()
        .map(|(index, item)| Block::body(format!("{}. {item}", index + 1)))
        .collect()
}

fn section(blocks: &mut Vec<Block>, heading: &str, body: Vec<Block>) {
    blocks.push(Block::heading(heading));
    blocks.push(Block::blank());
    blocks.extend(body);
    blocks.push(Block::blank());
}

fn document(request: &Request) -> Document {
    let Request {
        creditor,
        debtor,
        evidence,
        ..
    } = request;
    let mut blocks = vec![Block::title("지 급 명 령 신 청 서"), Block::blank()];

    blocks.extend(party_lines("채 권 자", creditor, "주민등록번호 불명"));
    blocks.push(Block::blank());
    blocks.extend(party_lines("채 무 자", debtor, "주민등록번호 불명"));
    blocks.push(Block::blank());
    blocks.push(Block::left("물품대금 청구의 독촉사건"));
    blocks.push(Block::blank());

    section(
        &mut blocks,
        "청 구 취 지",
        vec![
            Block::body(claim(request)),
            Block::blank(),
            Block::body("라는 지급명령을 구합니다."),
        ],
    );

    let mut paragraphs = Vec::new();
    for paragraph in numbered(grounds(request)) {
        paragraphs.push(paragraph);
        paragraphs.push(Block::blank());
    }
    paragraphs.pop();
    section(&mut blocks, "청 구 원 인", paragraphs);

    section(
        &mut blocks,
        "입 증 방 법",
        numbered(
            evidence
                .iter()
                .enumerate()
                .map(|(index, item)| format!("갑 제{}호증  {}", index + 1, item.title())),
        ),
    );

    let mut attachments = vec!["위 입증방법 각 1통".to_string()];
    if matches!(debtor.kind, PartyKind::Corporation { .. }) {
        attachments.push("법인등기사항전부증명서 1통".to_string());
    }
    attachments.push("송달료 납부서 1통".to_string());
    section(&mut blocks, "첨 부 서 류", numbered(attachments));

    let signer = match &creditor.kind {
        PartyKind::Corporation { representative, .. } => {
            format!("{} 대표이사 {representative}", creditor.name)
        }
        _ => creditor.name.clone(),
    };
    blocks.push(Block::right(day(request.filed_on)));
    blocks.push(Block::blank());
    blocks.push(Block::right(format!("위 채권자 {signer} (서명 또는 인)")));
    blocks.push(Block::blank());
    blocks.push(Block {
        text: format!("{} 귀중", request.court),
        align: Align::Left,
        bold: true,
        size_pt: 14,
    });

    Document { blocks }
}

const PARTIES: u64 = 2;

fn costs(request: &Request) -> Vec<CostLine> {
    let complaint = fees::complaint_stamp(request.balance);
    let stamp = fees::payment_order_stamp(request.balance, request.filing);
    let stamp_basis = match request.filing {
        Filing::Paper => format!("소장 인지액 {complaint}의 1/10"),
        Filing::Electronic => format!("소장 인지액 {complaint}의 1/10에서 전자소송 10% 할인"),
    };
    let rounds = rates::PAYMENT_ORDER_SERVICE_ROUNDS;
    let service = fees::service_fee(PARTIES, request.service_unit, rounds);
    vec![
        CostLine {
            label: "인지대".to_string(),
            amount: stamp,
            basis: stamp_basis,
        },
        CostLine {
            label: "송달료".to_string(),
            amount: service,
            basis: format!(
                "당사자 {PARTIES}명 × {} × {rounds}회분",
                request.service_unit
            ),
        },
        CostLine {
            label: "합계".to_string(),
            amount: Won::new(stamp.amount() + service.amount()),
            basis: "신청할 때 납부합니다.".to_string(),
        },
    ]
}

/// 민법 제163조 제6호: the price of goods sold by a producer or merchant
/// lapses after three years. A private individual's sale falls outside it.
fn limitation_notice(request: &Request) -> Option<String> {
    if !request.creditor.is_merchant() {
        return None;
    }
    let runs_from = request.due_on.unwrap_or(match request.trade {
        Trade::OneTime { on } => on,
        Trade::Continuous { from, .. } => from,
    });
    let lapses_on = runs_from.checked_add(3.years()).ok()?;
    let warn_from = lapses_on.checked_sub(6.months()).ok()?;
    let when = day(lapses_on);
    if request.filed_on > lapses_on {
        Some(format!(
            "소멸시효 3년이 {when} 무렵 지났을 수 있습니다(민법 제163조 제6호). 채무자가 잔액을 인정한 문자나 확인서처럼 시효를 중단시킨 자료가 있는지 확인하세요."
        ))
    } else if request.filed_on >= warn_from {
        Some(format!(
            "소멸시효 3년이 {when} 무렵 끝납니다(민법 제163조 제6호). 지급명령 신청으로 시효가 중단되므로 서둘러 신청하세요."
        ))
    } else {
        None
    }
}

fn notices(request: &Request) -> Vec<String> {
    let how_to_file = match request.filing {
        Filing::Electronic => {
            "전자소송(ecfs.scourt.go.kr)의 지급명령 신청 양식에 이 문서의 내용을 옮겨 입력하고 첨부서류를 PDF로 올립니다."
        }
        Filing::Paper => {
            "신청서와 첨부서류를 관할법원 종합민원실에 내고 인지대와 송달료를 수납 창구에서 납부합니다."
        }
    };
    let fixed = [
        how_to_file,
        "채무자가 송달받고 14일 안에 이의신청하지 않으면 지급명령이 확정됩니다. 이의신청이 있으면 통상의 민사소송으로 넘어갑니다.",
        "지급명령은 공시송달이 되지 않습니다. 송달이 안 되면 주소보정이나 소제기신청으로 전환해야 합니다.",
        "송달료 단가와 법정이율은 바뀔 수 있습니다. 제출 전에 최신 기준을 확인하세요.",
        "이 문서는 참고용이며 법률 자문이 아닙니다. 법률 전문가의 검토 후 사용하십시오.",
    ];
    limitation_notice(request)
        .into_iter()
        .chain(fixed.map(str::to_string))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::{DraftError, draft as draft_document, form as form_of};
    use crate::form::Answer;

    /// 주식회사 가나푸드 supplied 10,000,000 won of goods to 주식회사
    /// 한빛마트, was paid 3,000,000, and files electronically.
    fn corporate_case() -> Answers {
        answers(&[
            ("filing", "electronic"),
            ("filed_on", "2026-11-19"),
            ("creditor_type", "corporation"),
            ("debtor_type", "corporation"),
            ("trade_type", "one_time"),
            ("supplied_on", "2026-03-02"),
            ("goods", "냉동 수산물 200박스"),
            ("total", "10,000,000"),
            ("vat", "included"),
            ("paid", "3,000,000"),
            ("due_on", "2026-03-31"),
            ("demand_sent_on", "2026-05-11"),
            ("court", "서울중앙지방법원"),
            ("creditor_name", "주식회사 가나푸드"),
            ("creditor_representative", "김가나"),
            ("creditor_business", "식자재 도매업"),
            ("creditor_id", "110111-0000001"),
            ("creditor_address", "서울특별시 서초구 서초대로 1"),
            ("creditor_phone", "02-000-0000"),
            ("debtor_name", "주식회사 한빛마트"),
            ("debtor_representative", "박한빛"),
            ("debtor_business", "식품 소매"),
            ("debtor_address", "서울특별시 강남구 테헤란로 2"),
        ])
        .with_many("evidence", &["statement", "tax_invoice", "certified_mail"])
    }

    fn answers(pairs: &[(&str, &str)]) -> Answers {
        pairs
            .iter()
            .map(|(field, value)| (field.to_string(), Answer::One(value.to_string())))
            .collect()
    }

    trait Edit {
        fn with(self, field: &str, value: &str) -> Self;
        fn with_many(self, field: &str, values: &[&str]) -> Self;
        fn without(self, field: &str) -> Self;
    }

    impl Edit for Answers {
        fn with(mut self, field: &str, value: &str) -> Self {
            self.insert(field.to_string(), Answer::One(value.to_string()));
            self
        }

        fn with_many(mut self, field: &str, values: &[&str]) -> Self {
            self.insert(
                field.to_string(),
                Answer::Many(values.iter().map(|value| value.to_string()).collect()),
            );
            self
        }

        fn without(mut self, field: &str) -> Self {
            self.remove(field);
            self
        }
    }

    fn text(answers: &Answers) -> String {
        draft_document(KIND.id, answers)
            .expect("a draft")
            .document
            .plain_text()
    }

    fn failed_fields(answers: &Answers) -> Vec<String> {
        match draft_document(KIND.id, answers) {
            Err(DraftError::InvalidFields { errors }) => {
                errors.into_iter().map(|error| error.field).collect()
            }
            other => panic!("expected field errors, got {other:?}"),
        }
    }

    #[test]
    fn claims_the_unpaid_balance_with_two_stage_interest() {
        assert!(text(&corporate_case()).contains(
            "채무자는 채권자에게 금 7,000,000원 (칠백만 원) 및 이에 대하여 2026. 4. 1.부터 이 사건 지급명령 정본 송달일까지는 연 6%의, 그 다음 날부터 다 갚는 날까지는 연 12%의 각 비율로 계산한 돈을 지급하라."
        ));
    }

    #[test]
    fn two_private_individuals_get_the_civil_rate() {
        let case = corporate_case()
            .with("creditor_type", "individual")
            .with("debtor_type", "individual");
        let text = text(&case);
        assert!(text.contains("송달일까지는 연 5%의"), "{text}");
        assert!(!text.contains("연 6%"));
    }

    #[test]
    fn one_merchant_is_enough_for_the_commercial_rate() {
        let case = corporate_case().with("debtor_type", "individual");
        assert!(text(&case).contains("송달일까지는 연 6%의"));
    }

    #[test]
    fn without_a_due_date_interest_runs_from_the_day_after_service() {
        let text = text(&corporate_case().without("due_on"));
        assert!(text.contains(
            "금 7,000,000원 (칠백만 원) 및 이에 대하여 이 사건 지급명령 정본 송달 다음 날부터 다 갚는 날까지 연 12%의 비율로 계산한 돈을 지급하라."
        ));
        assert!(!text.contains("연 6%"));
        assert!(!text.contains("지급기일"));
    }

    #[test]
    fn nothing_paid_claims_the_whole_price() {
        let text = text(&corporate_case().without("paid"));
        assert!(text.contains("채무자는 채권자에게 금 10,000,000원 (일천만 원) 및"));
        assert!(text.contains("3. 위 대금의 지급기일은 2026. 3. 31.로 약정되었으나, 채무자는 위 대금을 현재까지 지급하지 아니하고 있습니다."));
    }

    #[test]
    fn grounds_tell_the_supply_the_part_payment_and_the_demand() {
        let text = text(&corporate_case());
        for expected in [
            "1. 채권자는 식자재 도매업을 영위하는 법인이고, 채무자는 식품 소매업을 영위하는 법인입니다.",
            "2. 채권자는 2026. 3. 2.에 채무자에게 냉동 수산물 200박스를 대금 금 10,000,000원 (일천만 원)(부가가치세 포함)에 공급하였고, 채무자는 같은 날 이를 이의 없이 인수하였습니다.",
            "3. 위 대금의 지급기일은 2026. 3. 31.로 약정되었으나, 채무자는 위 대금 중 금 3,000,000원 (삼백만 원)만 지급하였을 뿐 잔액 금 7,000,000원 (칠백만 원)을 현재까지 지급하지 아니하고 있습니다.",
            "4. 채권자는 2026. 5. 11. 내용증명으로 지급을 최고하였으나(갑 제3호증), 채무자는 이에 응하지 아니하였습니다.",
            "5. 이에 채권자는 청구취지 기재와 같은 지급명령을 구하기에 이르렀습니다.",
        ] {
            assert!(text.contains(expected), "missing: {expected}\n\n{text}");
        }
    }

    #[test]
    fn continuous_trade_cites_the_statement_and_invoice_exhibits() {
        let case = corporate_case()
            .with("trade_type", "continuous")
            .with("trade_from", "2025-09-01")
            .with("trade_to", "2026-02-28");
        assert!(text(&case).contains(
            "2. 채권자는 2025. 9. 1.부터 2026. 2. 28.까지 채무자에게 냉동 수산물 200박스를 계속 공급하였고 그 대금 합계는 금 10,000,000원 (일천만 원)(부가가치세 포함)입니다(갑 제1호증 거래명세서, 갑 제2호증 세금계산서)."
        ));
    }

    #[test]
    fn exhibits_are_numbered_in_order_and_no_demand_means_no_demand_paragraph() {
        let case = corporate_case().with_many("evidence", &["tax_invoice", "contract"]);
        let text = text(&case);
        assert!(
            text.contains("1. 갑 제1호증  계약서(발주서)\n2. 갑 제2호증  세금계산서\n"),
            "{text}"
        );
        assert!(!text.contains("내용증명"));
        assert!(text.contains("4. 이에 채권자는"));
    }

    #[test]
    fn a_corporate_debtor_adds_its_registry_extract_to_the_attachments() {
        assert!(
            text(&corporate_case()).contains("2. 법인등기사항전부증명서 1통\n3. 송달료 납부서 1통")
        );

        let individual = text(&corporate_case().with("debtor_type", "individual"));
        assert!(!individual.contains("법인등기사항전부증명서"));
        assert!(individual.contains("2. 송달료 납부서 1통"));
    }

    #[test]
    fn parties_are_identified_by_their_type() {
        let text = text(&corporate_case());
        assert!(text.contains(
            "채 권 자  주식회사 가나푸드 (대표이사 김가나)\n          법인등록번호 110111-0000001\n"
        ));
        assert!(text.contains("위 채권자 주식회사 가나푸드 대표이사 김가나 (서명 또는 인)"));
        assert!(text.ends_with("서울중앙지방법원 귀중"));

        let sole = corporate_case()
            .with("debtor_type", "sole_proprietor")
            .with("debtor_trade_name", "한빛유통");
        let text = super::tests::text(&sole);
        assert!(text.contains("채 무 자  주식회사 한빛마트 (상호: 한빛유통) (주민등록번호 불명)"));
        assert!(text.contains("채무자는 한빛유통이라는 상호로 식품 소매업을 영위하는 자입니다."));
    }

    #[test]
    fn costs_are_the_stamp_fee_and_six_rounds_of_service() {
        let costs = draft_document(KIND.id, &corporate_case()).unwrap().costs;
        let amounts: Vec<(&str, u64)> = costs
            .iter()
            .map(|line| (line.label.as_str(), line.amount.amount()))
            .collect();
        // Claim 7,000,000: complaint fee 35,000, a tenth is 3,500, nine
        // tenths of that is 3,150, under-100 dropped. Service 2 × 5,640 × 6.
        assert_eq!(
            amounts,
            [("인지대", 3_100), ("송달료", 67_680), ("합계", 70_780)]
        );

        let paper = draft_document(KIND.id, &corporate_case().with("filing", "paper"))
            .unwrap()
            .costs;
        assert_eq!(paper[0].amount.amount(), 3_500);
    }

    #[test]
    fn service_is_charged_at_the_unit_in_force_on_the_filing_date() {
        let service = |filed_on: &str| {
            let case = corporate_case().with("filed_on", filed_on);
            draft_document(KIND.id, &case).unwrap().costs[1]
                .amount
                .amount()
        };
        assert_eq!(service("2026-06-30"), 66_000);
        assert_eq!(service("2026-07-01"), 67_680);
    }

    #[test]
    fn dates_after_the_filing_date_are_refused_on_their_field() {
        assert_eq!(
            failed_fields(&corporate_case().with("supplied_on", "2026-11-20")),
            ["supplied_on"]
        );
        let continuous = corporate_case()
            .with("trade_type", "continuous")
            .with("trade_from", "2025-09-01")
            .with("trade_to", "2026-12-01");
        assert_eq!(failed_fields(&continuous), ["trade_to"]);
        assert_eq!(
            failed_fields(&corporate_case().with("demand_sent_on", "2026-11-20")),
            ["demand_sent_on"]
        );
    }

    #[test]
    fn a_due_date_must_come_before_the_filing_date() {
        assert_eq!(
            failed_fields(&corporate_case().with("due_on", "2026-11-19")),
            ["due_on"]
        );
        assert_eq!(
            failed_fields(&corporate_case().with("due_on", "2026-12-31")),
            ["due_on"]
        );
        assert!(draft_document(KIND.id, &corporate_case().with("due_on", "2026-11-18")).is_ok());
    }

    #[test]
    fn a_total_of_nothing_is_reported_on_the_total() {
        assert_eq!(
            failed_fields(&corporate_case().with("total", "0").without("paid")),
            ["total"]
        );
        assert_eq!(
            failed_fields(&corporate_case().with("total", "0")),
            ["total"]
        );
    }

    #[test]
    fn the_evidence_help_says_exhibits_follow_the_list_order() {
        let form = form_of(KIND.id).unwrap();
        let evidence = form
            .steps
            .iter()
            .flat_map(|step| &step.fields)
            .find(|field| field.id == "evidence")
            .unwrap();
        let help = evidence.help.as_deref().unwrap();
        assert!(!help.contains("선택한 순서"), "{help}");
        assert!(help.contains("목록 순서대로"), "{help}");
    }

    #[test]
    fn an_empty_form_reports_every_field_the_form_marks_required() {
        let mut expected: Vec<String> = form_of(KIND.id)
            .unwrap()
            .steps
            .into_iter()
            .flat_map(|step| step.fields)
            .filter(|field| field.required && field.show_when.is_none())
            .map(|field| field.id)
            .collect();
        let mut reported = failed_fields(&Answers::new());
        expected.sort();
        reported.sort();
        assert_eq!(reported, expected);
    }

    #[test]
    fn a_field_shown_for_the_chosen_branch_is_required() {
        assert_eq!(
            failed_fields(&corporate_case().without("creditor_representative")),
            ["creditor_representative"]
        );
        assert_eq!(
            failed_fields(&corporate_case().without("demand_sent_on")),
            ["demand_sent_on"]
        );
        assert_eq!(
            failed_fields(&corporate_case().without("supplied_on")),
            ["supplied_on"]
        );
    }

    #[test]
    fn a_claim_with_nothing_left_to_claim_is_refused() {
        assert_eq!(
            failed_fields(&corporate_case().with("paid", "10,000,000")),
            ["paid"]
        );
        assert_eq!(
            failed_fields(&corporate_case().with("paid", "12,000,000")),
            ["paid"]
        );
    }

    #[test]
    fn unreadable_values_are_reported_on_their_field() {
        assert_eq!(
            failed_fields(&corporate_case().with("total", "천만원")),
            ["total"]
        );
        assert_eq!(
            failed_fields(&corporate_case().with("due_on", "3월 말")),
            ["due_on"]
        );
        assert_eq!(
            failed_fields(&corporate_case().with("filing", "fax")),
            ["filing"]
        );
        assert_eq!(
            failed_fields(&corporate_case().with_many("evidence", &[])),
            ["evidence"]
        );
    }

    #[test]
    fn a_filing_date_older_than_the_rate_tables_is_refused() {
        let early = corporate_case()
            .with("filed_on", "2020-06-30")
            .with("supplied_on", "2020-03-02")
            .with("due_on", "2020-03-31")
            .with("demand_sent_on", "2020-05-11");
        assert_eq!(failed_fields(&early), ["filed_on"]);
        assert!(draft_document(KIND.id, &early.with("filed_on", "2020-07-01")).is_ok());
    }

    #[test]
    fn warns_when_the_three_year_limitation_is_near_or_past() {
        let notices = |case: &Answers| draft_document(KIND.id, case).unwrap().notices.join("\n");

        assert!(!notices(&corporate_case()).contains("소멸시효"));

        let near = notices(
            &corporate_case()
                .with("due_on", "2024-01-31")
                .with("supplied_on", "2024-01-02"),
        );
        assert!(
            near.contains("소멸시효 3년이 2027. 1. 31. 무렵 끝납니다"),
            "{near}"
        );

        let past = notices(
            &corporate_case()
                .with("due_on", "2023-01-31")
                .with("supplied_on", "2023-01-02"),
        );
        assert!(
            past.contains("소멸시효 3년이 2026. 1. 31. 무렵 지났을 수 있습니다"),
            "{past}"
        );
    }

    #[test]
    fn the_three_year_limitation_applies_only_to_a_merchant_creditor() {
        let notices = |case: &Answers| draft_document(KIND.id, case).unwrap().notices.join("\n");
        let old = corporate_case()
            .with("due_on", "2023-01-31")
            .with("supplied_on", "2023-01-02");

        let individual = notices(&old.clone().with("creditor_type", "individual"));
        assert!(!individual.contains("소멸시효"), "{individual}");

        let sole = notices(
            &old.with("creditor_type", "sole_proprietor")
                .with("creditor_trade_name", "가나상회"),
        );
        assert!(sole.contains("소멸시효 3년이"), "{sole}");
    }

    #[test]
    fn an_unknown_document_is_its_own_error() {
        assert_eq!(
            draft_document("no-such-document", &Answers::new()).unwrap_err(),
            DraftError::UnknownDocument
        );
        assert!(form_of("no-such-document").is_none());
    }
}
