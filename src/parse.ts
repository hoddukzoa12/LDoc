// Reads loose input per blank kind, deterministically.
// Anything not matched in full is refused: never a partial or guessed read.

import type { Slot } from "./types";

export type YMD = { y: number; m: number; d: number };
export type Parsed = { ok: true; text: string; note?: string; months?: number } | { ok: false; reason: string; pending?: boolean };
export type ParseCtx = { today: YMD; date: (slotId: string) => YMD | null };

const ok = (text: string, note?: string, months?: number): Parsed => ({ ok: true, text, note, months });
const no = (reason: string): Parsed => ({ ok: false, reason });

export function parseSlot(slot: Slot, raw: string, ctx: ParseCtx): Parsed {
  const input = raw.replace(/\s+/g, " ").trim();
  if (!input) return no("비어 있음");
  switch (slot.kind) {
    case "date":
      return parseDateInput(input, ctx.today, slot.from ? ctx.date(slot.from) : undefined);
    case "period":
      return parsePeriodSlot(input);
    case "money":
      return parseMoney(input);
    case "time_range":
      return parseTimeRange(input);
    case "time": {
      const time = parseTime(input.replace(/\s/g, ""));
      return time ? ok(fmtTime(time.h, time.min)) : no("시각으로 읽을 수 없음");
    }
    case "weekday":
      return parseWeekday(input, slot.named);
    case "count":
      return parseCount(input, slot);
    case "percent":
      return parsePercent(input, slot);
    case "person":
      return /\d/.test(input) ? no("이름에 숫자가 있음") : ok(input);
    case "party":
      return ok(input);
    case "text":
      return ok(slot.unit && input.endsWith(slot.unit) && input.length > slot.unit.length ? input.slice(0, -slot.unit.length).trim() : input);
  }
}

// ---- dates ----------------------------------------------------------------

export function fmtDate(date: YMD) {
  return `${date.y}년 ${date.m}월 ${date.d}일`;
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const valid = (date: YMD) => date.m >= 1 && date.m <= 12 && date.d >= 1 && date.d <= daysIn(date.y, date.m);
const serial = (date: YMD) => Date.UTC(date.y, date.m - 1, date.d);
function fromSerial(ms: number): YMD {
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
const addDays = (date: YMD, days: number) => fromSerial(serial(date) + days * 86_400_000);

/** The day a period that starts on `start` ends: the day before the matching day, or the month's last day when there is none. */
export function periodEnd(start: YMD, months: number, days = 0): YMD {
  if (days) return addDays(start, days - 1);
  const total = start.m - 1 + months;
  const y = start.y + Math.floor(total / 12);
  const m = (total % 12) + 1;
  if (start.d > daysIn(y, m)) return { y, m, d: daysIn(y, m) };
  return addDays({ y, m, d: start.d }, -1);
}

const YEAR_WORDS: Record<string, number> = { 올해: 0, 금년: 0, 내년: 1, 명년: 1, 후년: 2, 내후년: 2 };
const MONTH_WORDS: Record<string, number> = { 이번: 0, 이번달: 0, 다음: 1, 다음달: 1, 내달: 1, 다다음: 2, 다다음달: 2 };

export function parseDateInput(input: string, today: YMD, from?: YMD | null): Parsed {
  const s = input.replace(/\s+/g, " ").trim();
  const words: Record<string, number> = { 오늘: 0, 금일: 0, 내일: 1, 모레: 2 };
  if (s in words) return ok(fmtDate(addDays(today, words[s])), s === "오늘" ? undefined : `오늘 + ${words[s]}일`);

  let m = s.match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?$/) ?? s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const date = { y: +m[1], m: +m[2], d: +m[3] };
    return valid(date) ? ok(fmtDate(date)) : no("없는 날짜");
  }

  m = s.match(/^(?:(올해|금년|내년|명년|후년|내후년)\s*)?(\d{1,2})\s*(?:[./\-]|월\s*)(\d{1,2})\s*일?\.?$/);
  if (m) {
    const month = +m[2];
    const day = +m[3];
    if (m[1]) {
      const date = { y: today.y + YEAR_WORDS[m[1]], m: month, d: day };
      return valid(date) ? ok(fmtDate(date)) : no("없는 날짜");
    }
    // No year: the next such day on or after today (or after the start date, for an end date).
    const floor = from ?? today;
    let date = { y: floor.y, m: month, d: day };
    if (!valid({ ...date, y: 2028 })) return no("없는 날짜");
    while (!valid(date) || serial(date) < serial(floor) + (from ? 1 : 0)) date = { ...date, y: date.y + 1 };
    return ok(fmtDate(date), `연도가 없어 ${from ? "시작일" : "오늘"} 뒤 첫 ${month}월 ${day}일로 봄`);
  }

  m = s.match(/^(이번|다음|다다음|내)\s*달\s*(\d{1,2})\s*일$/);
  if (m) {
    const shift = MONTH_WORDS[m[1] === "내" ? "내달" : m[1]];
    const total = today.m - 1 + shift;
    const date = { y: today.y + Math.floor(total / 12), m: (total % 12) + 1, d: +m[2] };
    return valid(date) ? ok(fmtDate(date)) : no("없는 날짜");
  }

  const period = readPeriod(s);
  if (period) {
    if (from === undefined) return no("기간은 이 칸에서 날짜가 되지 않음");
    if (from === null) return { ok: false, reason: `시작일을 넣으면 시작일 + ${s} − 1일이 됩니다`, pending: true };
    const end = periodEnd(from, period.months, period.days);
    return ok(fmtDate(end), `시작일 + ${s} − 1일`, period.days ? undefined : period.months);
  }
  return no("날짜로 읽을 수 없음");
}

// ---- periods --------------------------------------------------------------

const NATIVE: Record<string, number> = { 한: 1, 두: 2, 세: 3, 석: 3, 네: 4, 넉: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12 };

/** Months (or days, for "N일"/"N주") a whole input names, or null. */
export function readPeriod(input: string): { months: number; days: number } | null {
  const s = input.replace(/\s+/g, "");
  let m = s.match(/^(\d+)년(?:(\d+)(?:개월|달)|반)?$/);
  if (m) return { months: +m[1] * 12 + (s.endsWith("반") ? 6 : m[2] ? +m[2] : 0), days: 0 };
  m = s.match(/^(\d+)(?:개월|달)$/);
  if (m) return { months: +m[1], days: 0 };
  m = s.match(/^(한|두|세|석|네|넉|다섯|여섯|일곱|여덟|아홉|열|열한|열두)달$/);
  if (m) return { months: NATIVE[m[1]], days: 0 };
  if (s === "반년") return { months: 6, days: 0 };
  m = s.match(/^(\d+)주$/);
  if (m) return { months: 0, days: +m[1] * 7 };
  return null;
}

function parsePeriodSlot(input: string): Parsed {
  const bare = input.match(/^(\d+)$/);
  const period = bare ? { months: +bare[1], days: 0 } : readPeriod(input);
  if (!period || period.days || period.months < 1) return no("개월 수로 읽을 수 없음");
  return ok(`${period.months}개월`, bare ? "숫자만 적어 개월로 봄" : undefined, period.months);
}

// ---- money ----------------------------------------------------------------

const HANGUL_DIGIT: Record<string, number> = { 영: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const SMALL: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
const BIG: Record<string, number> = { 만: 1e4, 억: 1e8, 조: 1e12 };

export function koreanNumber(input: string): number | null {
  const s = input.replace(/[\s,]/g, "");
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const tokens = s.match(/\d+(?:\.\d+)?|[영일이삼사오육칠팔구]|[십백천]|[만억조]/g);
  if (!tokens || tokens.join("") !== s) return null;
  let total = 0;
  let section = 0;
  let current: number | null = null;
  for (const token of tokens) {
    if (token in SMALL) {
      section += (current ?? 1) * SMALL[token];
      current = null;
    } else if (token in BIG) {
      section += current ?? 0;
      total += (section || 1) * BIG[token];
      section = 0;
      current = null;
    } else {
      if (current !== null) return null;
      current = token in HANGUL_DIGIT ? HANGUL_DIGIT[token] : Number(token);
    }
  }
  return total + section + (current ?? 0);
}

function parseMoney(input: string): Parsed {
  const s = input.replace(/\s/g, "").replace(/^금/, "").replace(/원정?$/, "");
  const value = koreanNumber(s);
  if (value === null || !Number.isInteger(value) || value < 0) return no("금액으로 읽을 수 없음");
  return ok(value.toLocaleString("en-US"));
}

// ---- times ----------------------------------------------------------------

function parseTime(input: string): { h: number; min: number; meridiem?: "am" | "pm" } | null {
  const m = input.match(/^(오전|오후|낮|밤|저녁|새벽)?(\d{1,2})(?::(\d{2})|시(?:(\d{1,2})분|(반))?)?$/);
  if (!m) return null;
  let h = +m[2];
  const min = m[3] ? +m[3] : m[4] ? +m[4] : m[5] ? 30 : 0;
  const pm = m[1] === "오후" || m[1] === "저녁" || m[1] === "밤";
  if (pm && h < 12) h += 12;
  if (h > 24 || min > 59) return null;
  return { h, min, meridiem: m[1] ? (pm ? "pm" : "am") : undefined };
}

const fmtTime = (h: number, min: number) => `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

function parseTimeRange(input: string): Parsed {
  const s = input.replace(/\s/g, "");
  const m = s.match(/^(.+?)(?:~|-|–|〜|부터)(.+?)(?:까지)?$/);
  if (!m) return no("시작~끝 시각으로 읽을 수 없음");
  const a = parseTime(m[1]);
  const b = parseTime(m[2]);
  if (!a || !b) return no("시각으로 읽을 수 없음");
  let note: string | undefined;
  if (!b.meridiem && b.h * 60 + b.min <= a.h * 60 + a.min && b.h < 12) {
    b.h += 12;
    note = `끝 시각이 시작보다 일러 오후 ${b.h - 12}시로 봄`;
  }
  if (b.h * 60 + b.min <= a.h * 60 + a.min) return no("끝 시각이 시작보다 이르거나 같음");
  return ok(`${fmtTime(a.h, a.min)}~${fmtTime(b.h, b.min)}`, note);
}

// ---- weekdays -------------------------------------------------------------

const DAYS = "월화수목금토일";

function parseWeekday(input: string, named?: Record<string, string>): Parsed {
  const s = input.replace(/\s/g, "").replace(/요일/g, "");
  const aliases: Record<string, string> = { 평일: "월화수목금", 주5일: "월화수목금", 주6일: "월화수목금토", 매일: DAYS, 주7일: DAYS };
  for (const [days, name] of Object.entries(named ?? {})) aliases[name.replace(/\s/g, "")] = days;
  let days: string | null = aliases[s] ?? null;
  const range = s.match(/^([월화수목금토일])[~\-–〜]([월화수목금토일])$/);
  if (!days && range) {
    const a = DAYS.indexOf(range[1]);
    const b = DAYS.indexOf(range[2]);
    if (b <= a) return no("요일 범위가 거꾸로임");
    days = DAYS.slice(a, b + 1);
  }
  if (!days && /^[월화수목금토일]([,·/]?[월화수목금토일])*$/.test(s)) {
    const set = new Set(s.replace(/[,·/]/g, ""));
    days = [...DAYS].filter((day) => set.has(day)).join("");
    if (days.length !== s.replace(/[,·/]/g, "").length) return no("같은 요일이 두 번 있음");
  }
  if (!days || !/^[월화수목금토일]+$/.test(days)) return no("요일로 읽을 수 없음");
  if (named?.[days]) return ok(named[days]);
  if (days.length === 1) return ok(`${days}요일`);
  if (DAYS.includes(days) && days.length >= 3) return ok(`${days[0]}~${days[days.length - 1]}`);
  return ok([...days].map((day) => `${day}요일`).join("·"));
}

// ---- counts and percents --------------------------------------------------

function inRange(value: number, slot: Slot) {
  return !slot.range || (value >= slot.range[0] && value <= slot.range[1]);
}

function parseCount(input: string, slot: Slot): Parsed {
  let s = input.replace(/\s/g, "").replace(/^(매월|매달|매주)/, "");
  if (slot.unit && s.endsWith(slot.unit)) s = s.slice(0, -slot.unit.length);
  if (!/^\d+$/.test(s)) return no("숫자로 읽을 수 없음");
  const value = +s;
  return inRange(value, slot) ? ok(String(value)) : no(`${slot.range?.[0]}~${slot.range?.[1]} 밖의 숫자`);
}

function parsePercent(input: string, slot: Slot): Parsed {
  const s = input.replace(/\s/g, "");
  const cut = s.match(/^(\d+(?:\.\d+)?)(?:%|퍼센트|프로)?(감액|깎아서?|삭감)$/);
  if (cut) {
    const value = 100 - +cut[1];
    return inRange(value, slot) ? ok(String(value), `${cut[1]}% 감액 → ${value}% 지급`) : no("범위 밖");
  }
  const m = s.match(/^(\d+(?:\.\d+)?)(?:%|퍼센트|프로)?$/);
  if (!m) return no("비율로 읽을 수 없음");
  const value = +m[1];
  return inRange(value, slot) ? ok(String(value)) : no(`${slot.range?.[0]}~${slot.range?.[1]} 밖의 비율`);
}
