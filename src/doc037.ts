// guide/doc-037.md "## 출력 템플릿" (근로계약서), compiled by
// hand. Wording is the guide's, character for character; only the line wraps
// inside a paragraph are joined (with one space, except after "·" and inside the
// broken word "원\n을", which are joined with none). Branch labels in
// parentheses are kept as `tag`s so the template can be printed back verbatim.

import type { Block, Inline, Line, Template } from "./types";

const s = (slot: string, label: string): Inline => ({ slot, label });
const tag = (text: string): Inline => ({ tag: text });
const ref = (clause: string): Inline => ({ ref: clause });
const L = (indent: number, ...text: Inline[]): Line => ({ indent, text });
const alt = (choice: string, variants: Record<string, Block[]>): Block => ({ choice, variants });
const inl = (choice: string, variants: Record<string, Inline[]>): Inline => ({ choice, variants });

const won = (id: string, label: string) => ({ id, label, kind: "money" as const });

export const DOC037: Template = {
  id: "doc-037",
  trigger: "근로계약서",
  title: "근 로 계 약 서",
  slots: [
    { id: "employer_name", label: "사용자 명칭", kind: "party" },
    { id: "worker_name", label: "근로자명", kind: "person" },
    { id: "start_date", label: "근무 시작일", kind: "date" },
    { id: "end_date", label: "종료일", kind: "date", from: "start_date" },
    { id: "probation_period", label: "수습·시용 기간", kind: "period" },
    { id: "probation_pay", label: "수습 중 급여 비율", kind: "percent", unit: "%", range: [1, 100] },
    { id: "team", label: "소속팀", kind: "text" },
    { id: "rank", label: "직급", kind: "text" },
    { id: "duties", label: "업무 내용", kind: "text" },
    {
      id: "workplace",
      label: "근무장소",
      kind: "text",
      derive: { op: "copy", from: "employer_addr", note: "사용자 주소와 같음", source: "7단계 질문 2: 근무장소는 사용자 주소와 같습니까, 다릅니까? (다르면 실제 근무지 입력)" },
    },
    { id: "work_hours", label: "시업~종업", kind: "time_range" },
    { id: "break_time", label: "휴게 시각", kind: "time_range" },
    { id: "day_hours_1", label: "요일별 근무시간 1", kind: "text" },
    { id: "day_hours_2", label: "요일별 근무시간 2", kind: "text" },
    { id: "elastic_weeks", label: "탄력 단위기간(주)", kind: "count", unit: "주", range: [1, 52] },
    { id: "sel_daily", label: "1일 근로시간", kind: "count", unit: "시간", range: [1, 24] },
    { id: "sel_from", label: "선택 시간대 시작", kind: "time" },
    { id: "sel_to", label: "선택 시간대 종료", kind: "time" },
    { id: "sel_weekly", label: "정산 평균 주 시간", kind: "count", unit: "시간", range: [1, 168] },
    { id: "core_band", label: "의무근로시간대", kind: "time_range" },
    { id: "deemed_daily", label: "간주 1일 시간", kind: "count", unit: "시간", range: [1, 24] },
    { id: "workdays", label: "근무일", kind: "weekday", named: { 월화수목금: "평일(월~금)", 월화수목금토: "월~토" } },
    { id: "weekly_holiday", label: "유급 주휴일", kind: "weekday" },
    { id: "custom_leave", label: "연차 약정 내용", kind: "text" },
    {
      ...won("salary", "연봉액"),
      derive: {
        op: "sum",
        of: ["base_pay", "ot_pay", "bonus", "meal", "transport", "other_pay"],
        need: "base_pay",
        times: 12,
        note: "월 항목 합계 × 12",
        source: "제9조 ① 구성항목 합계액, ⑥ 연봉의 1/12; 8단계 도움말: 항목별 입력 시 연봉이 자동 합산된다",
      },
    },
    {
      ...won("base_pay", "기본급"),
      derive: {
        op: "share",
        total: "salary",
        divisor: 12,
        minus: ["ot_pay", "bonus", "meal", "transport", "other_pay"],
        note: "연봉의 1/12 − 다른 월 항목",
        source: "제9조 ⑥ 연봉의 1/12; 8단계 도움말: 연봉 입력 시 하단 월 기본급이 자동 환산되고",
      },
    },
    won("ot_pay", "고정 시간 외 수당"),
    {
      id: "ot_hours",
      label: "고정OT 포함 시간",
      kind: "count",
      unit: "시간",
      range: [1, 200],
      derive: { op: "ratio", num: "ot_pay", den: "hourly", factor: 1.5, note: "고정 시간 외 수당 ÷ (통상시급 × 1.5)", source: "제9조 ④ 「고정 시간 외 수당 ÷ (통상시급 × 1.5)」로 산정한다" },
    },
    won("bonus", "상여금(월)"),
    won("meal", "식대(월)"),
    won("transport", "교통비(월)"),
    { id: "other_name", label: "기타 수당명", kind: "text" },
    won("other_pay", "기타 수당(월)"),
    won("hourly", "통상시급"),
    won("hourly_add", "추가 근로 가산액"),
    { id: "perf_cond", label: "업무성과 조건", kind: "text" },
    { id: "perf_due", label: "업무성과 기한", kind: "text" },
    { id: "perf_pay", label: "업무성과 금액/내용", kind: "text" },
    { id: "tenure_cond", label: "장기근속 조건", kind: "text" },
    { id: "tenure_due", label: "장기근속 기한", kind: "text" },
    { id: "tenure_pay", label: "장기근속 금액/내용", kind: "text" },
    { id: "other_incentive", label: "기타 인센티브 내용", kind: "text" },
    { id: "pay_day", label: "임금 지급일", kind: "count", unit: "일", range: [1, 31] },
    { id: "bank", label: "은행", kind: "text", unit: "은행" },
    { id: "account", label: "계좌번호", kind: "text" },
    { id: "written_date", label: "작성일자", kind: "date" },
    { id: "rep_name", label: "대표자명", kind: "person" },
    { id: "employer_id", label: "사용자 주민등록번호", kind: "text" },
    { id: "employer_addr", label: "사용자 주소", kind: "text" },
    { id: "employer_phone", label: "사용자 전화번호", kind: "text" },
    { id: "worker_id", label: "근로자 주민등록번호", kind: "text" },
    { id: "worker_addr", label: "근로자 주소", kind: "text" },
    { id: "worker_phone", label: "근로자 전화번호", kind: "text" },
  ],
  choices: [
    { id: "employment", label: "고용형태", options: [{ key: "regular", label: "정규직" }, { key: "fixed", label: "기간제" }] },
    { id: "renewal", label: "갱신 약정", options: [{ key: "yes", label: "갱신 약정함" }, { key: "no", label: "갱신 약정 안 함" }] },
    { id: "probation", label: "수습·시용", options: [{ key: "probation", label: "수습" }, { key: "trial", label: "시용" }, { key: "none", label: "적용 안 함" }] },
    {
      id: "trial_custom",
      label: "시용 3~6개월 직접입력형",
      options: [{ key: "on", label: "직접입력형" }, { key: "off", label: "1~3개월형" }],
      auto: { slot: "probation_period", test: { op: "monthsAbove", value: 3 }, then: "on", else: "off", source: "3단계 질문 2: ① 1개월 ② 2개월 ③ 3개월 ④ 3~6개월(직접입력)" },
    },
    {
      id: "hours",
      label: "근로시간 유형",
      options: [
        { key: "fixed", label: "일정" },
        { key: "varied", label: "시간만 다름" },
        { key: "elastic", label: "탄력적" },
        { key: "selective", label: "선택적" },
        { key: "deemed", label: "간주" },
        { key: "discretion", label: "재량" },
      ],
    },
    { id: "core_time", label: "의무근로시간", options: [{ key: "none", label: "미적용" }, { key: "set", label: "적용" }] },
    { id: "deemed_method", label: "간주 산정 방법", options: [{ key: "contract", label: "소정근로시간" }, { key: "usual", label: "통상 필요시간" }, { key: "agreed", label: "노사 서면합의" }] },
    { id: "annual_leave", label: "연차휴가", options: [{ key: "statutory", label: "근로기준법·내부규정" }, { key: "custom", label: "직접 입력" }] },
    { id: "unused_leave", label: "미사용 연차", options: [{ key: "either", label: "이월/수당 선택형" }, { key: "pay", label: "수당 지급형" }] },
    { id: "comp", label: "연장·야간·휴일 보상", options: [{ key: "allowance", label: "수당만" }, { key: "leave", label: "보상휴가제" }] },
    { id: "fixed_ot", label: "고정OT", options: [{ key: "on", label: "적용" }, { key: "off", label: "적용 안 함" }] },
    { id: "show_hourly", label: "시급 표시", options: [{ key: "on", label: "표시" }, { key: "off", label: "표시 안 함" }] },
    { id: "e_delivery", label: "전자교부", options: [{ key: "on", label: "선택" }, { key: "off", label: "선택 안 함" }] },
    {
      id: "employer_type",
      label: "사용자 유형",
      options: [{ key: "corp", label: "법인" }, { key: "sole", label: "개인사업자" }, { key: "person", label: "개인" }],
      auto: { slot: "employer_name", test: { op: "matches", pattern: "주식회사|유한회사|합자회사|합명회사|유한책임회사|사단법인|재단법인|\\(주\\)|㈜|\\(유\\)" }, then: "corp", source: "1단계 도움말: 회사명이면 법인" },
    },
  ],
  preamble: [
    L(
      0,
      s("employer_name", "사용자 명칭"),
      " (이하 '사용자' 또는 '갑')과(와) ",
      s("worker_name", "근로자명"),
      " (이하 '근로자' 또는 '을')은 상호 자유의사에 따라 아래와 같이 근로계약(이하 '본 계약')을 체결하고, 신의에 좇아 성실히 이행할 것을 약정한다.",
    ),
    L(0, "- 다 음 -"),
  ],
  clauses: [
    {
      id: "purpose",
      heading: ["(목적)"],
      body: [L(1, "본 계약은 갑이 정한 업무를 갑이 정한 장소에서 을이 수행하고 갑이 그 대가를 지급함에 있어, 양 당사자의 권리·의무와 제반사항을 분명히 정함을 목적으로 한다.")],
    },
    {
      id: "term",
      heading: ["(계약기간)"],
      body: [
        alt("employment", {
          regular: [L(1, tag("(정규직인 경우) "), "을의 근무는 ", s("start_date", "근무 시작일"), "부터 개시하며, 계약기간은 따로 정하지 아니한다.")],
          fixed: [
            L(1, tag("(기간제인 경우)")),
            L(2, "① 계약기간은 ", s("start_date", "시작일"), "부터 ", s("end_date", "종료일"), "까지로 한다."),
            alt("renewal", {
              yes: [L(2, "② ", tag("(갱신 약정 시) "), "갑과 을은 만료 60일 전까지 서면(전자서면 포함) 또는 구두로 연장 의사를 표시할 수 있으며, 상대방이 이를 승낙하면 별도 합의가 없는 한 동일한 조건으로 계약이 연장된다.")],
            }),
          ],
        }),
      ],
    },
    {
      id: "probation",
      heading: ["(수습 / 시용 규정) ", tag("(적용하는 경우)")],
      when: { choice: "probation", not: "none" },
      body: [
        alt("probation", {
          probation: [
            L(1, tag("(수습 적용 시)")),
            L(2, "갑과 을은 계약 체결일부터 ", s("probation_period", "N개월"), "을 수습기간으로 하고, 이 기간 동안 갑은 을에게 본 계약에서 정한 급여의 ", s("probation_pay", "N"), "%를 지급한다."),
          ],
          trial: [
            L(1, tag("(시용 적용 시)")),
            L(2, "① 갑과 을은 계약 체결일부터 ", s("probation_period", "N개월"), "을 시용기간으로 한다."),
            L(
              2,
              "② 시용기간 중 을이 보인 업무수행 능력이 이력서·경력 등으로 기대되는 수준에 미치지 못함이 확인되면, 갑은 ",
              inl("trial_custom", { on: [tag("(3~6개월 직접입력형의 경우) "), "시용기간 만료 30일 전까지 종료를 통보하여 "] }),
              "시용기간 종료와 동시에 근로관계를 종료할 수 있다.",
            ),
          ],
        }),
      ],
    },
    {
      id: "duties",
      heading: ["(업무 내용)"],
      body: [
        L(1, "① 을의 소속팀은 ", s("team", "소속팀"), ", 직급은 ", s("rank", "직급"), "으로 한다."),
        L(1, "② 을의 업무는 ", s("duties", "업무 내용"), "으로 한다."),
        L(1, "③ 갑은 필요하다고 인정하는 경우 을의 의견을 들어 업무 내용을 조정할 수 있다."),
      ],
    },
    {
      id: "place",
      heading: ["(근무장소)"],
      body: [
        L(1, "① 근무장소는 ", s("workplace", "근무장소"), "로 한다."),
        L(1, "② 회사 소재지 이전 등 운영상 필요한 경우 갑은 근무장소를 변경할 수 있다. 다만 을의 업무상 사유로 변경하는 경우에는 을의 의견을 고려한다."),
      ],
    },
    {
      id: "hours",
      heading: ["(근로시간 및 휴게시간)"],
      body: [
        alt("hours", {
          fixed: [
            L(1, tag("(근무시간이 일정한 경우)")),
            L(2, "① 근무시간은 ", s("work_hours", "시업~종업"), "으로 한다."),
            L(2, "② 휴게시간은 ", s("break_time", "휴게 시각"), "으로 한다."),
            L(2, "③ 주간 근무를 원칙으로 한다."),
            L(2, "④ 갑은 필요한 경우 을과 합의하여 1주 12시간 한도로 근로시간을 연장할 수 있으며, 필요 시 을과 합의하여 근로시간을 변경할 수 있다."),
          ],
          varied: [
            L(1, tag("(근무시간만 다른 경우)")),
            L(2, "① 근무시간은 다음과 같다."),
            L(3, "1. ", s("day_hours_1", "요일별 근무시간 1")),
            L(3, "2. ", s("day_hours_2", "요일별 근무시간 2")),
            L(2, "② 휴게시간은 ", s("break_time", "휴게 시각"), "으로 하며, 제3·4항은 위와 같다."),
          ],
          elastic: [
            L(1, tag("(탄력적 근로시간제인 경우)")),
            L(2, "① 탄력근무제의 단위기간은 ", s("elastic_weeks", "N"), "주로 한다."),
            L(2, "② 단위기간 중 1일 근로시간·시업·종업·휴게시간은 별도 근무표에 따른다."),
          ],
          selective: [
            L(1, tag("(선택적 근로시간제인 경우)")),
            L(2, "① 총 근로시간은 「1일 ", s("sel_daily", "N"), "시간 × 해당 월 소정근로일수(휴일·휴무일 제외)」로 한다."),
            L(2, "② 근로시간대는 ", s("sel_from", "시작"), "부터 ", s("sel_to", "종료"), "까지 중 을의 선택으로 출퇴근하며, 정산기간 평균 주 ", s("sel_weekly", "N"), "시간을 넘지 않는 범위에서 근로일·근로시간을 조절한다."),
            L(
              2,
              "③ ",
              inl("core_time", {
                none: [tag("(의무근로시간 미적용) "), "휴게시간은 별도 근무표에 따른다."],
                set: [tag("(의무근로시간 적용) "), "의무근로시간대는 ", s("core_band", "시간대"), "로 하고, 휴게시간은 근무표에 따른다."],
              }),
            ),
          ],
          deemed: [
            L(1, tag("(사업장 밖 간주근로시간제인 경우)")),
            L(2, "① 을이 업무상 사업장 밖에서 근로하여 근로시간 산정이 어려운 경우,"),
            alt("deemed_method", {
              contract: [L(3, "- ", tag("(소정근로시간으로 봄) "), "휴게시간을 제외하고 1일 ", s("deemed_daily", "N"), "시간을 근로한 것으로 본다.")],
              usual: [L(3, "- ", tag("(통상 필요시간으로 봄) "), "그 업무수행에 통상 필요한 시간을 근로한 것으로 본다.")],
              agreed: [L(3, "- ", tag("(노사 서면합의 시간으로 봄) "), "노사 서면합의에서 정한 시간을 근로시간으로 본다.")],
            }),
            L(2, "② 휴게시간은 취업규칙에 따르되, 정해진 휴게가 어려우면 별도 시간대에 부여한다."),
          ],
          discretion: [
            L(1, tag("(재량근로시간제인 경우)")),
            L(2, "① 을의 근무시간은 노사합의에서 정한 시간을 근로한 것으로 본다."),
            L(2, "② 휴게·휴일·휴가는 취업규칙에 따른다."),
          ],
        }),
      ],
    },
    {
      id: "days",
      heading: ["(근무일 및 유급휴일)"],
      body: [
        L(1, "① 근무일은 ", s("workdays", "평일(월~금) / 월~토 / 직접입력 요일"), "로 한다."),
        L(1, "② 유급휴일은 아래와 같다. 다만 근로자의 날을 제외한 유급휴일은 근로자대표와 서면합의한 경우 특정 근로일로 대체할 수 있다."),
        L(2, "1. 유급 주휴일: ", s("weekly_holiday", "지정 요일")),
        L(2, "2. 다음 각 목의 어느 하나에 해당하는 날"),
        L(3, "가. 근로자의 날(5월 1일)"),
        L(3, "나. 법정공휴일 및 대체공휴일"),
        L(3, "다. 그 밖에 정부 또는 회사가 임시로 지정한 날"),
      ],
    },
    {
      id: "leave",
      heading: ["(휴가)"],
      body: [
        alt("annual_leave", {
          statutory: [
            L(1, tag("(근로기준법·내부규정에 따르는 경우)")),
            L(2, "① 휴가는 갑의 내부규정과 근로기준법에 따른다."),
            L(2, "② 갑의 귀책으로 을이 연차유급휴가를 사용하지 못한 경우, 당사자 합의로 연차를 이월하거나 수당으로 지급한다(근로기준법 제60조 제7항)."),
          ],
          custom: [
            L(1, tag("(직접 입력하는 경우)")),
            L(2, "① 갑은 을에게 다음과 같이 연차유급휴가를 부여한다. - ", s("custom_leave", "연차 약정 내용")),
            alt("unused_leave", {
              either: [L(2, tag("(이월/수당 선택형) "), "갑의 귀책으로 미사용한 연차는 당사자 합의로 처리한다.")],
              pay: [L(2, tag("(수당 지급형) "), "갑의 귀책으로 미사용한 연차는 당사자 합의로 수당으로 지급한다.")],
            }),
          ],
        }),
        alt("comp", {
          leave: [
            L(1, tag("(보상휴가제를 선택하는 경우)")),
            L(2, "갑은 을의 연장·야간·휴일 근로에 대하여 임금 지급에 갈음하여 보상휴가를 부여할 수 있고, 그 시행을 위해 갑과 근로자대표가 서면합의한다."),
          ],
        }),
      ],
    },
    {
      id: "wage",
      heading: ["(임금)"],
      body: [
        L(1, "① 을의 연간 임금(연봉)은 구성항목 합계액인 금 ", s("salary", "연봉액"), "원으로 하며, 월 분할 내역은 아래와 같다."),
        L(2, "1. 기본급(월): 금 ", s("base_pay", "기본급"), "원"),
        alt("fixed_ot", { on: [L(2, "2. ", tag("(고정OT 적용 시) "), "고정 시간 외 수당(월): 금 ", s("ot_pay", "금액"), "원 (약 ", s("ot_hours", "N"), "시간분)")] }),
        L(2, "3. 상여금(월): 금 ", s("bonus", "금액"), "원"),
        L(2, "4. 식대(월, 비과세): 금 ", s("meal", "금액"), "원"),
        L(2, "5. 교통비(월): 금 ", s("transport", "금액"), "원"),
        L(2, "6. ", s("other_name", "기타 수당명"), "(월): 금 ", s("other_pay", "금액"), "원"),
        alt("show_hourly", {
          on: [L(2, "7. ", tag("(시급 표시 선택 시) "), "통상시급 약 ", s("hourly", "금액"), "원, 추가 근로수당은 통상시급에 약 ", s("hourly_add", "금액"), "원을 가산한다(연장·야간·휴일이 중복되면 중복분만큼 각각 가산).")],
        }),
        L(1, "② 인센티브가 있는 경우 갑은 연봉과 별도로 다음 조건에 따라 지급한다."),
        L(2, "1. 업무성과 인센티브: ", s("perf_cond", "조건"), " 충족 시 ", s("perf_due", "기한"), "까지 ", s("perf_pay", "금액/내용"), " 지급"),
        L(2, "2. 장기근속 인센티브: ", s("tenure_cond", "조건"), " 충족 시 ", s("tenure_due", "기한"), "까지 ", s("tenure_pay", "금액/내용"), " 지급"),
        L(2, "3. ", s("other_incentive", "기타 인센티브 내용")),
        L(
          1,
          "③ 실지급 임금은 제1항 연봉을 기준으로 하되, 시간 외 근무가 있는 경우 ",
          inl("comp", {
            allowance: [tag("(수당만 가능) "), "발생한 시간 외 수당을 가산하여 지급한다."],
            leave: [tag("(보상휴가제 선택) "), "을의 의견을 들어 시간 외 수당 금액 또는 그에 갈음하는 보상휴가로 지급한다."],
          }),
        ),
        alt("fixed_ot", {
          on: [L(1, "④ ", tag("(고정OT 적용 시) "), "고정 시간 외 수당은 월 약 ", s("ot_hours", "N"), "시간분을 포함하며, 「고정 시간 외 수당 ÷ (통상시급 × 1.5)」로 산정한다. 포함 시간을 초과한 근무는 사전 허가 후 별도 정산하고, 미달 근무 시에도 제1항 금액을 지급한다.")],
        }),
        L(1, "⑤ 퇴직금은 연봉에 포함하지 아니하며, 1년 이상 계속 근로한 경우 근로자퇴직급여 보장법에 따라 퇴직 시 수령하거나 퇴직연금제로 운영할 수 있다."),
        L(
          1,
          "⑥ 임금은 초일부터 말일까지 제공한 근로에 대하여 연봉의 1/12를 매월(또는 다음 달) ",
          s("pay_day", "N"),
          "일에 을 명의 계좌(",
          s("bank", "은행"),
          "은행, 계좌번호 ",
          s("account", "계좌번호"),
          ")로 직접 지급한다. 지급일이 휴일이면 직전 평일에 지급하고, 월중 입·퇴사 시에는 출근일을 일할 계산한다.",
        ),
      ],
    },
    {
      id: "payslip",
      heading: ["(임금명세서 교부)"],
      body: [L(1, "갑은 ", ref("wage"), "의 임금 지급일까지 을에게 임금명세서를 교부하며, 그 방식은 근로기준법 제48조에 따라 서면 또는 전자문서로 한다.")],
    },
    {
      id: "insurance",
      heading: ["(4대보험의 가입)"],
      body: [L(1, "갑은 을이 실제로 근로를 제공하는 날부터 을에 대하여 고용보험·산재보험·국민연금·건강보험을 적용한다.")],
    },
    {
      id: "termination",
      heading: ["(계약의 해지·해고·퇴직 등)"],
      body: [
        L(1, "① 계약기간 중 어느 한쪽이 해지를 원하면 갑과 을은 상호 신뢰를 토대로 협의하여 해지할 수 있다. 단, 을이 먼저 해지하려는 경우에는 적어도 30일 전에 해지를 예고(최고)하여야 한다."),
        L(1, "② 아래 어느 하나의 사유가 있을 때 갑과 을은 상당한 기간을 정해 시정을 요구할 수 있고, 그 기간이 지나도록 시정되지 않으면 본 계약을 해지할 수 있다."),
        L(2, "1. 을에게 신체적·정신적 장애가 생겨 본 계약상 근로제공 의무를 더는 기대하기 어려운 경우"),
        L(2, "2. 정당한 업무 지시나 명령을 을이 반복·계속 거부하여 근로관계를 이어가기 곤란해진 경우"),
        L(2, "3. 을이 일으킨 민사·형사상 분쟁으로 사용자의 신용이나 명예가 크게 훼손된 경우"),
        L(2, "4. 갑이 정당한 이유 없이 약정한 급여 등을 지급하지 않는 경우"),
        L(2, "5. 위 각 호에 준하여, 본 계약을 더 유지하기 어려운 중대한 사정이 있는 경우"),
        L(1, "③ 본 조에 따라 해지·해고·퇴직에 이른 을은 본 계약에서 정한 권리를 더 이상 행사할 수 없으며, 갑의 업무를 방해하거나 제한해서도 안 된다."),
        L(1, "④ 이 경우 을은 갑에게서 받은 자료와 자산, 업무 관련 정보 및 자료 일체를 지체 없이 돌려주어야 한다. 또한 퇴직 전의 직위나 보직을 대외적으로 내세울 수 없으며, 이를 어겨 갑에게 표현대리 책임 등 손해가 생기면 갑은 그 손해를 을에게 구상할 수 있다."),
        L(1, "⑤ 을은 회사의 명예를 떨어뜨리거나 회사에 재산상 손해를 끼치는 행위를 해서는 안 된다."),
        L(1, "⑥ 을은 관련 업무가 끊김 없이 이어지도록 인수인계를 분명히 하고, 그에 따르는 협조를 성실히 다하여야 한다."),
      ],
    },
    {
      id: "damages",
      heading: ["(손해배상)"],
      body: [L(1, "갑 또는 을이 본 계약을 위반하여 손해가 발생하면 그에 대한 배상 책임을 진다.")],
    },
    {
      id: "disputes",
      heading: ["(분쟁해결)"],
      body: [
        L(1, "① 본 계약의 해석에 이견이 있거나 명시되지 않은 사항은 대한민국 관계법령, 단체협약, 취업규칙에 따라 상호 협의하여 적극 해결한다."),
        L(1, "② 본 계약과 관련한 법적 분쟁의 제1심 관할법원은 갑의 주소지 관할법원으로 한다."),
      ],
    },
    {
      id: "effect",
      heading: ["(계약의 효력)"],
      body: [L(1, "본 계약은 체결 이전에 갑과 을이 문서 또는 구두로 합의한 사항을 대체하며, 입사자 서약서를 제외한 모든 부속 약정에 우선한다.")],
    },
    {
      id: "delivery",
      heading: ["(근로계약서의 교부 등)"],
      body: [
        L(1, "① 양 당사자는 본 계약 성립을 증명하기 위해 계약서를 작성·서명(기명날인)하고 각 1통씩 보관한다."),
        L(1, "② 전자서명으로 체결하는 경우 작성·서명·교부에 대한 전자적 방법의 효력을 인정하고 그 진행에 동의한 것으로 본다."),
        alt("e_delivery", { on: [L(1, "③ ", tag("(전자교부 선택 시) "), "갑은 합의한 전자적 방법으로 계약서를 교부하고, 을은 사본을 전자적 방법으로 교부받는 것에 동의한다.")] }),
      ],
    },
  ],
  closing: [
    L(0, s("written_date", "작성일자")),
    L(0, "사용자(갑)"),
    alt("employer_type", {
      corp: [L(1, tag("(법인인 경우)     "), "법인명: ", s("employer_name", "법인명"), " / 대표이사: ", s("rep_name", "대표자명"), " (서명 또는 인)")],
      sole: [L(1, tag("(개인사업자인 경우) "), "상호: ", s("employer_name", "상호"), " / 사업주명: ", s("rep_name", "대표자명"), " (서명 또는 인)")],
      person: [L(1, tag("(개인인 경우)     "), "성명: ", s("employer_name", "성명"), " (서명 또는 인) / 주민등록번호: ", s("employer_id", "주민등록번호"))],
    }),
    L(1, "주소: ", s("employer_addr", "주소"), "   전화번호: ", s("employer_phone", "전화번호")),
    L(0, "근로자(을)"),
    L(1, "성명: ", s("worker_name", "근로자명"), " (서명 또는 인)"),
    L(1, "주민등록번호: ", s("worker_id", "주민등록번호")),
    L(1, "주소: ", s("worker_addr", "주소"), "   전화번호: ", s("worker_phone", "전화번호")),
  ],
};
