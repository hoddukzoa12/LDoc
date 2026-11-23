// Throwaway spike driver. Runs the ghost-text page in WebKitGTK (MiniBrowser
// through WebKitWebDriver, the engine the Tauri app uses on Linux) under xvfb.
//
//   node drive.mjs smoke     one quick pass per variant, screenshots only
//   node drive.mjs film      the scripted interaction per variant, filmed into out/ghost.mp4
//   node drive.mjs measure   trigger-to-paint timings into out/timings.json
//
// Expects `vite preview` on 127.0.0.1:5179.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { Builder, Key } from "selenium-webdriver";

const mode = process.argv[2] ?? "smoke";
const out = join(import.meta.dirname, "out");
mkdirSync(out, { recursive: true });
const BASE = "http://127.0.0.1:5179/";
const MINIBROWSER = "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser";
const LABELS = { univer: "Univer 렌더 전용", "univer-real": "Univer 실제 텍스트(대안)", prosemirror: "ProseMirror" };
const VARIANTS = Object.keys(LABELS);

const webdriver = spawn("WebKitWebDriver", ["--port=4445"], { stdio: "ignore" });
await waitForPort(4445);
const driver = await new Builder()
  .usingServer("http://127.0.0.1:4445")
  .withCapabilities({ browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: MINIBROWSER, args: ["--automation"] } })
  .build();
await driver.manage().window().setRect({ x: 0, y: 0, width: 1360, height: 900 }).catch((error) => console.log("setRect:", error.message));
console.log("engine:", await driver.executeScript("return navigator.userAgent"));

const report = { mode, engine: await driver.executeScript("return navigator.userAgent"), variants: {} };

try {
  if (mode === "smoke") await smoke();
  if (mode === "film") await film();
  if (mode === "measure") await measure([0, 0, 0, 0, 0, 600, 600], VARIANTS);
  if (mode === "long") await measure([600, 600], VARIANTS);
  if (mode === "ime") await ime();
} catch (error) {
  await shot("failure.png").catch(() => {});
  console.log("log:", await driver.executeScript("return window.spike?.log").catch(() => null));
  throw error;
} finally {
  writeFileSync(join(out, `${mode}.json`), JSON.stringify(report, null, 2));
  await driver.quit().catch(() => {});
  webdriver.kill();
}

async function smoke() {
  for (const variant of VARIANTS) {
    await load(variant);
    await call("focus");
    await type("근로계약서");
    await press(Key.ENTER);
    await driver.sleep(800);
    const ghost = await call("ghost");
    await shot(`smoke-${variant}.png`);
    report.variants[variant] = { text: await call("text"), ghost, log: await call("log") };
    console.log(variant, JSON.stringify(report.variants[variant]).slice(0, 600));
  }
}

async function film() {
  const scenes = [];
  const size = execFileSync("xdotool", ["getdisplaygeometry"], { encoding: "utf8" }).trim().replace(" ", "x");
  const recorder = spawn(
    "ffmpeg",
    ["-loglevel", "error", "-y", "-f", "x11grab", "-draw_mouse", "0", "-framerate", "15", "-video_size", size, "-i", process.env.DISPLAY, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", join(out, "raw.mkv")],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  await driver.sleep(500);
  const startedAt = Date.now();
  const scene = (text) => scenes.push({ at: Date.now() - startedAt, text });
  try {
    for (const variant of VARIANTS) report.variants[variant] = await filmVariant(variant, LABELS[variant], scene);
  } finally {
    const length = Date.now() - startedAt;
    recorder.stdin.end("q");
    await new Promise((done) => recorder.on("exit", done));
    const captions = scenes.map((item, index) => `${index + 1}\n${stamp(item.at)} --> ${stamp(scenes[index + 1]?.at ?? length)}\n${item.text}\n`);
    writeFileSync(join(out, "ghost.srt"), captions.join("\n"));
    execFileSync(
      "ffmpeg",
      ["-loglevel", "error", "-y", "-i", "raw.mkv", "-vf", "subtitles=ghost.srt:force_style='FontName=Noto Sans CJK KR,FontSize=9,MarginV=12'", "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "ghost.mp4"],
      { cwd: out, stdio: "inherit" },
    );
    rmSync(join(out, "raw.mkv"));
  }
}

async function filmVariant(variant, label, scene) {
  const result = { checks: {} };
  const check = (name, value) => {
    result.checks[name] = value;
    console.log(`${variant} ${name}: ${JSON.stringify(value)}`);
  };
  await load(variant);
  scene(`${label} · 빈 문서에서 시작합니다`);
  await driver.sleep(1500);
  await call("focus");

  scene(`${label} · 제목 "근로계약서"를 치고 Enter를 누릅니다`);
  await type("근로계약서", 90);
  await driver.sleep(500);
  await press(Key.ENTER);
  await waitGhost("skeleton");
  scene(`${label} · 문서 뼈대가 회색 고스트로 나타납니다`);
  check("skeleton ghost absent from data while visible", !(await call("data")).includes("제1조"));
  check("skeleton ghost absent from export while visible", !(await call("exported")).includes("제1조"));
  await driver.sleep(2500);
  await shot(`${variant}-1-skeleton-ghost.png`);

  scene(`${label} · Tab으로 받아들입니다`);
  await press(Key.TAB);
  await waitNoGhost();
  check("skeleton accepted into text", (await call("text")).includes("제10조 (기타)"));
  await driver.sleep(1800);
  await shot(`${variant}-2-skeleton-accepted.png`);

  scene(`${label} · 제1조 끝에 커서를 두고 " 수습"을 칩니다`);
  await call("caretToEndOfParagraph", 2);
  await driver.sleep(900);
  await type(" 수습", 120);
  await driver.sleep(250);
  const beforeClause = await call("data");
  await waitGhost("clause");
  scene(`${label} · 0.6초 쉬면 커서 자리에 조항 제안이 나타나고 아래 조항이 밀려납니다`);
  check("clause ghost absent from data while visible", (await call("data")) === beforeClause);
  await driver.sleep(2500);
  await shot(`${variant}-3-clause-ghost.png`);

  scene(`${label} · 고스트가 보이는 채로 스크롤합니다`);
  const geometryBefore = await driver.executeScript("return window.ghostGeometry?.() ?? null");
  await call("scrollBy", 160);
  await driver.sleep(1200);
  const geometryAfter = await driver.executeScript("return window.ghostGeometry?.() ?? null");
  await shot(`${variant}-4-clause-ghost-scrolled.png`);
  if (geometryBefore && geometryAfter) {
    check("ghost moved with scroll (dom px)", { ghost: geometryAfter.ghostTop - geometryBefore.ghostTop, next: geometryAfter.nextTop - geometryBefore.nextTop });
  }
  check("ghost still visible after scroll", (await call("ghost"))?.kind === "clause");
  await call("scrollBy", -160);
  await driver.sleep(800);

  scene(`${label} · Esc로 한 번 닫습니다`);
  await press(Key.ESCAPE);
  await waitNoGhost();
  check("esc leaves data exactly as before the ghost", (await call("data")) === beforeClause);
  await driver.sleep(1500);
  await shot(`${variant}-5-clause-dismissed.png`);

  scene(`${label} · "습"을 다시 치면 제안이 돌아옵니다. Tab으로 받아들입니다`);
  await press(Key.BACK_SPACE);
  await type("습");
  await driver.sleep(250);
  const textBeforeAccept = await call("text");
  await waitGhost("clause");
  await driver.sleep(1500);
  const undoDepthBefore = await call("undoDepth");
  await press(Key.TAB);
  await waitNoGhost();
  const accepted = await call("text");
  check("clause accepted into text", accepted.includes("본채용된 것으로 본다"));
  check("undo depth grew by", undoDepthBefore === null ? null : (await call("undoDepth")) - undoDepthBefore);
  await driver.sleep(1800);
  await shot(`${variant}-6-clause-accepted.png`);

  scene(`${label} · Ctrl+Z 한 번이면 받아들인 조항만 사라집니다`);
  await driver.actions().keyDown(Key.CONTROL).sendKeys("z").keyUp(Key.CONTROL).perform();
  await driver.sleep(900);
  const undone = await call("text");
  check("one undo removes exactly the accepted clause", undone === textBeforeAccept);
  if (undone !== textBeforeAccept) result.undoDiff = { expected: textBeforeAccept, got: undone };
  await driver.sleep(1200);
  await shot(`${variant}-7-undone.png`);

  if (variant !== "prosemirror") {
    await press(Key.BACK_SPACE);
    await type("습");
    await waitGhost("clause");
    scene(`${label} · 고스트가 보이는 채로 130%로 확대합니다`);
    const beforeZoom = JSON.parse(await call("data"));
    await call("zoom", 1.3);
    await driver.sleep(1500);
    check("ghost still visible after zoom", (await call("ghost"))?.kind === "clause");
    await shot(`${variant}-8-clause-ghost-zoomed.png`);
    await call("zoom", 1);
    await driver.sleep(800);
    const afterZoom = JSON.parse(await call("data"));
    check(
      "document data keys a zoom in and out changed",
      [...new Set([...Object.keys(beforeZoom), ...Object.keys(afterZoom)])].filter((key) => JSON.stringify(beforeZoom[key]) !== JSON.stringify(afterZoom[key])),
    );
    await press(Key.ESCAPE);
    await waitNoGhost();
  }
  result.log = await call("log");
  result.timings = await call("timings");
  return result;
}

/**
 * Synthetic composition events only: WebDriver cannot drive a real IME, so this
 * proves the guards run, not that Korean input behaves.
 */
async function ime() {
  for (const variant of VARIANTS) {
    const checks = {};
    await load(variant, "?preset=skeleton");
    await call("caretToEndOfParagraph", 2);
    await type(" 수습");
    await waitGhost("clause");
    const before = await call("data");
    await driver.executeScript(`window.spike.inputElement().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }))`);
    await driver.sleep(200);
    checks["compositionstart hides the ghost"] = (await call("ghost")) === null;
    checks["composing flag set"] = await call("composing");
    await driver.executeScript(`window.spike.inputElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", keyCode: 9, bubbles: true, cancelable: true, isComposing: true }))`);
    await driver.sleep(900);
    checks["no ghost while composing, even after the pause"] = (await call("ghost")) === null;
    checks["tab while composing changed nothing"] = (await call("data")) === before;
    await driver.executeScript(`window.spike.inputElement().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }))`);
    await driver.sleep(200);
    checks["composing flag cleared"] = !(await call("composing"));
    checks["page errors"] = await driver.executeScript("return window.spikeErrors");
    report.variants[variant] = checks;
    console.log(variant, JSON.stringify(checks));
  }
}

/** Each round loads every variant in turn, so drift and warmup favour none. */
async function measure(rounds, variants) {
  const trials = [];
  for (const long of rounds) {
    for (const variant of variants) trials.push(...(await measureLoad(variant, long, 3)));
  }
  report.trials = trials;
  const summary = {};
  for (const trial of trials) {
    const key = `${trial.variant} paragraphs=${trial.paragraphs}`;
    (summary[key] ??= []).push(trial);
  }
  report.summary = Object.fromEntries(
    Object.entries(summary).map(([key, list]) => [
      key,
      {
        runs: list.length,
        keyToFrameMs: stats(list.map((t) => t.frameAt - t.keyAt)),
        keyToFireMs: stats(list.map((t) => t.firedAt - t.keyAt)),
        fireToDrawnMs: stats(list.map((t) => t.drawnAt - t.firedAt)),
        showMs: stats(list.map((t) => t.showMs)),
      },
    ]),
  );
  console.log(JSON.stringify(report.summary, null, 2));
}

async function measureLoad(variant, long, count) {
  await load(variant, `?preset=skeleton&long=${long}`);
  await call("caretToEndOfParagraph", 2);
  await type(" 수");
  await driver.sleep(400);
  const seen = [];
  for (let trial = 0; trial < count; trial++) {
    const before = (await call("timings")).length;
    await type("습");
    await waitGhost("clause");
    await driver.wait(async () => (await call("timings")).length > before, 5000, "no timing recorded");
    const timing = (await call("timings"))[before];
    seen.push(timing);
    await driver.sleep(300);
    await press(Key.ESCAPE);
    await waitNoGhost();
    await press(Key.BACK_SPACE);
    await driver.sleep(400);
  }
  (report.relayouts ??= {})[`${variant} long=${long}`] = (await call("log")).filter((line) => line.includes("relayout"));
  return seen;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { median: round(median), min: round(sorted[0]), max: round(sorted[sorted.length - 1]) };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

async function load(variant, search = "") {
  await driver.get(`${BASE}${search}#${variant}`);
  await driver.navigate().refresh();
  try {
    await driver.wait(async () => driver.executeScript(`return window.spike?.variant === ${JSON.stringify(variant)} && window.spike.ready`), 30_000, `${variant} did not load`);
  } catch (error) {
    console.log("page errors:", await driver.executeScript("return window.spikeErrors"));
    throw error;
  }
  await driver.sleep(1200);
}

function call(name, ...args) {
  return driver.executeScript(
    `const v = window.spike[${JSON.stringify(name)}]; return typeof v === "function" ? v(...arguments) : v;`,
    ...args,
  );
}

async function type(text, gap = 0) {
  if (!gap) return driver.actions().sendKeys(text).perform();
  for (const char of text) {
    await driver.actions().sendKeys(char).perform();
    await driver.sleep(gap);
  }
}

function press(key) {
  return driver.actions().sendKeys(key).perform();
}

async function waitGhost(kind) {
  await driver.wait(async () => (await call("ghost"))?.kind === kind, 5000, `no ${kind} ghost`);
}

async function waitNoGhost() {
  await driver.wait(async () => (await call("ghost")) === null, 5000, "ghost did not go away");
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
