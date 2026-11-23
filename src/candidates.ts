// What answers read from pasted text do to a form. A turn's readable
// candidates fill the empty fields they agree on; the others wait beside their
// fields for the person. A candidate waits while its field may still be asked,
// as the core's `open_fields` decides what to offer: shown now, or hidden only
// behind a choice that is shown and not yet made. A choice that hides its
// field drops it, and so does an answer it would not change.

import type { Answer } from "./bindings/Answer";
import type { Candidate } from "./bindings/Candidate";
import type { Field } from "./bindings/Field";
import type { Form } from "./bindings/Form";
import type { Source } from "./bindings/Source";
import type { Answers } from "./ipc";

export type Readable = Extract<Candidate, { status: "readable" }>;

/** Where each answer read from pasted text came from, by field id. An answer the person typed has no entry. */
export type Filled = Record<string, Source[]>;

/** The part of a filling that pasted text changes. */
export type Assisted = { answers: Answers; filled: Filled; candidates: Readable[] };

/** The field is asked while the answer to its condition's field is, or includes, one of the values. */
export function isShown(field: Field, answers: Answers): boolean {
  const condition = field.show_when;
  if (!condition) return true;
  const answer = answers[condition.field] ?? [];
  const given = typeof answer === "string" ? [answer] : answer;
  return given.some((value) => condition.is_one_of.includes(value));
}

function answered(answer: Answer | undefined): boolean {
  if (answer === undefined) return false;
  return typeof answer === "string" ? answer.trim() !== "" : answer.length > 0;
}

/** The shown required fields of these that have no answer yet. */
export function unanswered(fields: Field[], answers: Answers): Field[] {
  return fields.filter((field) => field.required && isShown(field, answers) && !answered(answers[field.id]));
}

const fieldsOf = (form: Form) => form.steps.flatMap((step) => step.fields);

/** Equal as data: two answers, or two sources. */
const same = <T extends Answer | Source>(one: T, other: T) => JSON.stringify(one) === JSON.stringify(other);

/** Whether taking the value would change the answer: a different single answer, or a choice not yet ticked. */
function changes(field: Field, answer: Answer | undefined, value: Answer): boolean {
  if (!answered(answer)) return true;
  if (field.kind.type === "multi_choice" && Array.isArray(answer) && Array.isArray(value)) {
    return value.some((choice) => !answer.includes(choice));
  }
  return !same(answer!, value);
}

/** The candidates that still wait once the answers are these. Of two that would give a field the same value, the first stays. */
export function waiting(form: Form, answers: Answers, candidates: Readable[]): Readable[] {
  const fields = fieldsOf(form);
  const mayBeAsked = (field: Field): boolean => {
    if (isShown(field, answers)) return true;
    const condition = field.show_when;
    if (!condition || answered(answers[condition.field])) return false;
    const chooser = fields.find((candidate) => candidate.id === condition.field);
    return chooser !== undefined && isShown(chooser, answers);
  };
  return candidates.filter((candidate, index) => {
    const field = fields.find((each) => each.id === candidate.field);
    const repeated = candidates
      .slice(0, index)
      .some((earlier) => earlier.field === candidate.field && same(earlier.value, candidate.value));
    return field !== undefined && !repeated && mayBeAsked(field) && changes(field, answers[field.id], candidate.value);
  });
}

/** A multi-choice value adds to what is ticked, in the order of the options; any other replaces the answer. */
function merged(field: Field, current: Answer | undefined, value: Answer): Answer {
  if (field.kind.type !== "multi_choice" || !Array.isArray(value)) return value;
  const ticked = Array.isArray(current) ? current : [];
  return field.kind.options.map((option) => option.value).filter((key) => ticked.includes(key) || value.includes(key));
}

/** Each source once. */
function distinct(sources: Source[]): Source[] {
  return sources.filter((source, index) => sources.findIndex((other) => same(other, source)) === index);
}

/**
 * Fills the form with one turn's readable candidates. A shown field with no
 * answer takes its candidates' value when they agree; a multi-choice field
 * takes every choice they tick. A field the person already answered, one
 * whose candidates disagree, and one that already has candidates waiting are
 * left for the person. A filled choice can show more fields, so filling goes
 * on until it shows no new one with candidates; a field the answers do not
 * show is never filled.
 */
export function apply<T extends Assisted>(form: Form, state: T, readable: Readable[]): T {
  const contested = new Set(state.candidates.map((candidate) => candidate.field));
  let answers = state.answers;
  const filled: Filled = { ...state.filled };
  const left: Readable[] = [];
  let unseen = fieldsOf(form)
    .map((field) => ({ field, candidates: readable.filter((candidate) => candidate.field === field.id) }))
    .filter((group) => group.candidates.length > 0);
  for (;;) {
    const shown = unseen.filter((group) => isShown(group.field, answers));
    if (shown.length === 0) break;
    unseen = unseen.filter((group) => !shown.includes(group));
    for (const { field, candidates } of shown) {
      const values = candidates
        .map((candidate) => candidate.value)
        .filter((value, index, all) => all.findIndex((other) => same(other, value)) === index);
      const multi = field.kind.type === "multi_choice";
      if (answered(answers[field.id]) || contested.has(field.id) || (!multi && values.length > 1)) {
        left.push(...candidates);
        continue;
      }
      const value = multi ? merged(field, undefined, values.flat()) : values[0]!;
      answers = { ...answers, [field.id]: value };
      filled[field.id] = distinct(candidates.map((candidate) => candidate.source));
    }
  }
  // Fields still hidden: `waiting` keeps those behind a choice nobody made and drops the rest.
  const hidden = unseen.flatMap((group) => group.candidates);
  return { ...state, answers, filled, candidates: waiting(form, answers, [...state.candidates, ...left, ...hidden]) };
}

/**
 * Takes a waiting candidate as the field's answer. It decides a single-answer
 * field, so the field's other candidates go; a multi-choice one adds its choice.
 */
export function accept<T extends Assisted>(form: Form, state: T, taken: Readable): T {
  const field = fieldsOf(form).find((each) => each.id === taken.field);
  const rest = state.candidates.filter((candidate) => candidate !== taken);
  if (!field) return { ...state, candidates: rest };
  const multi = field.kind.type === "multi_choice";
  const answers = { ...state.answers, [field.id]: merged(field, state.answers[field.id], taken.value) };
  const sources = multi ? [...(state.filled[field.id] ?? []), taken.source] : [taken.source];
  return {
    ...state,
    answers,
    filled: { ...state.filled, [field.id]: distinct(sources) },
    candidates: waiting(form, answers, multi ? rest : rest.filter((candidate) => candidate.field !== field.id)),
  };
}

/** The person's own answer, or none when cleared. Either way the field no longer says it came from pasted text. */
export function answerByHand<T extends Assisted>(form: Form, state: T, id: string, value: Answer | undefined): T {
  const current = state.answers[id];
  // An input that reports the value it already holds has not been edited.
  if (value !== undefined && current !== undefined && same(current, value)) return state;
  const answers = value === undefined ? without(state.answers, id) : { ...state.answers, [id]: value };
  return { ...state, answers, filled: without(state.filled, id), candidates: waiting(form, answers, state.candidates) };
}

function without<V>(record: Record<string, V>, key: string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([each]) => each !== key));
}
