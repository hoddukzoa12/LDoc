// Drives the page in WebKitGTK (MiniBrowser through WebKitWebDriver) under xvfb.
//
//   node e2e/drive.mjs smoke       accept the skeleton, dump texts and stats
//   node e2e/drive.mjs film        the scripted run A to H, filmed into e2e-out/blanks.mp4
//   node e2e/drive.mjs scenario2   a second finished document with other branches, no film
//   node e2e/drive.mjs parse       every loose input per blank kind, into e2e-out/parse-table.*
//   node e2e/drive.mjs ime         synthetic composition events: no ghost, no Tab while composing
//
// Expects `vite preview` on 127.0.0.1:5180.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { Builder, By, Key } from "selenium-webdriver";
import { compare, SCENARIO1, SCENARIO2 } from "./check.mjs";

const mode = process.argv[2] ?? "smoke";
const out = join(import.meta.dirname, "../e2e-out");
mkdirSync(out, { recursive: true });
const BASE = "http://127.0.0.1:5180/?today=2026-11-20";
const MINIBROWSER = "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser";
const HOLD = 2600;

const webdriver = spawn("WebKitWebDriver", ["--port=4446"], { stdio: "ignore" });
await waitForPort(4446);
const driver = await new Builder()
  .usingServer("http://127.0.0.1:4446")
  .withCapabilities({ browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: MINIBROWSER, args: ["--automation"] } })
  .build();
await driver.manage().window().setRect({ x: 0, y: 0, width: 1360, height: 960 }).catch((error) => console.log("setRect:", error.message));
const report = { mode, engine: await driver.executeScript("return navigator.userAgent"), checks: {} };
console.log("engine:", report.engine);
const check = (name, value) => {
  report.checks[name] = value;
  console.log(`${name}: ${JSON.stringify(value)}`);
};
const must = (name, value, ok) => {
  check(name, value);
  if (!ok) throw new Error(`${name} failed: ${JSON.stringify(value)}`);
};

try {
  if (mode === "smoke") await smoke();
  if (mode === "film") await film();
  if (mode === "scenario2") await scenario2();
  if (mode === "parse") await parseTable();
  if (mode === "ime") await ime();
} catch (error) {
  await shot(`failure-${mode}.png`).catch(() => {});
  report.error = String(error?.stack ?? error);
  report.focus = await call("focus").catch(() => null);
  report.items = await call("items").catch(() => null);
  report.pageErrors = await driver.executeScript("return window.spikeErrors").catch(() => null);
  console.log("focus:", JSON.stringify(report.focus), "\nerrors:", JSON.stringify(report.pageErrors));
  throw error;
} finally {
  report.pageErrors ??= await driver.executeScript("return window.spikeErrors").catch(() => null);
  writeFileSync(join(out, `${mode}.json`), JSON.stringify(report, null, 2));
  await driver.quit().catch(() => {});
  webdriver.kill();
}

// ---- modes ------------------------------------------------------------------

async function smoke() {
  await load();
  await shot("smoke-0-empty.png");
  await startDocument(0);
  await shot("smoke-1-ghost.png");
  check("ghost shown", await call("skeleton"));
  await press(Key.TAB);
  await driver.sleep(500);
  await shot("smoke-2-accepted.png");
  check("accepted", await call("accepted"));
  check("focus after accept", await call("focus"));
  check("stats", await call("stats"));
  check("open items", (await call("items")).length);
  const page = await layout();
  must("paper centred in #host", page, Math.abs(page.left - page.right) <= 1 && new Set(page.pads).size === 1);
  const unpinned = await listDisplay();
  must("open list hidden by default", unpinned, unpinned === "none");
  await driver.actions().move({ origin: await driver.findElement(By.css("#open-toggle")) }).perform();
  const hovered = await listDisplay();
  must("open list shown on hover", hovered, hovered !== "none");
  await driver.actions().move({ x: 20, y: 400 }).perform();
  const left = await listDisplay();
  must("open list hidden again when the pointer leaves", left, left === "none");
  await pinList();
  await driver.actions().move({ x: 20, y: 400 }).perform();
  const pinned = await listDisplay();
  must("open list shown when pinned, pointer elsewhere", pinned, pinned !== "none");
  const expanded = await driver.executeScript("return document.getElementById('open-toggle').getAttribute('aria-expanded')");
  must("button reports the pinned list as expanded", expanded, expanded === "true");
  await shot("smoke-3-list.png");
  await pickAt("employment", "1");
  const chip = await driver.executeScript(`
    const chip = document.querySelector(".chip");
    if (!chip) return null;
    chip.scrollIntoView({ block: "center" });
    const host = document.getElementById("host"), h = host.getBoundingClientRect(), c = chip.getBoundingClientRect();
    const paper = host.querySelector(".ProseMirror").getBoundingClientRect();
    return { chip: [c.left, c.top, c.right, c.bottom], host: [h.left, h.top, h.left + host.clientWidth, h.top + host.clientHeight], paperLeft: paper.left };
  `);
  must("chip inside #host, left of the paper", chip, !!chip && chip.chip[0] >= chip.host[0] && chip.chip[1] >= chip.host[1] && chip.chip[2] <= chip.host[2] && chip.chip[3] <= chip.host[3] && chip.chip[2] <= chip.paperLeft);
  writeFileSync(join(out, "template.txt"), await call("templateText"));
  writeFileSync(join(out, "smoke-edit-text.txt"), await call("text"));
}

async function film() {
  const scenes = [];
  const size = execFileSync("xdotool", ["getdisplaygeometry"], { encoding: "utf8" }).trim().replace(" ", "x");
  const recorder = spawn(
    "ffmpeg",
    ["-loglevel", "error", "-y", "-f", "x11grab", "-draw_mouse", "0", "-framerate", "15", "-video_size", size, "-i", process.env.DISPLAY, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", join(out, "raw.mkv")],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  await driver.sleep(600);
  const startedAt = Date.now();
  const scene = (text) => {
    scenes.push({ at: Date.now() - startedAt, text });
    console.log(`[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${text}`);
  };
  try {
    await filmScript(scene);
  } finally {
    const length = Date.now() - startedAt;
    recorder.stdin.end("q");
    await new Promise((done) => recorder.on("exit", done));
    const captions = scenes.map((item, index) => `${index + 1}\n${stamp(item.at)} --> ${stamp(scenes[index + 1]?.at ?? length)}\n${item.text}\n`);
    writeFileSync(join(out, "blanks.srt"), captions.join("\n"));
    execFileSync(
      "ffmpeg",
      ["-loglevel", "error", "-y", "-i", "raw.mkv", "-vf", "subtitles=blanks.srt:force_style='FontName=Noto Sans CJK KR,FontSize=10,MarginV=10,BorderStyle=3,Outline=1,BackColour=&H80000000'", "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "blanks.mp4"],
      { cwd: out, stdio: "inherit" },
    );
    rmSync(join(out, "raw.mkv"));
  }
}

async function filmScript(scene) {
  await load();
  scene("가이드 doc-037 근로계약서 출력 템플릿을 손으로 데이터로 옮겼습니다 · 오늘은 2026-11-20으로 고정");
  await driver.sleep(HOLD);

  scene("A. 빈 문서에 제목 ‘근로계약서’를 치고 Enter");
  await startDocument(110);
  scene("A. 가이드 템플릿 전체(제1조~제16조, 서명란)가 회색 고스트로 나옵니다. 빈칸은 이름표, 갈래는 ‘아직 안 고름’");
  await driver.sleep(HOLD + 800);
  await shot("film-a1-ghost.png");
  scene("A. 고스트를 끝까지 넘겨 봅니다: 고르지 않은 갈래는 모두 보입니다 (제6조만 여섯 갈래)");
  for (const dy of [900, 1100, 1300]) {
    await call("scrollBy", dy);
    await driver.sleep(1700);
  }
  await shot("film-a2-ghost-scrolled.png");
  await driver.executeScript("document.getElementById('host').scrollTop = 0");
  await driver.sleep(900);

  scene("A. Tab으로 받아들이면 문서가 되고, 오른쪽 아래 버튼에 아직 열린 항목 수가 나옵니다");
  await press(Key.TAB);
  await driver.sleep(HOLD);
  check("A: accepted, title is the template's", (await call("text")).startsWith("근 로 계 약 서"));
  await shot("film-a3-accepted.png");

  scene("B·C. 커서는 첫 빈칸에 있습니다. ‘주식회사 한빛테크’를 치면 서명란의 법인명도 같은 값으로 채워집니다");
  await type("주식회사 한빛테크", 80);
  await driver.sleep(1400);
  scene("C·F. 서명란: 법인명이 같이 채워졌고, 회사명이라 사용자 유형이 ‘법인’으로 정해졌습니다 (가이드: 회사명이면 법인)");
  await call("scrollToText", "법인명:");
  await driver.sleep(HOLD + 400);
  await shot("film-c1-signature.png");
  check("C: employer name in the signature", (await call("text")).includes("법인명: 주식회사 한빛테크"));
  check("F: employer type picked", (await call("model")).picks.employer_type);

  scene("B. Tab으로 다음 빈칸 ‘근로자명’");
  await press(Key.TAB);
  await type("김민준", 110);
  await driver.sleep(1500);
  scene("B. Tab은 빈칸과 ‘고를 곳’을 문서 순서대로 지나갑니다");
  await press(Key.TAB);
  await driver.sleep(1800);
  check("B: tab reaches the branch bar", (await call("focus"))?.id);
  await press(Key.TAB);
  scene("D. 빈 날짜 칸은 오늘 날짜를 회색으로 제안합니다 (Tab이면 그대로 받음)");
  await driver.sleep(HOLD);
  await shot("film-d1-today.png");
  scene("D. ‘내년 3월 1일’이라고 치면 어떻게 읽었는지 바로 옆에 보여 줍니다");
  await type("내년 3월 1일", 90);
  await driver.sleep(HOLD);
  await shot("film-d2-preview.png");
  scene("D·C. 칸을 떠나면 ‘2027년 3월 1일’로 굳고, 기간제 쪽 [시작일]도 같은 값입니다");
  await press(Key.TAB);
  await driver.sleep(HOLD);
  check("D: start date normalised", await call("value", "start_date"));

  scene("F·E. 기간제에만 있는 종료일에 ‘1년’ → 기간제로 정해져 정규직 문장이 빠지고, 시작일 + 1년 − 1일을 보여 줍니다");
  await type("1년", 250);
  await driver.sleep(HOLD + 600);
  await shot("film-f1-fixed-term.png");
  check("F: employment follows the end date", (await call("model")).picks.employment);
  scene("E. Tab으로 떠나면 2028년 2월 29일로 굳습니다");
  await press(Key.TAB);
  await driver.sleep(HOLD);
  check("E: end date", await call("value", "end_date"));
  scene("고를 곳은 숫자 한 키로 고릅니다: 1 = 갱신 약정함");
  await type("1");
  await driver.sleep(HOLD);

  scene("F. 수습·시용에서 3 = ‘적용 안 함’ → 제3조가 빠지고 뒤 조항 번호가 당겨집니다");
  await assertFocus("bar:probation");
  await type("3");
  await driver.sleep(1400);
  await shot("film-f2-no-probation.png");
  scene("F. 본문 속 참조 ‘제9조의 임금 지급일’도 ‘제8조의 임금 지급일’로 바뀝니다 (바뀐 번호는 잠시 노란색)");
  await call("scrollToText", "의 임금 지급일까지");
  await driver.sleep(HOLD);
  await shot("film-f3-crossref.png");
  check("F: cross-reference renumbered", (await call("text")).includes("갑은 제8조의 임금 지급일까지"));

  scene("F. 되돌리기: 왼쪽 여백의 칩을 눌러 ‘시용’을 고르면 제3조가 돌아옵니다");
  await call("scrollToKey", "c:probation/bar");
  await driver.sleep(1400);
  await click('[data-bar="probation"]');
  await driver.sleep(1500);
  await click('.opt[data-choice="probation"][data-key="trial"]');
  await driver.sleep(HOLD);
  check("F: clause back, cross-reference back", (await call("text")).includes("갑은 제9조의 임금 지급일까지"));
  scene("F. 시용기간에 ‘4개월’ → 가이드의 ‘3~6개월 직접입력형’ 문구(만료 30일 전 통보)가 들어갑니다");
  await assertFocus("slot:probation_period");
  await type("4개월", 150);
  await driver.sleep(HOLD + 600);
  await shot("film-f4-trial-4-months.png");
  check("F: custom-trial phrase", (await call("text")).includes("시용기간 만료 30일 전까지 종료를 통보하여"));
  scene("F. 다시 ‘적용 안 함’ → ‘시용’으로 되돌려도 친 값 4개월은 남아 있습니다");
  await press(Key.TAB);
  await call("scrollToKey", "c:probation/bar");
  await driver.sleep(800);
  await click('[data-bar="probation"]');
  await driver.sleep(900);
  await click('.opt[data-choice="probation"][data-key="none"]');
  await driver.sleep(1800);
  await click('[data-bar="probation"]');
  await driver.sleep(900);
  await click('.opt[data-choice="probation"][data-key="trial"]');
  await driver.sleep(HOLD);
  check("F: value kept across reversal", await call("value", "probation_period"));

  scene("나머지 빈칸을 문서 순서대로 채웁니다");
  await fill("team", "개발팀");
  await fill("rank", "선임");
  await fill("duties", "웹 서비스 기획 및 운영");
  scene("F. ‘시업~종업’ 칸은 ‘근무시간이 일정한 경우’에만 있습니다. ‘9시~6시’를 치면 그 갈래로 정해집니다");
  await goTo("slot:work_hours");
  await driver.sleep(1200);
  await type("9시~6시", 140);
  await driver.sleep(HOLD + 600);
  await shot("film-f5-hours.png");
  check("F: hours type follows", (await call("model")).picks.hours);
  scene("D. ‘12~1’은 12:00~13:00, ‘월-금’은 가이드 표기 ‘평일(월~금)’, ‘일’은 일요일");
  await fill("break_time", "12~1", 120);
  await fill("workdays", "월-금", 120);
  await fill("weekly_holiday", "일", 120);
  await press(Key.TAB);
  await driver.sleep(HOLD);
  await shot("film-d3-days.png");
  await pickAt("annual_leave", "1");
  await pickAt("comp", "1");

  scene("D. 연봉에 ‘3600만’ → 36,000,000");
  await fill("salary", "3600만", 140);
  await driver.sleep(HOLD);
  scene("E. 기본급 칸에 ‘연봉의 1/12’가 회색 제안으로 나옵니다. Tab으로 받습니다");
  await press(Key.TAB);
  await driver.sleep(HOLD + 400);
  await shot("film-e1-base-pay.png");
  await press(Key.TAB);
  await driver.sleep(1200);
  check("E: base pay accepted", await call("value", "base_pay"));
  await pickAt("fixed_ot", "1");
  scene("E. 받은 기본급은 월 항목을 넣을 때마다 ‘연봉 1/12 − 다른 월 항목’으로 따라 바뀝니다");
  await fill("ot_pay", "30만", 90);
  await fill("bonus", "20만원", 90);
  await fill("meal", "200,000", 60);
  await fill("transport", "10만", 90);
  await fill("other_name", "직책수당", 60);
  await fill("other_pay", "100000", 60);
  await press(Key.TAB);
  await call("scrollToText", "기본급(월)");
  await driver.sleep(HOLD + 600);
  await shot("film-e2-base-follows.png");
  check("E: base pay follows the other items", await call("value", "base_pay"));
  await pickAt("show_hourly", "1");
  await fill("hourly", "12000", 60);
  scene("D. 읽을 수 없는 입력(‘시급의 절반’)은 친 그대로 두고 ‘읽지 못함’으로 표시합니다. 추측하지 않습니다");
  await fill("hourly_add", "시급의 절반", 100);
  await press(Key.TAB);
  await driver.sleep(HOLD + 600);
  await shot("film-d4-unread.png");
  check("D: unread kept as typed", await call("value", "hourly_add"));
  scene("G. 읽지 못한 칸은 오른쪽 아래 버튼의 목록에 남습니다. 눌러서 그 칸으로 가 ‘6000’으로 고칩니다");
  await pinList();
  await driver.sleep(1400);
  await clickItem("추가 근로 가산액");
  await driver.sleep(1600);
  await type("6000", 120);
  await press(Key.TAB);
  await driver.sleep(1600);
  check("D: unread fixed", await call("value", "hourly_add"));

  scene("나머지 빈칸 (빠르게)");
  await fill("perf_cond", "연간 목표 달성");
  await fill("perf_due", "다음 해 1월 말일");
  await fill("perf_pay", "기본급의 100%");
  await fill("tenure_cond", "3년 근속");
  await fill("tenure_due", "근속 3년이 되는 달의 말일");
  await fill("tenure_pay", "100만 원");
  await fill("other_incentive", "없음");
  await fill("pay_day", "매월 10일");
  await fill("bank", "국민은행");
  await fill("account", "123-456-789012");
  await pickAt("e_delivery", "1");
  scene("D. 작성일자도 날짜 칸이라 오늘 날짜를 제안합니다. Tab으로 받습니다");
  await goTo("slot:written_date");
  await driver.sleep(HOLD);
  await press(Key.TAB);
  await driver.sleep(1200);
  check("D: written date", await call("value", "written_date"));
  await fill("rep_name", "이서연");
  await fill("employer_addr", "서울특별시 강남구 테헤란로 123");
  await fill("employer_phone", "02-1234-5678");
  await fill("worker_id", "900101-1234567");
  await fill("worker_addr", "서울특별시 마포구 월드컵로 45");
  await fill("worker_phone", "010-1234-5678");
  await press(Key.TAB);
  await driver.sleep(800);

  scene("G. 오른쪽 아래 목록에 남은 것: 근무장소와 고정OT 시간. 둘 다 가이드가 정한 계산으로 제안이 있습니다");
  await driver.sleep(HOLD + 600);
  await shot("film-g1-open-list.png");
  check("G: open items before the last two", await call("items"));
  scene("G·E. 목록에서 ‘근무장소’를 누르면 그 칸으로 갑니다. 제안은 ‘사용자 주소와 같음’, Tab으로 받습니다");
  await clickItem("근무장소");
  await driver.sleep(HOLD);
  await shot("film-g2-workplace.png");
  await press(Key.TAB);
  await driver.sleep(1200);
  scene("G·E. 고정OT 시간: 고정 시간 외 수당 ÷ (통상시급 × 1.5) = 300,000 ÷ 18,000 ≈ 17");
  await clickItem("고정OT 포함 시간");
  await driver.sleep(HOLD);
  await shot("film-g3-ot-hours.png");
  await press(Key.TAB);
  await driver.sleep(1200);
  scene("G. 남은 항목 없음: 갈래를 다 고르고 빈칸을 다 채웠습니다");
  await driver.sleep(HOLD);
  check("G: open items at the end", await call("items"));
  check("G: an empty pinned list is not reported as expanded", await driver.executeScript("return document.getElementById('open-toggle').getAttribute('aria-expanded')"));
  await shot("film-g4-done.png");

  const text = await call("text");
  writeFileSync(join(out, "film-final.txt"), text);
  writeFileSync(join(out, "film-render.txt"), await call("finalText"));
  const result = compare("scenario 1", SCENARIO1(), text);
  check("finished text equals the guide", { equal: result.equal, chars: result.chars, firstDifference: result.firstDifference });
  scene(`검사: 화면의 완성 문서 = 가이드 원문(고른 갈래만) + 넣은 값 → ${result.equal ? "일치" : "불일치"} (공백 빼고 ${result.chars.actual}자 비교)`);
  await call("banner", result.equal ? `일치 · 화면의 완성 문서가 가이드 원문(고른 갈래) + 값과 공백 빼고 ${result.chars.actual}자 같습니다` : "불일치 · out/check.json 참조", result.equal ? "ok" : "bad");
  await driver.sleep(HOLD + 1400);
  await shot("film-check.png");
  await call("banner", "");

  scene("H. 새 문서. 제2조 고용형태에 말로 적어 봅니다 (준비된 예시 하나: 모델이 들어갈 자리)");
  await load();
  await startDocument(60);
  await press(Key.TAB);
  await driver.sleep(800);
  await clickItem("고용형태");
  await driver.sleep(1400);
  await type("6개월만 써 보고 결정", 90);
  await driver.wait(async () => (await call("intent"))?.reading, 5000, "no canned reading");
  await driver.sleep(HOLD + 600);
  await shot("film-h1-intent.png");
  scene("H. Tab으로 받으면 기간제가 되고, 종료일은 ‘6개월’을 들고 시작일을 기다립니다 (파란 점선)");
  await press(Key.TAB);
  await driver.sleep(HOLD + 400);
  await shot("film-h2-applied.png");
  check("H: employment from the canned reading", (await call("model")).picks.employment);
  scene("H·E. 시작일 ‘2027.3.1’ → 종료일 칸이 시작일 + 6개월 − 1일을 보여 줍니다");
  await type("2027.3.1", 110);
  await press(Key.TAB);
  await driver.sleep(HOLD);
  await press(Key.TAB);
  scene("H·E. 종료일 2027년 8월 31일");
  await driver.sleep(HOLD + 400);
  await shot("film-h3-end-date.png");
  check("H: end date from start + 6 months", await call("value", "end_date"));
}

async function scenario2() {
  await load();
  await startDocument(0);
  await press(Key.TAB);
  await type("한빛상사");
  await fill("worker_name", "박지우");
  await pickAt("employment", "1");
  await assertFocus("slot:start_date");
  await type("2027-01-02");
  await pickAt("probation", "3");
  await fill("team", "영업팀");
  await fill("rank", "사원");
  await fill("duties", "고객 상담");
  await fill("workplace", "부산광역시 해운대구 센텀중앙로 79");
  await pickAt("hours", "4");
  await assertFocus("slot:sel_daily");
  await type("8시간");
  await fill("sel_from", "7시");
  await fill("sel_to", "오후 10시");
  await fill("sel_weekly", "40");
  await fill("core_band", "10시~4시");
  await fill("workdays", "월화수목금");
  await fill("weekly_holiday", "토요일");
  await pickAt("annual_leave", "2");
  await fill("custom_leave", "입사일부터 1년간 15일");
  await pickAt("unused_leave", "2");
  await pickAt("comp", "2");
  await fill("base_pay", "250만");
  await pickAt("fixed_ot", "2");
  await fill("bonus", "0");
  await fill("meal", "20만");
  await fill("transport", "0");
  await fill("other_name", "자격수당");
  await fill("other_pay", "5만");
  await pickAt("show_hourly", "2");
  await fill("perf_cond", "분기 목표 달성");
  await fill("perf_due", "분기 종료 후 1개월");
  await fill("perf_pay", "50만 원");
  await fill("tenure_cond", "5년 근속");
  await fill("tenure_due", "근속 5년이 되는 달");
  await fill("tenure_pay", "200만 원");
  await fill("other_incentive", "없음");
  await fill("pay_day", "25");
  await fill("bank", "신한");
  await fill("account", "110-123-456789");
  await pickAt("e_delivery", "2");
  await fill("written_date", "오늘");
  await pickAt("employer_type", "2");
  await assertFocus("slot:rep_name");
  await type("정하늘");
  await fill("employer_addr", "부산광역시 해운대구 센텀중앙로 79");
  await fill("employer_phone", "051-123-4567");
  await fill("worker_id", "950505-2345678");
  await fill("worker_addr", "부산광역시 수영구 광안해변로 100");
  await fill("worker_phone", "010-9876-5432");
  await press(Key.SHIFT, Key.TAB);
  await assertFocus("slot:worker_addr");
  check("shift-tab goes back one stop", true);
  await press(Key.TAB);
  await press(Key.TAB);
  check("open before salary", await call("items"));
  await clickItem("연봉액");
  await press(Key.TAB);
  await driver.sleep(300);
  check("open at the end", await call("items"));
  check("picks", (await call("model")).picks);
  const text = await call("text");
  writeFileSync(join(out, "scenario2-final.txt"), text);
  writeFileSync(join(out, "scenario2-render.txt"), await call("finalText"));
  await call("scrollToText", "의 임금 지급일까지");
  await shot("scenario2-renumbered.png");
  await call("scrollToText", "기본급(월)");
  await shot("scenario2-wage.png");
  const result = compare("scenario 2", SCENARIO2(), text);
  check("finished text equals the guide", { equal: result.equal, chars: result.chars, firstDifference: result.firstDifference });
}

async function parseTable() {
  await load();
  const S = "2027년 3월 1일";
  const cases = [
    ["date", "start_date", null, ["2027.3.1", "2027. 3. 1.", "2027-03-01", "2027/3/1", "20270301", "2027년 3월 1일", "3/1", "3.1", "3월 1일", "내년 3월 1일", "올해 12월 24일", "오늘", "내일", "모레", "다음 달 1일", "다음달 15일", "이번 달 25일", "2/29", "2027.2.29", "2027.13.1", "1년", "다음주쯤", "3월 초", "2027년 3월", "03-01-2027"]],
    ["date (end, start 2027년 3월 1일)", "end_date", S, ["1년", "6개월", "3개월", "1년 6개월", "2년", "반년", "세 달", "2주", "2028.2.29", "3/1", "1년 후", "계약 만료 시"]],
    ["date (end, start 2027년 1월 31일)", "end_date", "2027년 1월 31일", ["1개월", "1년"]],
    ["date (end, no start yet)", "end_date", null, ["1년"]],
    ["period", "probation_period", null, ["3개월", "6개월", "3", "세 달", "석 달", "1년", "반년", "3~6개월", "2주", "한 달 반", "삼 개월"]],
    ["money", "salary", null, ["3천만", "3600만원", "30000000", "3,600만", "3억 5천만", "1억2천3백만", "3.5억", "삼천만", "250만", "20만원", "금 300,000원", "0", "약 3천만", "3천만~4천만", "시급의 절반", "3000만원정", "3.5만", "-300000"]],
    ["time_range", "work_hours", null, ["9시~6시", "09:00-18:00", "9-6", "오전 9시~오후 6시", "9시반~6시", "12~1", "9시부터 6시까지", "10시~4시", "22:00~06:00", "점심 1시간", "25시~26시"]],
    ["time", "sel_from", null, ["7시", "오후 10시", "07:30", "9시 30분", "13", "저녁 7시", "아침 7시"]],
    ["weekday (근무일)", "workdays", null, ["월-금", "월~금", "평일", "주5일", "월화수목금", "월~토", "주6일", "월,수,금", "월수금", "토일", "금~월", "주말"]],
    ["weekday (주휴일)", "weekly_holiday", null, ["일", "일요일", "토요일", "토,일"]],
    ["count (지급일 [N]일)", "pay_day", null, ["10", "10일", "매월 10일", "25", "말일", "32", "다음 달 10일", "열흘"]],
    ["percent", "probation_pay", null, ["90", "90%", "90퍼센트", "10% 감액", "10% 깎아서", "120%", "구십"]],
    ["person", "worker_name", null, ["김민준", "김  민준", "김민준2"]],
    ["text with unit (은행)", "bank", null, ["국민은행", "국민", "신한 은행"]],
    ["party", "employer_name", null, ["주식회사 한빛테크", "(주)한빛", "한빛상사"]],
  ];
  const rows = [];
  for (const [kind, slot, start, inputs] of cases) {
    for (const input of inputs) {
      const parsed = await call("parse", slot, input, start);
      rows.push({ kind, slot, input, read: parsed.ok, pending: !!parsed.pending, output: parsed.ok ? parsed.text : null, note: parsed.ok ? (parsed.note ?? "") : parsed.reason });
    }
  }
  writeFileSync(join(out, "parse-table.json"), JSON.stringify(rows, null, 2));
  const md = ["| kind | typed | became | note |", "| --- | --- | --- | --- |", ...rows.map((r) => `| ${r.kind} | \`${r.input}\` | ${r.read ? `\`${r.output}\`` : r.pending ? "**waits for the start date, kept as typed**" : "**unread, kept as typed**"} | ${r.note} |`)];
  writeFileSync(join(out, "parse-table.md"), md.join("\n") + "\n");
  console.log(md.join("\n"));
}

/** Synthetic composition events only: WebDriver cannot drive a real IME, so this proves the guards run, not that Korean input behaves. */
async function ime() {
  await load();
  await startDocument(0);
  await press(Key.TAB);
  await goTo("slot:start_date");
  check("today ghost before composition", await countSel(".ph.suggest"));
  const before = await call("text");
  await driver.executeScript(`window.spike.inputElement().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }))`);
  await driver.sleep(300);
  check("composing flag set", await call("composing"));
  check("no ghost while composing", (await countSel(".ph.suggest")) === 0);
  await driver.executeScript(`window.spike.inputElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", keyCode: 9, bubbles: true, cancelable: true, isComposing: true }))`);
  await driver.sleep(400);
  check("tab while composing did not accept or move", (await call("text")) === before && (await call("focus"))?.id === "start_date");
  await driver.executeScript(`window.spike.inputElement().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }))`);
  await driver.sleep(300);
  check("composing flag cleared", !(await call("composing")));
}

// ---- helpers ----------------------------------------------------------------

async function load() {
  await driver.get(BASE);
  await driver.navigate().refresh();
  await driver.wait(async () => driver.executeScript("return window.spike?.ready === true"), 30_000, "page did not load");
  await driver.sleep(900);
}

async function startDocument(gap) {
  await driver.executeScript("window.spike.view.focus()");
  await type("근로계약서", gap);
  await driver.sleep(gap ? 500 : 50);
  await press(Key.ENTER);
  await driver.wait(async () => call("skeleton"), 5000, "no skeleton ghost");
}

function call(name, ...args) {
  return driver.executeScript(`const v = window.spike[${JSON.stringify(name)}]; return typeof v === "function" ? v(...arguments) : JSON.parse(JSON.stringify(v));`, ...args);
}

async function type(text, gap = 0) {
  if (!gap) return driver.actions().sendKeys(text).perform();
  for (const char of text) {
    await driver.actions().sendKeys(char).perform();
    await driver.sleep(gap);
  }
}

function press(...keys) {
  if (keys.length === 1) return driver.actions().sendKeys(keys[0]).perform();
  return driver.actions().keyDown(keys[0]).sendKeys(keys[1]).keyUp(keys[0]).perform();
}

async function stopId() {
  const focus = await call("focus");
  return focus ? `${focus.kind === "slot" ? "slot" : "bar"}:${focus.id}` : null;
}

async function assertFocus(id) {
  const at = await stopId();
  if (at !== id) throw new Error(`expected focus ${id}, at ${at}`);
}

/** Press Tab until the caret is in the given stop. */
async function goTo(id) {
  for (let i = 0; i < 90; i++) {
    if ((await stopId()) === id) return;
    await press(Key.TAB);
  }
  throw new Error(`Tab never reached ${id}`);
}

async function fill(slot, text, gap = 0) {
  await goTo(`slot:${slot}`);
  await type(text, gap);
  if (gap) await driver.sleep(500);
}

async function pickAt(choice, digit) {
  await goTo(`bar:${choice}`);
  await type(digit);
  await driver.sleep(150);
}

async function click(css) {
  await driver.findElement(By.css(css)).click();
}

async function pinList() {
  if (!(await driver.executeScript("return document.getElementById('open').classList.contains('pinned')"))) await click("#open-toggle");
}

function listDisplay() {
  return driver.executeScript("return getComputedStyle(document.getElementById('open-list')).display");
}

async function layout() {
  return driver.executeScript(`
    const host = document.getElementById("host"), h = host.getBoundingClientRect();
    const paper = host.querySelector(".ProseMirror"), p = paper.getBoundingClientRect(), s = getComputedStyle(paper);
    return { left: p.left - h.left, right: h.left + host.clientWidth - p.right, pads: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft] };
  `);
}

async function clickItem(label) {
  await pinList();
  const items = await driver.findElements(By.css("#open li"));
  for (const item of items) {
    if ((await item.findElement(By.css(".label")).getText()) === label) return item.click();
  }
  throw new Error(`no open item ${label}`);
}

function countSel(css) {
  return driver.executeScript(`return document.querySelectorAll(${JSON.stringify(css)}).length`);
}

async function shot(name) {
  writeFileSync(join(out, name), await driver.takeScreenshot(), "base64");
}

function stamp(ms) {
  const part = (value, width = 2) => String(Math.floor(value)).padStart(width, "0");
  return `${part(ms / 3_600_000)}:${part((ms / 60_000) % 60)}:${part((ms / 1000) % 60)},${part(ms % 1000, 3)}`;
}

async function waitForPort(port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const open = await new Promise((done) => {
      const socket = connect(port, "127.0.0.1", () => (socket.end(), done(true)));
      socket.on("error", () => done(false));
    });
    if (open) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`nothing listens on ${port}`);
}
