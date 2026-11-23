// Throwaway spike check. Compares what the editor produced with the guide's own
// template text. The expected texts are built from guide/doc-037.md line by
// line, with explicit edits per scenario (drop the unchosen branch lines, cut
// the branch labels, renumber, put the values in the brackets in order). It
// does not read the editor's compiled data, so it is a second, independent
// reading of the guide.
//
//   node check.mjs           reads out/template.txt, out/film-final.txt, out/scenario2-final.txt

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dirname;
const guide = readFileSync(join(dir, "guide/doc-037.md"), "utf8");
export const GUIDE_TEMPLATE = guide.split("## 출력 템플릿")[1].split("```")[1];
const GUIDE_LINES = GUIDE_TEMPLATE.split("\n");

function find(lines, text, from = 0, unique = true) {
  const hits = lines.map((line, i) => (i >= from && line.includes(text) ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) throw new Error(`no line has ${JSON.stringify(text)}`);
  if (unique && hits.length > 1) throw new Error(`${hits.length} lines have ${JSON.stringify(text)}`);
  return hits[0];
}
const dropRange = (first, last) => (lines) => {
  const i = find(lines, first);
  const j = find(lines, last, i, false);
  return [...lines.slice(0, i), ...lines.slice(j + 1)];
};
const dropLine = (text) => dropRange(text, text);
const swap = (from, to) => (lines) => {
  const i = find(lines, from);
  lines[i] = lines[i].replace(from, to);
  return lines;
};
const cut = (text) => swap(text, "");

function fill(text, values) {
  let index = 0;
  const out = text.replace(/\[[^\]\n]+\]/g, (bracket) => {
    const [want, value] = values[index++] ?? [];
    if (want !== bracket) throw new Error(`bracket ${index}: guide has ${bracket}, check expected ${want}`);
    return value;
  });
  if (index !== values.length) throw new Error(`guide has ${index} brackets, check lists ${values.length}`);
  return out;
}

const build = (ops, values) => fill(ops.reduce((lines, op) => op(lines), [...GUIDE_LINES]).join("\n"), values);

// Scenario 1, the film: 기간제 with renewal, 시용 4개월 (직접입력형), fixed hours,
// statutory leave, allowance only, 고정OT on, hourly shown, 전자교부 on, 법인.
export const SCENARIO1 = () =>
  build(
    [
      dropRange("(정규직인 경우)", "아니한다."),
      cut("(기간제인 경우)"),
      cut("(갱신 약정 시) "),
      cut(" (적용하는 경우)"),
      dropRange("(수습 적용 시)", "본 계약에서 정한 급여의 [N]%를 지급한다."),
      cut("(시용 적용 시)"),
      cut("(3~6개월 직접입력형의 경우) "),
      cut("(근무시간이 일정한 경우)"),
      dropRange("(근무시간만 다른 경우)", "② 휴게·휴일·휴가는 취업규칙에 따른다."),
      cut("(근로기준법·내부규정에 따르는 경우)"),
      dropRange("(직접 입력하는 경우)", "그 시행을 위해 갑과 근로자대표가 서면합의한다."),
      swap("2. (고정OT 적용 시) ", "2. "),
      cut("(시급 표시 선택 시) "),
      cut("(수당만 가능) "),
      dropRange("(보상휴가제 선택)", "지급한다."),
      swap("④ (고정OT 적용 시) ", "④ "),
      cut("(전자교부 선택 시) "),
      cut("(법인인 경우)"),
      dropLine("(개인사업자인 경우)"),
      dropLine("(개인인 경우)"),
    ],
    [
      ["[사용자 명칭]", "주식회사 한빛테크"],
      ["[근로자명]", "김민준"],
      ["[시작일]", "2027년 3월 1일"],
      ["[종료일]", "2028년 2월 29일"],
      ["[N개월]", "4개월"],
      ["[소속팀]", "개발팀"],
      ["[직급]", "선임"],
      ["[업무 내용]", "웹 서비스 기획 및 운영"],
      ["[근무장소]", "서울특별시 강남구 테헤란로 123"],
      ["[시업~종업]", "09:00~18:00"],
      ["[휴게 시각]", "12:00~13:00"],
      ["[평일(월~금) / 월~토 / 직접입력 요일]", "평일(월~금)"],
      ["[지정 요일]", "일요일"],
      ["[연봉액]", "36,000,000"],
      ["[기본급]", "2,100,000"],
      ["[금액]", "300,000"],
      ["[N]", "17"],
      ["[금액]", "200,000"],
      ["[금액]", "200,000"],
      ["[금액]", "100,000"],
      ["[기타 수당명]", "직책수당"],
      ["[금액]", "100,000"],
      ["[금액]", "12,000"],
      ["[금액]", "6,000"],
      ["[조건]", "연간 목표 달성"],
      ["[기한]", "다음 해 1월 말일"],
      ["[금액/내용]", "기본급의 100%"],
      ["[조건]", "3년 근속"],
      ["[기한]", "근속 3년이 되는 달의 말일"],
      ["[금액/내용]", "100만 원"],
      ["[기타 인센티브 내용]", "없음"],
      ["[N]", "17"],
      ["[N]", "10"],
      ["[은행]", "국민"],
      ["[계좌번호]", "123-456-789012"],
      ["[작성일자]", "2026년 11월 20일"],
      ["[법인명]", "주식회사 한빛테크"],
      ["[대표자명]", "이서연"],
      ["[주소]", "서울특별시 강남구 테헤란로 123"],
      ["[전화번호]", "02-1234-5678"],
      ["[근로자명]", "김민준"],
      ["[주민등록번호]", "900101-1234567"],
      ["[주소]", "서울특별시 마포구 월드컵로 45"],
      ["[전화번호]", "010-1234-5678"],
    ],
  );

// Scenario 2: 정규직, no 수습/시용 (제3조 drops out, everything after renumbers),
// 선택적 근로시간제 with core hours, custom leave paid out, 보상휴가제, 고정OT off,
// hourly not shown, no 전자교부, 개인사업자.
export const SCENARIO2 = () => {
  const renumber = [];
  for (let n = 4; n <= 16; n++) renumber.push(swap(`제${n}조 (`, `제${n - 1}조 (`));
  return build(
    [
      cut("(정규직인 경우) "),
      dropRange("(기간제인 경우)", "동일한 조건으로 계약이 연장된다."),
      dropRange("제3조 (수습 / 시용 규정)", "전까지 종료를 통보하여 시용기간 종료와 동시에 근로관계를 종료할 수 있다."),
      ...renumber,
      swap("제9조의 임금 지급일", "제8조의 임금 지급일"),
      dropRange("(근무시간이 일정한 경우)", "② 단위기간 중 1일 근로시간·시업·종업·휴게시간은 별도 근무표에 따른다."),
      cut("(선택적 근로시간제인 경우)"),
      swap("③ (의무근로시간 미적용) 휴게시간은 별도 근무표에 따른다.", "③"),
      cut("(의무근로시간 적용) "),
      dropRange("(사업장 밖 간주근로시간제인 경우)", "② 휴게·휴일·휴가는 취업규칙에 따른다."),
      dropRange("(근로기준법·내부규정에 따르는 경우)", "이월하거나 수당으로 지급한다(근로기준법 제60조 제7항)."),
      cut("(직접 입력하는 경우)"),
      dropLine("(이월/수당 선택형)"),
      cut("(수당 지급형) "),
      cut("(보상휴가제를 선택하는 경우)"),
      dropLine("2. (고정OT 적용 시)"),
      swap("3. 상여금", "2. 상여금"),
      swap("4. 식대", "3. 식대"),
      swap("5. 교통비", "4. 교통비"),
      swap("6. [기타 수당명]", "5. [기타 수당명]"),
      dropRange("7. (시급 표시 선택 시)", "을 가산한다(연장·야간·휴일이 중복되면"),
      dropLine("(수당만 가능)"),
      cut("(보상휴가제 선택) "),
      dropRange("④ (고정OT 적용 시)", "사전 허가 후 별도 정산하고"),
      swap("⑤ 퇴직금", "④ 퇴직금"),
      swap("⑥ 임금은", "⑤ 임금은"),
      dropRange("③ (전자교부 선택 시)", "전자적 방법으로 교부받는 것에 동의한다."),
      dropLine("(법인인 경우)"),
      cut("(개인사업자인 경우)"),
      dropLine("(개인인 경우)"),
    ],
    [
      ["[사용자 명칭]", "한빛상사"],
      ["[근로자명]", "박지우"],
      ["[근무 시작일]", "2027년 1월 2일"],
      ["[소속팀]", "영업팀"],
      ["[직급]", "사원"],
      ["[업무 내용]", "고객 상담"],
      ["[근무장소]", "부산광역시 해운대구 센텀중앙로 79"],
      ["[N]", "8"],
      ["[시작]", "07:00"],
      ["[종료]", "22:00"],
      ["[N]", "40"],
      ["[시간대]", "10:00~16:00"],
      ["[평일(월~금) / 월~토 / 직접입력 요일]", "평일(월~금)"],
      ["[지정 요일]", "토요일"],
      ["[연차 약정 내용]", "입사일부터 1년간 15일"],
      ["[연봉액]", "33,000,000"],
      ["[기본급]", "2,500,000"],
      ["[금액]", "0"],
      ["[금액]", "200,000"],
      ["[금액]", "0"],
      ["[기타 수당명]", "자격수당"],
      ["[금액]", "50,000"],
      ["[조건]", "분기 목표 달성"],
      ["[기한]", "분기 종료 후 1개월"],
      ["[금액/내용]", "50만 원"],
      ["[조건]", "5년 근속"],
      ["[기한]", "근속 5년이 되는 달"],
      ["[금액/내용]", "200만 원"],
      ["[기타 인센티브 내용]", "없음"],
      ["[N]", "25"],
      ["[은행]", "신한"],
      ["[계좌번호]", "110-123-456789"],
      ["[작성일자]", "2026년 11월 20일"],
      ["[상호]", "한빛상사"],
      ["[대표자명]", "정하늘"],
      ["[주소]", "부산광역시 해운대구 센텀중앙로 79"],
      ["[전화번호]", "051-123-4567"],
      ["[근로자명]", "박지우"],
      ["[주민등록번호]", "950505-2345678"],
      ["[주소]", "부산광역시 수영구 광안해변로 100"],
      ["[전화번호]", "010-9876-5432"],
    ],
  );
};

/** Equal ignoring all whitespace: every character of the guide, in order, and nothing else. */
export function compare(name, expected, actual) {
  const strip = (s) => s.replace(/\s+/g, "");
  const a = strip(expected);
  const b = strip(actual);
  let first = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      first = i;
      break;
    }
  }
  return {
    name,
    equal: first === -1,
    chars: { expected: a.length, actual: b.length },
    firstDifference: first === -1 ? null : { at: first, expected: a.slice(Math.max(0, first - 30), first + 30), actual: b.slice(Math.max(0, first - 30), first + 30) },
    spacing: spacingDiff(expected, actual),
  };
}

/**
 * Where the two texts put a space differently between the same two characters,
 * counting a line break as a space. These are the line wraps the compile joined
 * without a space, and nothing else should show up here.
 */
function spacingDiff(expected, actual) {
  const marks = (s) => {
    const out = [];
    let gap = false;
    for (const ch of s) {
      if (/\s/.test(ch)) gap = true;
      else {
        out.push({ ch, gap });
        gap = false;
      }
    }
    return out;
  };
  const a = marks(expected);
  const b = marks(actual);
  const diffs = [];
  for (let i = 1; i < Math.min(a.length, b.length); i++) {
    if (a[i].ch !== b[i].ch) break;
    if (a[i].gap !== b[i].gap) {
      const around = (list) => list.slice(Math.max(0, i - 8), i + 8).map((m, k) => (k === Math.min(8, i) && m.gap ? " " : "") + m.ch).join("");
      diffs.push({ guide: around(a), editor: around(b) });
    }
  }
  return diffs;
}

if (process.argv[1] === import.meta.filename) {
  const out = join(dir, "out");
  const results = [];
  const read = (file) => (existsSync(join(out, file)) ? readFileSync(join(out, file), "utf8") : null);
  const template = read("template.txt");
  if (template) results.push(compare("template round trip: every branch and label, blanks as [label]", GUIDE_TEMPLATE, template));
  const film = read("film-final.txt");
  if (film) results.push(compare("scenario 1 (the film): finished document on screen", SCENARIO1(), film));
  const second = read("scenario2-final.txt");
  if (second) results.push(compare("scenario 2: finished document on screen", SCENARIO2(), second));
  for (const name of ["film-final.txt", "scenario2-final.txt"]) {
    const final = read(name.replace("-final", "-render"));
    if (final && read(name)) results.push({ ...compare(`${name}: on-screen text equals the renderer's final text`, read(name.replace("-final", "-render")), read(name)), spacing: undefined });
  }
  writeFileSync(join(out, "check.json"), JSON.stringify(results, null, 2));
  for (const r of results) {
    console.log(`${r.equal ? "PASS" : "FAIL"}  ${r.name}  (${r.chars.actual}/${r.chars.expected} chars)`);
    if (r.firstDifference) console.log("   first difference:", JSON.stringify(r.firstDifference));
    for (const d of r.spacing ?? []) console.log(`   spacing: guide ${JSON.stringify(d.guide)} · editor ${JSON.stringify(d.editor)}`);
  }
  if (results.some((r) => !r.equal)) process.exitCode = 1;
}
