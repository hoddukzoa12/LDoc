// Throwaway spike code. What the answers imply: normalised values, the guide's own
// arithmetic, and branches picked by what was typed. Pure over (template, model).

import { fmtDate, type Parsed, parseSlot, periodEnd, type YMD } from "./parse";
import { exclusiveSlots, type Model, render, slotOf, type Value } from "./render";
import type { Slot, Template } from "./types";

export type Suggestion = { text: string; note: string; origin: Value["origin"] };

export function toYMD(text: string): YMD | null {
  const m = text.match(/^(\d{4})년 (\d{1,2})월 (\d{1,2})일$/) ?? text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

export function systemToday(): YMD {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

export class Brain {
  readonly exclusive;
  constructor(
    readonly t: Template,
    readonly model: Model,
    readonly today: YMD,
  ) {
    this.exclusive = exclusiveSlots(t);
  }

  ctx() {
    return { today: this.today, date: (id: string) => this.dateOf(id) };
  }

  read(id: string, raw = this.model.values[id]?.raw ?? ""): Parsed {
    return parseSlot(slotOf(this.t, id), raw, this.ctx());
  }

  dateOf(id: string): YMD | null {
    const raw = this.model.values[id]?.raw;
    if (!raw) return null;
    const parsed = parseSlot({ ...slotOf(this.t, id), from: undefined }, raw, { today: this.today, date: () => null });
    return parsed.ok ? toYMD(parsed.text) : null;
  }

  /** A value other values may be computed from: typed (not itself computed) and readable. */
  private usable(id: string, visible: Set<string>): number | string | null {
    const value = this.model.values[id];
    if (!value?.raw || value.origin === "derived" || !visible.has(id)) return null;
    const parsed = this.read(id);
    if (!parsed.ok) return null;
    const n = Number(parsed.text.replace(/,/g, ""));
    return Number.isFinite(n) ? n : parsed.text;
  }

  visibleSlots() {
    const visible = new Set<string>();
    for (const line of render(this.t, this.model, "edit")) for (const span of line.spans) if (span.t === "slot") visible.add(span.slot);
    return visible;
  }

  derive(slot: Slot, visible = this.visibleSlots()): string | null {
    const rule = slot.derive;
    if (!rule) return null;
    const num = (id: string) => {
      const v = this.usable(id, visible);
      return typeof v === "number" ? v : null;
    };
    switch (rule.op) {
      case "copy": {
        if (this.usable(rule.from, visible) === null) return null;
        const parsed = this.read(rule.from);
        return parsed.ok ? parsed.text : null;
      }
      case "share": {
        const total = num(rule.total);
        if (total === null) return null;
        const rest = rule.minus.reduce((sum, id) => sum + (num(id) ?? 0), 0);
        const value = Math.round(total / rule.divisor) - rest;
        return value >= 0 ? value.toLocaleString("en-US") : null;
      }
      case "sum": {
        if (num(rule.need) === null) return null;
        const value = rule.of.reduce((sum, id) => sum + (num(id) ?? 0), 0) * rule.times;
        return value.toLocaleString("en-US");
      }
      case "ratio": {
        const a = num(rule.num);
        const b = num(rule.den);
        if (a === null || !b) return null;
        const value = Math.round(a / (b * rule.factor));
        return value >= 1 ? String(value) : null;
      }
    }
  }

  /** The grey value an empty blank offers. */
  suggestion(id: string, focused: boolean): Suggestion | null {
    const slot = slotOf(this.t, id);
    if (slot.derive) {
      const text = this.derive(slot);
      return text ? { text, note: slot.derive.note, origin: "derived" } : null;
    }
    if (slot.kind === "date" && !slot.from && focused) return { text: fmtDate(this.today), note: "오늘", origin: "today" };
    return null;
  }

  /** Normalise every blank except the focused one; keep computed values in step. Returns the slots whose text changed. */
  settle(focus: string | null): string[] {
    const changed: string[] = [];
    const visible = this.visibleSlots();
    for (const slot of this.t.slots) {
      const value = this.model.values[slot.id];
      if (!value || slot.id === focus) continue;
      let raw = value.raw;
      if (value.origin === "derived" && slot.derive) raw = this.derive(slot, visible) ?? raw;
      else if (value.months != null && slot.from) {
        const start = this.dateOf(slot.from);
        if (start) raw = fmtDate(periodEnd(start, value.months));
      } else if (raw) {
        const parsed = this.read(slot.id, raw);
        if (parsed.ok) {
          raw = parsed.text;
          if (parsed.months != null && slot.from) value.months = parsed.months;
        }
      }
      if (raw !== value.raw) {
        value.raw = raw;
        changed.push(slot.id);
      }
    }
    return changed;
  }

  private filledRead(id: string) {
    const value = this.model.values[id];
    return !!value?.raw && value.origin !== "derived" && this.read(id).ok;
  }

  /** Branches follow what was typed. Only picks the person did not make themselves. Returns whether any pick changed. */
  autoChoose(): boolean {
    let changed = false;
    for (const choice of this.t.choices) {
      const pick = this.model.picks[choice.id];
      if (pick && pick.by !== "auto") continue;
      let want: string | undefined;
      if (choice.auto) {
        const parsed = this.model.values[choice.auto.slot]?.raw ? this.read(choice.auto.slot) : null;
        if (parsed?.ok) {
          const test = choice.auto.test;
          const hit = test.op === "monthsAbove" ? (parsed.months ?? 0) > test.value : new RegExp(test.pattern).test(parsed.text);
          want = hit ? choice.auto.then : choice.auto.else;
        }
      }
      if (!want) {
        const keys = new Set(this.exclusive.filter((e) => e.choice === choice.id && this.filledRead(e.slot)).map((e) => e.key));
        if (keys.size === 1) want = [...keys][0];
      }
      if (want && want !== pick?.key) {
        this.model.picks[choice.id] = { key: want, by: "auto" };
        changed = true;
      } else if (!want && pick) {
        delete this.model.picks[choice.id];
        changed = true;
      }
    }
    return changed;
  }
}
