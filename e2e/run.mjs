// Drives the built app through tauri-driver. It pastes a contract into the
// assistant, masks what is still personal, approves, checks that none of the
// contract's personal strings is in what would have left the device, and
// accepts the candidates. It answers the rest of the form with the example
// answers, checks that an empty required field is reported, edits the draft,
// exports it through the native save dialog, and reads the DOCX back.
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
/** The contract whose recorded reply the replay build returns. */
const pasted = JSON.parse(readFileSync(join(root, "e2e/assist-fixtures.json"), "utf8")).find(
  (fixture) => fixture.id === "contract",
);

/** The claim sentence `cargo run -p ldoc-core --example draft` prints for the example answers. */
const CLAIM =
  "채무자는 채권자에게 금 7,000,000원 (칠백만 원) 및 이에 대하여 2026. 4. 1.부터 이 사건 지급명령 정본 송달일까지는 연 6%의, 그 다음 날부터 다 갚는 날까지는 연 12%의 각 비율로 계산한 돈을 지급하라.";
/** Typed into the editor to prove the export carries the person's edits. */
const EDIT = "E2E";
/** A required field on the last step, its candidate dismissed and left empty on the first submit. */
const LEFT_EMPTY = "debtor_address";
/** Kinds whose input shows the answer as stored. */
const TYPED = new Set(["text", "money"]);

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
  await leaveEditedDraft();
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
  await fillFromPaste();
  const steps = Number(await (await find("[data-steps]")).getAttribute("data-steps"));
  const accepted = new Set();
  for (let step = 0; step < steps; step++) {
    await find(`[data-step="${step}"]`);
    if (step === 2) {
      await scrollFormToTop();
      await screenshot("assist-candidates.png");
    }
    await decideCandidates(accepted);
    const last = step === steps - 1;
    await fillStep(new Set(last ? [...accepted, LEFT_EMPTY] : accepted));
    if (step === 2) {
      await scrollFormToTop();
      await screenshot("form-step.png");
    }
    await submit();
  }
  assert.ok(accepted.size >= 10, `only ${accepted.size} candidates were accepted`);
  assert.ok(accepted.has("supplied_on"), "the supply date candidate did not appear once 거래 형태 was chosen");

  const missing = await find(`[data-field="${LEFT_EMPTY}"]`);
  await driver.wait(async () => (await missing.getText()).includes("필수 항목입니다."), 15_000, "no required-field error");
  await screenshot("form-required-error.png");
  await fill(await find(`[data-field="${LEFT_EMPTY}"]`), answers[LEFT_EMPTY]);
  await submit();
}

/**
 * Pastes the contract, masks each personal string the preview still shows,
 * approves, and checks the request body the shell recorded for the turn.
 */
async function fillFromPaste() {
  await find('[data-assist="replay"]');
  // WebKitWebDriver drops a typed "\n", so each line break is an Enter press.
  const lines = pasted.pasted.split("\n");
  await (await find('[data-assist="paste"] textarea')).sendKeys(
    ...lines.flatMap((line, index) => (index === 0 ? [line] : [Key.ENTER, line])),
  );
  await (await find('[data-action="preview"]')).click();
  const shown = async () => (await find("[data-masked]")).getAttribute("textContent");
  for (const personal of pasted.pii) {
    if (!(await shown()).includes(personal)) continue;
    await (await find('[data-assist="word"] input')).sendKeys(personal);
    await (await find('[data-action="mask-word"]')).click();
    await driver.wait(async () => !(await shown()).includes(personal), 15_000, `${personal} stayed in the preview`);
  }
  await screenshot("assist-preview.png");

  await (await find('[data-action="approve"]')).click();
  await find('[data-assist="done"]');
  await (await find('[data-action="show-sent"]')).click();
  const sentView = await find('[data-assist="sent"]');
  const readable = await sentView.getAttribute("textContent");
  await driver.executeScript("arguments[0].scrollIntoView()", sentView);
  await screenshot("assist-sent.png");
  for (const personal of pasted.pii) {
    assert.ok(!readable.includes(personal), `${personal} is shown as sent`);
  }
  await (await find('[data-action="show-raw"]')).click();
  const sent = await (await find("[data-sent]")).getAttribute("textContent");
  writeFileSync(join(out, "assist-sent.json"), sent);
  assert.ok(sent.includes("⟦") && sent.includes("물품공급계약서"), "the sent body is not the masked contract");
  for (const personal of pasted.pii) {
    assert.ok(!sent.includes(personal), `${personal} is in what left the device`);
  }
  for (const field of JSON.parse(sent).fields.filter((field) => field.sensitivity === "pii")) {
    assert.equal(field.help, null, `the help text of ${field.id} left the device`);
  }
  await (await find('[data-action="hide-sent"]')).click();
  await find('[data-action="show-sent"]');
}

/** Accepts every candidate on the step except the one for LEFT_EMPTY, which it dismisses. */
async function decideCandidates(accepted) {
  for (;;) {
    const notes = await driver.findElements(By.css("[data-step] [data-candidate]"));
    if (notes.length === 0) return;
    const id = await notes[0].getAttribute("data-candidate");
    const action = id === LEFT_EMPTY ? "dismiss" : "accept";
    const button = await notes[0].findElement(By.css(`[data-action="${action}"]`));
    // A button half under the form footer counts as in view, so WebDriver would not scroll to it.
    await driver.executeScript('arguments[0].scrollIntoView({ block: "center" })', button);
    await button.click();
    await driver.wait(until.stalenessOf(notes[0]), 15_000, `the ${id} candidate stayed`);
    if (action === "dismiss") continue;
    accepted.add(id);
    const field = await find(`[data-field="${id}"]`);
    if (TYPED.has(await field.getAttribute("data-kind"))) {
      const input = await field.findElement(By.css("input, textarea"));
      assert.equal(await input.getAttribute("value"), answers[id], `the ${id} candidate`);
    }
  }
}

/** Fills every shown field the answers cover, again after each fill reveals new fields. */
async function fillStep(skip) {
  const done = new Set();
  for (;;) {
    let next = null;
    for (const field of await driver.findElements(By.css("[data-step] [data-field]"))) {
      const id = await field.getAttribute("data-field");
      if (!done.has(id) && !skip.has(id) && id in answers) {
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

/**
 * Leaves an unedited draft without being asked, comes back, then types into
 * it. Univer opens with the caret at the start of the document, so the keys
 * land in the title.
 */
async function editDraft() {
  await find("[data-editor-host] canvas");
  await driver.sleep(2000);
  await (await find('[data-action="back"]')).click();
  await find("[data-step]");
  await submit();
  await find("[data-editor-host] canvas");
  await driver.sleep(2000);
  await screenshot("editor.png");
  await driver.actions().sendKeys(EDIT).perform();
  await driver.sleep(500);
  await screenshot("editor-edited.png");
}

/** Going back from an edited draft asks first; keeping the edits stays in the editor. */
async function leaveEditedDraft() {
  await (await find('[data-action="back"]')).click();
  await find('[role="alertdialog"]');
  // The dialog fades in.
  await driver.sleep(500);
  await screenshot("editor-leave.png");
  await (await find(By.xpath('//button[normalize-space()="편집 계속"]'))).click();
  await driver.wait(
    async () => {
      for (const dialog of await driver.findElements(By.css('[role="alertdialog"]'))) {
        if (await dialog.isDisplayed().catch(() => false)) return false;
      }
      return true;
    },
    15_000,
    "the leave dialog stayed open",
  );
  await find("[data-editor-host] canvas");
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
  const status = await (await find('[data-export="saved"]')).getAttribute("textContent");
  assert.ok(status.includes("저장했습니다") && status.includes(target), `the saved status reads ${status}`);
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

async function find(locator) {
  const by = typeof locator === "string" ? By.css(locator) : locator;
  return driver.wait(until.elementLocated(by), 15_000, `no element matches ${locator}`);
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
