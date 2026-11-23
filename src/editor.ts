// A ProseMirror page over a compiled template. The document
// is a projection of (template, answers): clause text is read-only, blanks are
// marked text that starts with a zero-width sentinel so the caret always has a
// text node to sit in. Branch changes re-render the document from the answers.

import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { type Mark, type Node as PMNode, Schema } from "prosemirror-model";
import { EditorState, type Selection, TextSelection, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import { cannedReading, type IntentReading } from "./canned";
import { Brain, toYMD } from "./logic";
import { parseSlot, type YMD } from "./parse";
import { choiceOf, clauseNumbers, emptyModel, linesToText, type Model, placePaths, type RLine, render, slotOf, stats } from "./render";
import type { Template } from "./types";

const Z = "​";
const INTERNAL = "internal";
const PAUSE_MS = 600;

const schema = new Schema({
  nodes: {
    doc: { content: "line+" },
    line: {
      content: "text*",
      attrs: {
        key: { default: "" },
        role: { default: "free" },
        indent: { default: 0 },
        tentative: { default: "" },
        bar: { default: "" },
        decided: { default: "" },
        open: { default: false },
        rev: { default: 0 },
      },
      toDOM: (node) => ["p", { class: lineClass(node.attrs), "data-key": node.attrs.key }, 0],
      parseDOM: [{ tag: "p" }],
    },
    text: {},
  },
  marks: {
    slot: { attrs: { slot: {}, occ: {} }, inclusive: true, toDOM: (m) => ["span", { class: "blank", "data-slot": m.attrs.slot, "data-occ": m.attrs.occ }, 0] },
    intent: { attrs: { choice: {} }, inclusive: true, toDOM: (m) => ["span", { class: "intent", "data-choice": m.attrs.choice }, 0] },
    tag: { attrs: { choice: {}, key: {} }, inclusive: false, toDOM: (m) => ["span", { class: "tag", "data-choice": m.attrs.choice, "data-key": m.attrs.key }, 0] },
    ref: { attrs: { clause: {} }, inclusive: false, toDOM: (m) => ["span", { class: "ref", "data-clause": m.attrs.clause }, 0] },
    tentative: { attrs: { variant: {} }, inclusive: false, toDOM: (m) => ["span", { class: "tentative-inline", "data-variant": m.attrs.variant }, 0] },
  },
});

function lineClass(attrs: Record<string, any>) {
  const classes = ["line", `role-${attrs.role}`, `indent-${attrs.indent}`];
  if (attrs.tentative) classes.push("tentative");
  if (attrs.bar) classes.push("bar", attrs.decided && !attrs.open ? "decided" : "undecided");
  return classes.join(" ");
}

function toPM(lines: RLine[]): PMNode {
  return schema.node(
    "doc",
    null,
    lines.map((line) => {
      const content: PMNode[] = [];
      for (const span of line.spans) {
        const extra: Mark[] = "tentative" in span && span.tentative ? [schema.marks.tentative.create({ variant: span.tentative })] : [];
        if (span.t === "text" && span.text) content.push(schema.text(span.text, extra));
        if (span.t === "slot") content.push(schema.text(Z + span.value, [schema.marks.slot.create({ slot: span.slot, occ: span.occ }), ...extra]));
        if (span.t === "tag") content.push(schema.text(span.text, [schema.marks.tag.create({ choice: span.choice, key: span.key })]));
        if (span.t === "ref") content.push(schema.text(span.text, [schema.marks.ref.create({ clause: span.clause }), ...extra]));
        if (span.t === "intent") content.push(schema.text(Z + span.value, [schema.marks.intent.create({ choice: span.choice })]));
      }
      const attrs = { key: line.key, role: line.role, indent: line.indent, tentative: line.tentative ?? "", bar: line.bar?.choice ?? "", decided: line.bar?.decided ?? "", open: line.bar?.open ?? false };
      return schema.node("line", attrs, content);
    }),
  );
}

// ---- where the blanks are ---------------------------------------------------

type Range = { kind: "slot" | "intent"; id: string; occ: string; from: number; to: number; line: string };
type Bar = { choice: string; pos: number; key: string; decided: string; open: boolean };
type Scan = { ranges: Range[]; bars: Bar[]; refs: { clause: string; from: number; to: number }[] };

const scans = new WeakMap<PMNode, Scan>();
function scan(doc: PMNode): Scan {
  const cached = scans.get(doc);
  if (cached) return cached;
  const result: Scan = { ranges: [], bars: [], refs: [] };
  doc.forEach((line, offset) => {
    if (line.attrs.bar) result.bars.push({ choice: line.attrs.bar, pos: offset, key: line.attrs.key, decided: line.attrs.decided, open: line.attrs.open });
    let current: (Range & { uid: string }) | null = null;
    line.forEach((text, inner) => {
      const at = offset + 1 + inner;
      const ref = text.marks.find((m) => m.type === schema.marks.ref);
      if (ref) result.refs.push({ clause: ref.attrs.clause, from: at, to: at + text.nodeSize });
      const mark = text.marks.find((m) => m.type === schema.marks.slot || m.type === schema.marks.intent);
      if (!mark) return void (current = null);
      const isSlot = mark.type === schema.marks.slot;
      const uid = isSlot ? `s|${mark.attrs.occ}` : `i|${mark.attrs.choice}`;
      if (current && current.uid === uid && current.to === at) return void (current.to = at + text.nodeSize);
      current = { uid, kind: isSlot ? "slot" : "intent", id: isSlot ? mark.attrs.slot : mark.attrs.choice, occ: isSlot ? mark.attrs.occ : `bar:${mark.attrs.choice}`, from: at, to: at + text.nodeSize, line: line.attrs.key };
      result.ranges.push(current);
    });
  });
  scans.set(doc, result);
  return result;
}

const valueOf = (doc: PMNode, range: Range) => doc.textBetween(range.from, range.to).replaceAll(Z, "");

function rangeAround(doc: PMNode, from: number, to: number) {
  return scan(doc).ranges.find((range) => from >= range.from + 1 && to <= range.to) ?? null;
}

function focusOf(state: EditorState) {
  return rangeAround(state.doc, state.selection.from, state.selection.to);
}

type Stop = Range & { stop: string };
function stopsOf(doc: PMNode): Stop[] {
  const seen = new Set<string>();
  const stops: Stop[] = [];
  for (const range of scan(doc).ranges) {
    const stop = range.kind === "slot" ? `slot:${range.id}` : `bar:${range.id}`;
    if (seen.has(stop)) continue;
    seen.add(stop);
    stops.push({ ...range, stop });
  }
  return stops;
}

function selectionFor(doc: PMNode, range: Range): Selection {
  const value = valueOf(doc, range);
  if (range.kind === "slot" && value) return TextSelection.create(doc, range.from + 1, range.to);
  return TextSelection.create(doc, range.kind === "intent" ? range.to : range.from + 1);
}

type Target = { occ: string; id: string; anchor: number; head: number; pos: number } | { after: string } | { first: true } | { pos: number };

function resolveTarget(doc: PMNode, target: Target): Selection {
  const { ranges } = scan(doc);
  if ("occ" in target) {
    const range = ranges.find((r) => r.occ === target.occ);
    if (range) {
      const clamp = (n: number) => Math.max(range.from + 1, Math.min(range.to, range.from + n));
      return TextSelection.create(doc, clamp(target.anchor), clamp(target.head));
    }
    const same = ranges.find((r) => r.id === target.id);
    if (same) return TextSelection.create(doc, same.to);
  }
  if ("after" in target) {
    let pos = 0;
    doc.forEach((line, offset) => {
      if (line.attrs.key === target.after) pos = offset + line.nodeSize;
    });
    const next = stopsOf(doc).find((stop) => stop.from >= pos);
    if (next) return selectionFor(doc, next);
  }
  if ("first" in target) {
    const first = stopsOf(doc)[0];
    if (first) return selectionFor(doc, first);
  }
  const pos = "pos" in target ? target.pos : 1;
  return TextSelection.near(doc.resolve(Math.max(0, Math.min(pos, doc.content.size))));
}

/** The visible text of the document, without drafter labels, choice bars or sentinels. */
function docText(doc: PMNode) {
  const lines: string[] = [];
  doc.forEach((line) => {
    if (line.attrs.bar) return;
    let text = "";
    line.forEach((node) => {
      if (!node.marks.some((m) => m.type === schema.marks.tag)) text += node.text ?? "";
    });
    text = text.replaceAll(Z, "").trim();
    if (text) lines.push(text);
  });
  return lines.join("\n");
}

// ---- the editor ---------------------------------------------------------------

export function mountEditor(host: HTMLElement, panel: HTMLElement, T: Template, today: YMD) {
  const model: Model = emptyModel();
  const brain = new Brain(T, model, today);
  let accepted = false;
  let view: EditorView;
  let intentTimer = 0;
  let intent: { choice: string; typed: string; reading: IntentReading | null } | null = null;
  let numbers = clauseNumbers(T, model, "edit");
  const flash = new Map<string, number>();

  // -- phase 1: the title, and the whole template as one ghost

  function skeletonShown(state: EditorState) {
    if (accepted || !state.selection.empty) return false;
    const { $head } = state.selection;
    const index = $head.index(0);
    if (index === 0 || index !== state.doc.childCount - 1 || $head.parent.content.size !== 0) return false;
    return state.doc.child(index - 1).textContent.replace(/\s/g, "") === T.trigger;
  }

  function accept() {
    accepted = true;
    clearTimeout(intentTimer);
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, toPM(render(T, model, "edit")).content).setMeta(INTERNAL, true);
    tr.setSelection(resolveTarget(tr.doc, { first: true })).scrollIntoView();
    finish(view.state.apply(tr));
    host.scrollTop = 0;
  }

  // -- every change goes through here

  function onTransaction(tr: Transaction) {
    const prev = view.state;
    if (!accepted) {
      view.updateState(prev.apply(tr));
      refreshPanel();
      return;
    }
    if (!tr.docChanged || tr.getMeta(INTERNAL)) return finish(prev.apply(tr));
    const edit = checkEdit(prev, tr);
    if (!edit) return reject(prev, tr);
    let state = prev.apply(tr);
    const fix = state.tr.setMeta(INTERNAL, true);
    for (const mark of edit.marks) fix.addMark(edit.range.from, edit.newTo, mark);
    state = state.apply(fix);
    const range = { ...edit.range, to: edit.newTo };
    const raw = valueOf(state.doc, range);
    if (range.kind === "slot") {
      model.values[range.id] = { raw, origin: "typed" };
      state = syncSlot(state, range.id, range.occ);
    } else {
      model.intents[range.id] = raw;
      typedIntent(range.id, raw);
    }
    finish(state);
  }

  /** Edits may only touch the inside of one blank, and may not split or join lines. */
  function checkEdit(prev: EditorState, tr: Transaction) {
    if (tr.doc.childCount !== prev.doc.childCount) return null;
    const start = prev.doc.content.findDiffStart(tr.doc.content);
    if (start == null) return null;
    const end = prev.doc.content.findDiffEnd(tr.doc.content)!;
    let endA = end.a;
    let endB = end.b;
    if (endA < start) {
      endB += start - endA;
      endA = start;
    }
    if (endB < start) {
      endA += start - endB;
      endB = start;
    }
    const range = rangeAround(prev.doc, start, endA);
    if (!range || !tr.doc.resolve(start).sameParent(tr.doc.resolve(endB))) return null;
    return { range, newTo: range.to + (endB - endA), marks: prev.doc.nodeAt(range.from)!.marks };
  }

  /** A refused edit. The browser may already have changed the page, so redraw the lines it touched. */
  function reject(prev: EditorState, tr: Transaction) {
    const start = prev.doc.content.findDiffStart(tr.doc.content) ?? prev.selection.from;
    const redraw = prev.tr.setMeta(INTERNAL, true);
    prev.doc.forEach((line, offset) => {
      if (start >= offset && start <= offset + line.nodeSize) redraw.setNodeMarkup(offset, null, { ...line.attrs, rev: line.attrs.rev + 1 });
    });
    view.updateState(prev.apply(redraw));
  }

  /** Every occurrence of a slot shows its one value. */
  function syncSlot(state: EditorState, id: string, except?: string) {
    const raw = model.values[id]?.raw ?? "";
    const tr = state.tr.setMeta(INTERNAL, true);
    const ranges = scan(state.doc).ranges.filter((r) => r.kind === "slot" && r.id === id && r.occ !== except);
    for (const range of ranges.reverse()) {
      if (valueOf(state.doc, range) === raw) continue;
      const marks = state.doc.nodeAt(range.from)!.marks;
      if (raw) tr.replaceWith(range.from + 1, range.to, schema.text(raw, marks));
      else tr.delete(range.from + 1, range.to);
    }
    return tr.docChanged ? state.apply(tr) : state;
  }

  function targetOf(state: EditorState): Target {
    const focus = focusOf(state);
    if (focus) return { occ: focus.occ, id: focus.id, anchor: state.selection.anchor - focus.from, head: state.selection.head - focus.from, pos: state.selection.head };
    return { pos: state.selection.head };
  }

  function rerender(state: EditorState, target: Target, scroll = true) {
    const tr = state.tr.replaceWith(0, state.doc.content.size, toPM(render(T, model, "edit")).content).setMeta(INTERNAL, true);
    tr.setSelection(resolveTarget(tr.doc, target));
    if (scroll) tr.scrollIntoView();
    const next = clauseNumbers(T, model, "edit");
    const until = performance.now() + 6000;
    for (const [clause, n] of Object.entries(next)) if (numbers[clause] !== undefined && numbers[clause] !== n) flash.set(clause, until);
    numbers = next;
    if (flash.size) setTimeout(() => view.dispatch(view.state.tr.setMeta(INTERNAL, true)), 6100);
    return state.apply(tr);
  }

  /** Normalise blanks the caret has left, keep computed values current, follow branches, redraw. */
  function finish(state: EditorState) {
    if (!view.composing) {
      for (let round = 0; round < 3; round++) {
        const focus = focusOf(state);
        for (const id of brain.settle(focus?.kind === "slot" ? focus.id : null)) state = syncSlot(state, id);
        if (!brain.autoChoose()) break;
        state = rerender(state, targetOf(state), false);
      }
    }
    view.updateState(state);
    refreshPanel();
  }

  function pick(choice: string, key: string, target: Target) {
    model.picks[choice] = { key, by: "user" };
    model.open = null;
    model.intents[choice] = "";
    intent = null;
    finish(rerender(view.state, target));
  }

  function toggleOpen(choice: string) {
    model.open = model.open === choice ? null : choice;
    finish(rerender(view.state, targetOf(view.state), false));
  }

  // -- free text at a branch: the canned stand-in for a model

  function typedIntent(choice: string, typed: string) {
    clearTimeout(intentTimer);
    intent = null;
    if (!typed.trim()) return;
    intentTimer = window.setTimeout(() => {
      if (view.composing || model.intents[choice] !== typed) return;
      intent = { choice, typed, reading: cannedReading(T.id, choice, typed) };
      view.dispatch(view.state.tr.setMeta(INTERNAL, true));
    }, PAUSE_MS);
  }

  function applyIntent(barKey: string) {
    const reading = intent?.reading;
    if (!reading || !intent) return false;
    for (const [choice, key] of Object.entries(reading.picks)) model.picks[choice] = { key, by: "intent" };
    for (const [id, value] of Object.entries(reading.values)) model.values[id] = { ...value };
    model.intents[intent.choice] = "";
    intent = null;
    finish(rerender(view.state, { after: barKey }));
    return true;
  }

  // -- keys

  function move(dir: 1 | -1) {
    const state = view.state;
    const stops = stopsOf(state.doc);
    if (!stops.length) return;
    const focus = focusOf(state);
    const at = focus ? (dir === 1 ? focus.to : focus.from) : state.selection.head;
    const next = dir === 1 ? (stops.find((s) => s.from >= at && s.occ !== focus?.occ) ?? stops[0]) : ([...stops].reverse().find((s) => s.to <= at && s.occ !== focus?.occ) ?? stops[stops.length - 1]);
    view.dispatch(state.tr.setSelection(selectionFor(state.doc, next)).scrollIntoView());
  }

  function tab(dir: 1 | -1) {
    if (view.composing) return false;
    if (!accepted) {
      if (dir === 1 && skeletonShown(view.state)) {
        accept();
        return true;
      }
      return false;
    }
    const focus = focusOf(view.state);
    if (dir === 1 && focus?.kind === "slot" && !valueOf(view.state.doc, focus)) {
      const suggestion = brain.suggestion(focus.id, true);
      if (suggestion) {
        model.values[focus.id] = { raw: suggestion.text, origin: suggestion.origin };
        finish(syncSlot(view.state, focus.id));
      }
    }
    if (dir === 1 && focus?.kind === "intent" && intent?.choice === focus.id && intent.reading) return applyIntent(focus.line);
    move(dir);
    return true;
  }

  function keydown(event: KeyboardEvent) {
    if (view.composing || event.isComposing || event.keyCode === 229) return false;
    if ((event.key === "Tab" || event.keyCode === 9) && !event.ctrlKey && !event.metaKey && !event.altKey) return tab(event.shiftKey ? -1 : 1);
    if (!accepted) return false;
    const focus = focusOf(view.state);
    if (focus?.kind === "intent" && /^[1-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey && !valueOf(view.state.doc, focus)) {
      const option = choiceOf(T, focus.id).options[Number(event.key) - 1];
      if (option) {
        pick(focus.id, option.key, { after: focus.line });
        return true;
      }
    }
    if (event.key === "Enter" && focus) return tab(1);
    if (event.key === "Enter") return true;
    if (event.key === "Escape" && intent) {
      intent = null;
      view.dispatch(view.state.tr.setMeta(INTERNAL, true));
      return true;
    }
    return false;
  }

  function textInput(_view: EditorView, from: number, to: number, text: string) {
    if (!accepted) return false;
    if (!rangeAround(view.state.doc, from, to)) {
      reject(view.state, view.state.tr);
      return true;
    }
    view.dispatch(view.state.tr.insertText(text, from, to));
    return true;
  }

  /** A caret just before a blank's sentinel belongs inside the blank. */
  function normaliseSelection(state: EditorState) {
    if (!accepted || !state.selection.empty) return null;
    const head = state.selection.head;
    const range = scan(state.doc).ranges.find((r) => r.from === head);
    return range ? state.tr.setSelection(TextSelection.create(state.doc, range.from + 1)).setMeta(INTERNAL, true) : null;
  }

  // -- what is drawn on top of the document

  function decorations(state: EditorState) {
    if (!accepted) {
      if (!skeletonShown(state)) return null;
      return DecorationSet.create(state.doc, [Decoration.widget(state.selection.head, () => skeletonElement(), { side: 1, key: "skeleton", ignoreSelection: true })]);
    }
    const composing = view?.composing ?? false;
    const focus = focusOf(state);
    const decos: Decoration[] = [];
    const { ranges, bars, refs } = scan(state.doc);
    for (const range of ranges) {
      const focused = focus?.occ === range.occ;
      const value = valueOf(state.doc, range);
      if (range.kind === "intent") {
        if (!value && !focused) decos.push(Decoration.widget(range.from + 1, () => note("숫자로 고르거나 말로 적어도 됩니다", "intent-hint"), { side: 1, key: `ih:${range.occ}` }));
        if (intent && intent.choice === range.id && !composing) decos.push(Decoration.widget(range.to, () => intentElement(intent!), { side: 1, key: `iv:${intent.typed}:${!!intent.reading}` }));
        continue;
      }
      const slot = slotOf(T, range.id);
      if (focused) decos.push(Decoration.inline(range.from, range.to, { class: "is-focus" }));
      if (!value) {
        const suggestion = composing ? null : brain.suggestion(range.id, focused);
        const hint = focused && !suggestion && slot.from ? "1년, 6개월처럼 기간도 됩니다" : "";
        const key = `ph:${range.occ}:${focused}:${suggestion?.text ?? ""}:${hint}`;
        decos.push(Decoration.widget(range.from + 1, () => placeholder(slot.label, suggestion, focused, hint, range.occ), { side: 1, key }));
        continue;
      }
      const parsed = parseSlot(slot, value, brain.ctx());
      const origin = model.values[range.id]?.origin;
      const classes = ["filled"];
      if (!parsed.ok && !focused) classes.push(parsed.pending ? "pending" : "unread");
      if (origin === "derived" || origin === "today" || origin === "intent") classes.push("computed");
      decos.push(Decoration.inline(range.from + 1, range.to, { class: classes.join(" ") }));
      if (focused && !composing && parsed.ok && (parsed.text !== value.replace(/\s+/g, " ").trim() || parsed.note)) {
        decos.push(Decoration.widget(range.to, () => note(`→ ${parsed.text}${parsed.note ? `  (${parsed.note})` : ""}`, "preview"), { side: 1, key: `pv:${parsed.text}:${parsed.note}` }));
      }
      if (!parsed.ok && !focused) decos.push(Decoration.widget(range.to, () => note(parsed.pending ? parsed.reason : `읽지 못함: ${parsed.reason}`, parsed.pending ? "wait" : "badge"), { side: 1, key: `ur:${parsed.reason}` }));
    }
    for (const bar of bars) {
      const choice = choiceOf(T, bar.choice);
      decos.push(Decoration.widget(bar.pos + 1, () => barElement(choice.id, bar.decided, bar.open, bar.key), { side: -1, key: `bar:${bar.key}:${bar.decided}:${bar.open}:${model.picks[bar.choice]?.by}` }));
    }
    const now = performance.now();
    for (const ref of refs) if ((flash.get(ref.clause) ?? 0) > now) decos.push(Decoration.inline(ref.from, ref.to, { class: "flash" }));
    return DecorationSet.create(state.doc, decos);
  }

  function note(text: string, className: string) {
    const el = document.createElement("span");
    el.className = className;
    el.contentEditable = "false";
    el.textContent = text;
    return el;
  }

  function placeholder(label: string, suggestion: { text: string; note: string } | null, focused: boolean, hint: string, occ: string) {
    const el = document.createElement("span");
    el.className = `ph${focused ? " focused" : ""}${suggestion ? " suggest" : ""}`;
    el.contentEditable = "false";
    el.textContent = suggestion ? suggestion.text : label;
    const small = suggestion ? `${suggestion.note}${focused ? " · Tab" : ""}` : hint;
    if (small) {
      const s = document.createElement("small");
      s.textContent = small;
      el.append(s);
    }
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      jumpTo(occ);
    });
    return el;
  }

  function intentElement(current: NonNullable<typeof intent>) {
    const el = document.createElement("span");
    el.contentEditable = "false";
    el.className = current.reading ? "intent-reading" : "intent-none";
    if (current.reading) {
      el.textContent = `→ ${current.reading.text}  Tab`;
      const s = document.createElement("small");
      s.textContent = "준비된 예시 응답 · 실제 제품에서는 여기서 모델이 읽습니다";
      el.append(s);
    } else el.textContent = "(이 예시에는 이 문장의 응답이 준비돼 있지 않습니다)";
    return el;
  }

  function barElement(choiceId: string, decided: string, open: boolean, barKey: string) {
    const choice = choiceOf(T, choiceId);
    const el = document.createElement("span");
    el.contentEditable = "false";
    el.dataset.bar = choiceId;
    if (decided && !open) {
      el.className = "chip";
      const option = choice.options.find((o) => o.key === decided);
      const by = model.picks[choiceId]?.by;
      el.textContent = `${choice.label}: ${option?.label ?? decided}${by === "auto" ? " (입력에서)" : by === "intent" ? " (말에서)" : ""} ▾`;
      el.addEventListener("mousedown", (event) => {
        event.preventDefault();
        toggleOpen(choiceId);
      });
      return el;
    }
    el.className = "bar-controls";
    const label = document.createElement("b");
    label.textContent = decided ? `${choice.label} 바꾸기` : `${choice.label} · 아직 안 고름`;
    el.append(label);
    choice.options.forEach((option, index) => {
      const button = document.createElement("span");
      button.className = `opt${decided === option.key ? " current" : ""}`;
      button.dataset.choice = choiceId;
      button.dataset.key = option.key;
      button.textContent = `${index + 1} ${option.label}`;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        pick(choiceId, option.key, { after: barKey });
      });
      el.append(button);
    });
    return el;
  }

  function skeletonElement() {
    const root = document.createElement("span");
    root.className = "skeleton";
    root.contentEditable = "false";
    root.setAttribute("aria-hidden", "true");
    for (const line of render(T, emptyModel(), "edit").slice(1)) {
      const row = document.createElement("span");
      row.className = `${lineClass({ role: line.role, indent: line.indent, tentative: line.tentative, bar: line.bar?.choice ?? "", decided: "", open: false })} ghost-line`;
      if (line.bar) {
        const choice = choiceOf(T, line.bar.choice);
        row.textContent = `◇ ${choice.label} · 아직 안 고름   ${choice.options.map((o, i) => `${i + 1} ${o.label}`).join("   ")}`;
      }
      for (const span of line.spans) {
        if (span.t === "slot") {
          const ph = document.createElement("span");
          ph.className = "ph";
          ph.textContent = slotOf(T, span.slot).label;
          row.append(ph);
        } else if (span.t === "tag") {
          const tagEl = document.createElement("span");
          tagEl.className = "tag";
          tagEl.textContent = span.text;
          row.append(tagEl);
        } else if (span.t !== "intent") {
          const text = document.createElement("span");
          if ("tentative" in span && span.tentative) text.className = "tentative-inline";
          text.textContent = span.text;
          row.append(text);
        }
      }
      root.append(row);
    }
    return root;
  }

  // -- the list of what is still open

  type Item = { where: string; label: string; state: string; occ: string | null; pos: number; cond: boolean };

  const places = placePaths(T);
  /** Only matters for some answers to a branch still open, rather than whichever way it goes. */
  function conditional(around: string[][]) {
    const pickOf = (mark: string) => model.picks[mark.split(":")[0]]?.key;
    const live = around.filter((path) => path.every((m) => !pickOf(m) || pickOf(m) === m.split(":")[1]));
    if (live.some((path) => path.every((m) => pickOf(m)))) return false;
    const open = new Map<string, Set<string>>();
    for (const path of live) {
      for (const mark of path) {
        const [choice, key] = mark.split(":");
        if (model.picks[choice]) continue;
        if (!open.has(choice)) open.set(choice, new Set());
        open.get(choice)!.add(key);
      }
    }
    for (const [choice, keys] of open) if (choiceOf(T, choice).options.every((o) => keys.has(o.key))) return false;
    return true;
  }

  function openItems(): Item[] {
    const items: Item[] = [];
    if (!accepted) return items;
    const doc = view.state.doc;
    const { ranges } = scan(doc);
    const seen = new Set<string>();
    let where = "전문";
    doc.forEach((line, offset) => {
      const key: string = line.attrs.key;
      if (line.attrs.role === "heading") where = line.textContent.split(" ")[0];
      if (line.attrs.role === "closing") where = "서명란";
      if (line.attrs.bar && !line.attrs.decided) {
        const choice = choiceOf(T, line.attrs.bar);
        if (!seen.has(`c:${choice.id}`)) {
          seen.add(`c:${choice.id}`);
          items.push({ where: /^c:[^/]+\/bar$/.test(key) ? whereOfBar(doc, offset) : where, label: choice.label, state: "고르지 않음", occ: `bar:${choice.id}`, pos: offset + 1, cond: conditional(places.choices.get(choice.id)!) });
        }
      }
      line.forEach((node, inner) => {
        const variant = node.marks.find((m) => m.type === schema.marks.tentative)?.attrs.variant as string | undefined;
        const choiceId = variant?.split(":")[0];
        if (choiceId && !model.picks[choiceId] && !seen.has(`c:${choiceId}`) && !scan(doc).bars.some((b) => b.choice === choiceId)) {
          seen.add(`c:${choiceId}`);
          items.push({ where, label: choiceOf(T, choiceId).label, state: "고르지 않음 (이름표를 눌러 고름)", occ: null, pos: offset + 1 + inner, cond: conditional(places.choices.get(choiceId)!) });
        }
      });
      for (const range of ranges) {
        if (range.line !== key || range.kind !== "slot" || seen.has(`s:${range.id}`)) continue;
        seen.add(`s:${range.id}`);
        const value = valueOf(doc, range);
        const slot = slotOf(T, range.id);
        if (!value) {
          const suggestion = brain.suggestion(range.id, false);
          items.push({ where, label: slot.label, state: suggestion ? `제안 ${suggestion.text}` : "빈칸", occ: range.occ, pos: range.from + 1, cond: conditional(places.slots.get(range.id)!) });
        } else {
          const parsed = parseSlot(slot, value, brain.ctx());
          if (!parsed.ok) items.push({ where, label: slot.label, state: parsed.pending ? `기다림: ${parsed.reason}` : `읽지 못함 ‘${value}’`, occ: range.occ, pos: range.from + 1, cond: false });
        }
      }
    });
    return items;
  }

  function whereOfBar(doc: PMNode, offset: number) {
    let label = "";
    let found = false;
    doc.forEach((line, at) => {
      if (found || at < offset) return;
      if (line.attrs.role === "heading") {
        label = line.textContent.split(" ")[0];
        found = true;
      }
    });
    return label || "서명란";
  }

  let items: Item[] = [];
  function refreshPanel() {
    items = openItems();
    panel.replaceChildren();
    const head = document.createElement("h2");
    const firm = items.filter((item) => !item.cond).length;
    const cond = items.length - firm;
    head.textContent = !accepted ? "남은 항목" : items.length ? `남은 항목 ${firm}` : "남은 항목 없음";
    panel.append(head);
    if (accepted && cond) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = `흐린 ${cond}개는 아직 고르지 않은 갈래 안에 있어, 고르는 데 따라 필요하거나 사라집니다.`;
      panel.append(p);
    }
    if (!accepted) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "제목을 치고 Enter, Tab으로 받아들이면 여기에 빈칸과 고를 곳이 나옵니다.";
      panel.append(p);
      return;
    }
    const list = document.createElement("ol");
    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.dataset.index = String(index);
      li.dataset.occ = item.occ ?? "";
      if (item.cond) li.className = "cond";
      const where = document.createElement("span");
      where.className = "where";
      where.textContent = item.where;
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = item.label;
      const state = document.createElement("span");
      state.className = `state${item.state.startsWith("읽지") ? " bad" : item.state.startsWith("제안") ? " offer" : ""}`;
      state.textContent = item.state;
      li.append(where, label, state);
      li.addEventListener("mousedown", (event) => {
        event.preventDefault();
        if (item.occ) jumpTo(item.occ);
        else jumpToPos(item.pos);
      });
      list.append(li);
    });
    panel.append(list);
  }

  function jumpTo(occ: string) {
    const range = scan(view.state.doc).ranges.find((r) => r.occ === occ);
    if (!range) return;
    view.focus();
    view.dispatch(view.state.tr.setSelection(selectionFor(view.state.doc, range)).scrollIntoView());
  }

  function jumpToPos(pos: number) {
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))).scrollIntoView());
  }

  // -- mount

  const start = schema.node("doc", null, [schema.node("line")]);
  view = new EditorView(host, {
    state: EditorState.create({
      doc: start,
      plugins: [keymap(baseKeymap)],
    }),
    dispatchTransaction(tr) {
      onTransaction(tr);
      const fix = normaliseSelection(view.state);
      if (fix) view.updateState(view.state.apply(fix));
    },
    decorations,
    scrollMargin: 160,
    scrollThreshold: 160,
    handleKeyDown: (_view, event) => keydown(event),
    handleTextInput: textInput,
    handleClick(_view, _pos, event) {
      const tag = (event.target as HTMLElement).closest?.(".tag") as HTMLElement | null;
      const choice = tag?.dataset.choice;
      const key = tag?.dataset.key;
      if (!accepted || !choice || !key || model.picks[choice]) return false;
      pick(choice, key, targetOf(view.state));
      return true;
    },
    handleDOMEvents: {
      compositionstart() {
        clearTimeout(intentTimer);
        intent = null;
        setTimeout(() => view.dispatch(view.state.tr.setMeta(INTERNAL, true)), 0);
        return false;
      },
      compositionend() {
        setTimeout(() => accepted && finish(view.state), 0);
        return false;
      },
    },
  });
  refreshPanel();

  return {
    view,
    model,
    accepted: () => accepted,
    skeleton: () => skeletonShown(view.state),
    text: () => docText(view.state.doc),
    finalText: () => linesToText(render(T, model, "final")),
    templateText: () => linesToText(render(T, emptyModel(), "template")),
    focus: () => {
      const focus = focusOf(view.state);
      return focus ? { kind: focus.kind, id: focus.id, occ: focus.occ, value: valueOf(view.state.doc, focus) } : null;
    },
    items: () => items.map((item) => `${item.where} · ${item.label} — ${item.state}${item.cond ? " (갈래에 따라)" : ""}`),
    clickItem: (index: number) => {
      const item = items[index];
      if (item?.occ) jumpTo(item.occ);
      else if (item) jumpToPos(item.pos);
    },
    value: (id: string) => model.values[id]?.raw ?? null,
    stats: () => stats(T),
    parse: (slotId: string, raw: string, start?: string) => parseSlot(slotOf(T, slotId), raw, { today, date: () => (start ? toYMD(start) : null) }),
    intent: () => (intent ? { typed: intent.typed, reading: intent.reading?.text ?? null } : null),
  };
}
