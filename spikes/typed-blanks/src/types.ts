// Throwaway spike code. The shape a guide template compiles into. Nothing in the
// editor knows which document it is editing; it only reads these types.

export type SlotKind =
  | "party"
  | "person"
  | "date"
  | "period"
  | "money"
  | "time_range"
  | "time"
  | "weekday"
  | "count"
  | "percent"
  | "text";

/** One value the person supplies. A slot can sit in many places in the text. */
export type Slot = {
  id: string;
  /** What the empty blank and the open list show. */
  label: string;
  kind: SlotKind;
  /** date: a period typed here counts from this date slot (start + period − 1 day). */
  from?: string;
  /** count, percent: the unit the template prints after the blank; a typed copy is dropped. text: same, e.g. "은행". */
  unit?: string;
  range?: [number, number];
  /** weekday: the template's own spelling for a whole set of days, keyed by the days in order ("월화수목금"). */
  named?: Record<string, string>;
  derive?: Derive;
};

/** A value the guide itself defines from other values. Shown as a grey suggestion, accepted with Tab. */
export type Derive = { note: string; source: string } & (
  | { op: "copy"; from: string }
  /** total / divisor − Σ minus (only the minus slots that are in the document and filled) */
  | { op: "share"; total: string; divisor: number; minus: string[] }
  /** times × Σ of (only the slots that are in the document and filled; at least `need` of them) */
  | { op: "sum"; of: string[]; times: number; need: string }
  /** round(num / (den × factor)) */
  | { op: "ratio"; num: string; den: string; factor: number }
);

export type Choice = {
  id: string;
  label: string;
  options: { key: string; label: string }[];
  /** The guide's own rule for picking from a typed value. */
  auto?: { slot: string; test: { op: "monthsAbove"; value: number } | { op: "matches"; pattern: string }; then: string; else?: string; source: string };
};

export type Inline =
  | string
  /** `label` is the template's bracket text, kept so the template can be printed back verbatim. */
  | { slot: string; label: string }
  /** "제N조" of a clause, renumbered when clauses drop out. */
  | { ref: string }
  /** A drafter instruction such as "(정규직인 경우) ". Never part of the finished document. */
  | { tag: string }
  | { choice: string; variants: Record<string, Inline[]> };

export type Line = { indent: number; text: Inline[] };
export type Block = Line | { choice: string; variants: Record<string, Block[]> };
export type Clause = { id: string; heading: Inline[]; when?: { choice: string; not: string }; body: Block[] };

export type Template = {
  id: string;
  /** What the person types as the title to call this template up. */
  trigger: string;
  title: string;
  slots: Slot[];
  choices: Choice[];
  preamble: Block[];
  clauses: Clause[];
  closing: Block[];
};
