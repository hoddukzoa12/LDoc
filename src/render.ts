// Turns (template, answers) into lines. One walk serves the
// editor ("edit": undecided branches shown as alternatives), the finished text
// ("final": unchosen optional parts dropped) and the verbatim template
// ("template": every branch, every label, blanks as [label]).

import type { Block, Choice, Clause, Inline, Line, Slot, Template } from "./types";

export type Value = { raw: string; origin: "typed" | "derived" | "today" | "intent"; months?: number };
export type Pick = { key: string; by: "user" | "auto" | "intent" };
export type Model = { values: Record<string, Value>; picks: Record<string, Pick>; intents: Record<string, string>; open: string | null };
export type Mode = "edit" | "final" | "template";

export const emptyModel = (): Model => ({ values: {}, picks: {}, intents: {}, open: null });

export type RSpan =
  | { t: "text"; text: string; tentative?: string }
  | { t: "slot"; slot: string; occ: string; value: string; tentative?: string }
  | { t: "tag"; text: string; choice: string; key: string }
  | { t: "ref"; clause: string; text: string; tentative?: string }
  | { t: "intent"; choice: string; value: string };

export type RLine = {
  key: string;
  role: "title" | "preamble" | "heading" | "body" | "bar" | "closing";
  indent: number;
  clause: string | null;
  /** "choice:key" of the innermost undecided block branch the line sits in. */
  tentative: string | null;
  bar?: { choice: string; decided: string | null; open: boolean };
  spans: RSpan[];
};

type Counter = { para: number; item: number };
type TagOwner = { choice: string; key: string; decided: boolean } | null;
type Ctx = { role: RLine["role"]; clause: string | null; tentative: string | null; inline: string | undefined; owner: TagOwner; barred: Set<string>; counter: Counter };

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

export const isLine = (block: Block): block is Line => "indent" in block;

export function clauseVisible(clause: Clause, model: Model, mode: Mode) {
  if (!clause.when || mode === "template") return true;
  const key = model.picks[clause.when.choice]?.key;
  if (!key) return mode === "edit";
  return key !== clause.when.not;
}

export function clauseNumbers(t: Template, model: Model, mode: Mode) {
  const numbers: Record<string, number> = {};
  let n = 0;
  for (const clause of t.clauses) if (clauseVisible(clause, model, mode)) numbers[clause.id] = ++n;
  return numbers;
}

export function render(t: Template, model: Model, mode: Mode): RLine[] {
  const out: RLine[] = [];
  const numbers = clauseNumbers(t, model, mode);
  const picked = (choice: string) => model.picks[choice]?.key ?? null;
  const showTag = (owner: TagOwner) => mode === "template" || (mode === "edit" && !!owner && !owner.decided);

  function inlines(list: Inline[], path: string, ctx: Ctx, spans: RSpan[]) {
    list.forEach((inline, index) => {
      const here = `${path}${index}`;
      if (typeof inline === "string") spans.push({ t: "text", text: inline, tentative: ctx.inline });
      else if ("slot" in inline) {
        if (mode === "template") spans.push({ t: "text", text: `[${inline.label}]` });
        else spans.push({ t: "slot", slot: inline.slot, occ: here, value: model.values[inline.slot]?.raw ?? "", tentative: ctx.inline });
      } else if ("ref" in inline) spans.push({ t: "ref", clause: inline.ref, text: `제${numbers[inline.ref] ?? "?"}조`, tentative: ctx.inline });
      else if ("tag" in inline) {
        if (showTag(ctx.owner)) spans.push({ t: "tag", text: inline.tag, choice: ctx.owner?.choice ?? "", key: ctx.owner?.key ?? "" });
      } else {
        const key = picked(inline.choice);
        const keys = Object.keys(inline.variants);
        for (const k of shown(keys, key)) {
          const undecided = !key && mode !== "template";
          inlines(inline.variants[k], `${here}.${k}.`, { ...ctx, inline: undecided ? `${inline.choice}:${k}` : ctx.inline, owner: { choice: inline.choice, key: k, decided: !!key } }, spans);
        }
      }
    });
  }

  function shown(keys: string[], key: string | null) {
    if (mode === "template") return keys;
    if (key) return keys.includes(key) ? [key] : [];
    if (mode === "edit") return keys;
    return keys.length >= 2 ? keys : [];
  }

  function line(block: Line, key: string, ctx: Ctx) {
    const spans: RSpan[] = [];
    inlines(block.text, `${key}#`, ctx, spans);
    if (mode !== "template") renumber(spans, ctx.counter);
    const last = spans[spans.length - 1];
    if (mode !== "template" && last?.t === "text") last.text = last.text.trimEnd();
    if (spans.every((span) => span.t === "text" && !span.text.trim())) return;
    out.push({ key, role: ctx.role, indent: block.indent, clause: ctx.clause, tentative: ctx.tentative, spans: spans.filter((span) => span.t !== "text" || span.text) });
  }

  function bar(choice: string, key: string) {
    const decided = picked(choice);
    out.push({
      key,
      role: "bar",
      indent: 0,
      clause: null,
      tentative: null,
      bar: { choice, decided, open: model.open === choice },
      spans: decided && model.open !== choice ? [] : [{ t: "intent", choice, value: model.intents[choice] ?? "" }],
    });
  }

  function blocks(list: Block[], path: string, ctx: Ctx) {
    list.forEach((block, index) => {
      const here = `${path}${index}`;
      if (isLine(block)) return line(block, here, ctx);
      const key = picked(block.choice);
      const keys = Object.keys(block.variants);
      const alternative = keys.length >= 2;
      if (mode === "edit" && !ctx.barred.has(block.choice)) bar(block.choice, `${here}/bar`);
      const barred = new Set(ctx.barred).add(block.choice);
      let after = ctx.counter;
      shown(keys, key).forEach((k, i) => {
        const counter = alternative ? { ...ctx.counter } : ctx.counter;
        const undecided = !key && mode !== "template";
        blocks(block.variants[k], `${here}.${k}.`, {
          ...ctx,
          barred,
          counter,
          tentative: undecided ? `${block.choice}:${k}` : ctx.tentative,
          owner: { choice: block.choice, key: k, decided: !!key },
        });
        if (alternative && (key === k || (!key && i === 0))) after = counter;
      });
      if (after !== ctx.counter) Object.assign(ctx.counter, after);
    });
  }

  const base = (role: RLine["role"], clause: string | null): Ctx => ({ role, clause, tentative: null, inline: undefined, owner: null, barred: new Set(), counter: { para: 0, item: 0 } });

  out.push({ key: "title", role: "title", indent: 0, clause: null, tentative: null, spans: [{ t: "text", text: t.title }] });
  blocks(t.preamble, "pre/", base("preamble", null));
  for (const clause of t.clauses) {
    const ctx = base("body", clause.id);
    if (clause.when) {
      if (mode === "edit") bar(clause.when.choice, `c:${clause.id}/bar`);
      ctx.barred.add(clause.when.choice);
      if (!clauseVisible(clause, model, mode)) continue;
      const key = picked(clause.when.choice);
      if (!key && mode === "edit") ctx.tentative = `${clause.when.choice}:*`;
      ctx.owner = { choice: clause.when.choice, key: "", decided: !!key };
    }
    const heading: RSpan[] = [{ t: "ref", clause: clause.id, text: `제${numbers[clause.id]}조` }, { t: "text", text: " " }];
    inlines(clause.heading, `c:${clause.id}/h#`, ctx, heading);
    const last = heading[heading.length - 1];
    if (mode !== "template" && last.t === "text") last.text = last.text.trimEnd();
    out.push({ key: `c:${clause.id}/h`, role: "heading", indent: 0, clause: clause.id, tentative: ctx.tentative, spans: heading });
    blocks(clause.body, `c:${clause.id}/`, ctx);
  }
  blocks(t.closing, "close/", base("closing", null));
  return out;
}

/** Circled paragraph numbers and "N." items count only the lines that are shown. */
function renumber(spans: RSpan[], counter: Counter) {
  const first = spans[0];
  if (first?.t !== "text") return;
  if (CIRCLED.includes(first.text[0]) && first.text[1] === " ") {
    counter.para++;
    counter.item = 0;
    first.text = CIRCLED[counter.para - 1] + first.text.slice(1);
    return;
  }
  const item = first.text.match(/^(\d+)\. /);
  if (item) {
    counter.item++;
    first.text = `${counter.item}. ` + first.text.slice(item[0].length);
  }
}

export function spanText(span: RSpan) {
  if (span.t === "slot") return span.value;
  if (span.t === "intent") return "";
  return span.text;
}

export function linesToText(lines: RLine[]) {
  return lines
    .filter((line) => line.role !== "bar")
    .map((line) => line.spans.map(spanText).join("").trim())
    .filter(Boolean)
    .join("\n");
}

/** For each slot and each choice, the (choice:key) marks around every place it occurs. */
export function placePaths(t: Template) {
  const slots = new Map<string, string[][]>();
  const choices = new Map<string, string[][]>();
  const add = (map: Map<string, string[][]>, id: string, around: string[]) => map.set(id, [...(map.get(id) ?? []), around]);
  const visitInlines = (list: Inline[], around: string[]) => {
    for (const inline of list) {
      if (typeof inline === "string") continue;
      if ("slot" in inline) add(slots, inline.slot, around);
      else if ("choice" in inline) {
        add(choices, inline.choice, around);
        for (const [k, v] of Object.entries(inline.variants)) visitInlines(v, [...around, `${inline.choice}:${k}`]);
      }
    }
  };
  const visitBlocks = (list: Block[], around: string[]) => {
    for (const block of list) {
      if (isLine(block)) visitInlines(block.text, around);
      else {
        add(choices, block.choice, around);
        for (const [k, v] of Object.entries(block.variants)) visitBlocks(v, [...around, `${block.choice}:${k}`]);
      }
    }
  };
  visitBlocks(t.preamble, []);
  for (const clause of t.clauses) {
    if (clause.when) add(choices, clause.when.choice, []);
    visitInlines(clause.heading, []);
    visitBlocks(clause.body, []);
  }
  visitBlocks(t.closing, []);
  return { slots, choices };
}

export const slotPaths = (t: Template) => placePaths(t).slots;

/** Slots that occur only inside one variant of a choice: filling one picks that variant. */
export function exclusiveSlots(t: Template) {
  const result: { choice: string; key: string; slot: string }[] = [];
  for (const [slot, places] of slotPaths(t)) {
    for (const choice of t.choices) {
      for (const option of choice.options) {
        const mark = `${choice.id}:${option.key}`;
        if (places.every((around) => around.includes(mark))) result.push({ choice: choice.id, key: option.key, slot });
      }
    }
  }
  return result;
}

export function stats(t: Template) {
  const paths = slotPaths(t);
  let occurrences = 0;
  for (const places of paths.values()) occurrences += places.length;
  const shared = [...paths].filter(([, places]) => places.length > 1).map(([slot, places]) => `${slot}×${places.length}`);
  const kinds: Record<string, number> = {};
  for (const slot of t.slots) kinds[slot.kind] = (kinds[slot.kind] ?? 0) + 1;
  const unused = t.slots.filter((slot) => !paths.has(slot.id)).map((slot) => slot.id);
  return { choices: t.choices.length, slots: t.slots.length, occurrences, shared, kinds, unused, derived: t.slots.filter((slot) => slot.derive).map((slot) => slot.id) };
}

export const choiceOf = (t: Template, id: string): Choice => t.choices.find((choice) => choice.id === id)!;
export const slotOf = (t: Template, id: string): Slot => t.slots.find((slot) => slot.id === id)!;
