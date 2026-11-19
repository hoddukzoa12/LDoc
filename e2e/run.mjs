// Drives the built app through tauri-driver. It answers the form with the
// example answers, checks that an empty required field is reported, edits the
// draft, exports it through the native save dialog, and reads the DOCX back.
// Run under xvfb-run after `pnpm tauri build --no-bundle`.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { Builder, By, Capabilities, Key, until } from "selenium-webdriver";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "e2e-out");
const answers = JSON.parse(readFileSync(join(root, "crates/ldoc-core/examples/payment-order-goods.json"), "utf8"));

/** The claim sentence `cargo run -p ldoc-core --example draft` prints for the example answers. */
const CLAIM =
  "채무자는 채권자에게 금 7,000,000원 (칠백만 원) 및 이에 대하여 2026. 4. 1.부터 이 사건 지급명령 정본 송달일까지는 연 6%의, 그 다음 날부터 다 갚는 날까지는 연 12%의 각 비율로 계산한 돈을 지급하라.";
/** Typed into the editor to prove the export carries the person's edits. */
const EDIT = "E2E";
/** A required field on the last step, left empty on the first submit. */
const LEFT_EMPTY = "debtor_address";

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

const tauriDriver = spawn("tauri-driver", [], { stdio: "inherit" });
await waitForPort(4444);
const capabilities = new Capabilities();
capabilities.setBrowserName("wry");
capabilities.set("tauri:options", { application: join(root, "target/release/ldoc") });
const driver = await new Builder().withCapabilities(capabilities).usingServer("http://127.0.0.1:4444/").build();

try {
  await answerForm();
  await editDraft();
  const paragraphs = await exportDraft();
  assert.ok(
    paragraphs.some((paragraph) => paragraph.text.includes(CLAIM)),
    "the exported DOCX lacks the claim sentence",
  );
  assert.ok(
    paragraphs.some((paragraph) => paragraph.text.includes(EDIT)),
    "the exported DOCX lacks the text typed into the editor",
  );
  console.log("e2e passed");
} catch (error) {
  await screenshot("failure.png").catch(() => {});
  throw error;
} finally {
  await driver.quit().catch(() => {});
  tauriDriver.kill();
}

async function answerForm() {
  await find("[data-disclaimer]");
  await screenshot("choose.png");
  await (await find('[data-doc="payment-order-goods"]')).click();
  const steps = Number(await (await find("[data-steps]")).getAttribute("data-steps"));
  for (let step = 0; step < steps; step++) {
    await find(`[data-step="${step}"]`);
    const last = step === steps - 1;
    await fillStep(last ? LEFT_EMPTY : null);
    if (step === 2) {
      await scrollFormToTop();
      await screenshot("form-step.png");
    }
    await submit();
  }

  const missing = await find(`[data-field="${LEFT_EMPTY}"]`);
  await driver.wait(async () => (await missing.getText()).includes("필수 항목입니다."), 15_000, "no required-field error");
  await screenshot("form-required-error.png");
  await fill(await find(`[data-field="${LEFT_EMPTY}"]`), answers[LEFT_EMPTY]);
  await submit();
}

/** Fills every shown field the answers cover, again after each fill reveals new fields. */
async function fillStep(skip) {
  const done = new Set();
  for (;;) {
    let next = null;
    for (const field of await driver.findElements(By.css("[data-step] [data-field]"))) {
      const id = await field.getAttribute("data-field");
      if (!done.has(id) && id !== skip && id in answers) {
        next = { id, field };
        break;
      }
    }
    if (!next) return;
    await fill(next.field, answers[next.id]);
    done.add(next.id);
  }
}

async function fill(field, value) {
  const kind = await field.getAttribute("data-kind");
  if (kind === "choice" || kind === "multi_choice") {
    for (const option of [value].flat()) {
      const control = await field.findElement(By.css(`[data-value="${option}"]`));
      await driver.executeScript("arguments[0].click()", control);
    }
    return;
  }
  const input = await field.findElement(By.css("input, textarea"));
  await input.clear();
  await input.sendKeys(value);
  if (kind === "date") {
    await input.sendKeys(Key.TAB);
    return;
  }
  assert.equal(await input.getAttribute("value"), value);
}

/** The form column scrolls inside the layout's content region. */
async function scrollFormToTop() {
  await driver.executeScript(
    'document.querySelector("[data-step]").closest(".astryx-layout-content")?.scrollTo(0, 0)',
  );
}

async function submit() {
  await (await find('[data-action="next"]')).click();
}

/** Univer opens with the caret at the start of the document, so the keys land in the title. */
async function editDraft() {
  await find("[data-editor-host] canvas");
  await driver.sleep(2000);
  await screenshot("editor.png");
  await driver.actions().sendKeys(EDIT).perform();
  await driver.sleep(500);
  await screenshot("editor-edited.png");
}

/** Saves through the GTK save dialog, driven with xdotool, and returns the DOCX paragraphs. */
async function exportDraft() {
  const target = join(out, "draft.docx");
  await (await find('[data-action="export"]')).click();
  const dialog = xdotool("search", "--sync", "--onlyvisible", "--name", "^Word").split("\n")[0];
  execFileSync("import", ["-window", "root", join(out, "save-dialog.png")]);
  xdotool("windowfocus", "--sync", dialog);
  xdotool("key", "ctrl+a");
  xdotool("type", "--delay", "20", target);
  xdotool("key", "Return");
  const status = await find('[data-export="saved"]');
  // getText() reads this ellipsized line as empty in WebKitWebDriver.
  assert.equal(await status.getAttribute("textContent"), `저장했습니다 · ${target}`);
  const json = execFileSync(
    "uv",
    ["run", "--quiet", "--with", "python-docx", "python", join(root, "e2e/docx_paragraphs.py"), target],
    { encoding: "utf8" },
  );
  writeFileSync(join(out, "draft.json"), json);
  return JSON.parse(json);
}

function xdotool(...args) {
  return execFileSync("timeout", ["20", "xdotool", ...args], { encoding: "utf8" }).trim();
}

async function find(css) {
  return driver.wait(until.elementLocated(By.css(css)), 15_000, `no element matches ${css}`);
}

async function screenshot(name) {
  writeFileSync(join(out, name), await driver.takeScreenshot(), "base64");
}

async function waitForPort(port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const open = await new Promise((done) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.end();
        done(true);
      });
      socket.on("error", () => done(false));
    });
    if (open) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`tauri-driver did not listen on port ${port}`);
}
