// Which answers read from pasted text still wait beside the form. A candidate
// waits while its field may still be asked, as the core's `open_fields`
// decides what to offer: shown now, or hidden only behind a choice that is
// shown and not yet made. A choice that hides its field drops it.

import type { Readable } from "./AssistPanel";
import type { Answer } from "./bindings/Answer";
import type { Field } from "./bindings/Field";
import type { Form } from "./bindings/Form";
import type { Answers } from "./ipc";

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

/** The candidates that still wait once the answers are these. */
export function waiting(form: Form, answers: Answers, candidates: Readable[]): Readable[] {
  const fields = form.steps.flatMap((step) => step.fields);
  const mayBeAsked = (field: Field): boolean => {
    if (isShown(field, answers)) return true;
    const condition = field.show_when;
    if (!condition || answered(answers[condition.field])) return false;
    const chooser = fields.find((candidate) => candidate.id === condition.field);
    return chooser !== undefined && isShown(chooser, answers);
  };
  return candidates.filter((candidate) => {
    const field = fields.find((each) => each.id === candidate.field);
    return field !== undefined && mayBeAsked(field);
  });
}

/**
 * The answers with `taken` accepted, and the candidates that still wait.
 * Accepting decides a single-answer field, so its other candidates go too;
 * a multi-choice candidate adds its choice to what is ticked.
 */
export function accept(
  form: Form,
  answers: Answers,
  candidates: Readable[],
  taken: Readable,
): { answers: Answers; candidates: Readable[] } {
  const field = form.steps.flatMap((step) => step.fields).find((each) => each.id === taken.field);
  if (!field) return { answers, candidates: candidates.filter((candidate) => candidate !== taken) };
  const multi = field.kind.type === "multi_choice";
  const next = { ...answers, [field.id]: merged(field, answers[field.id], taken.value) };
  const rest = candidates.filter((candidate) => candidate !== taken && (multi || candidate.field !== field.id));
  return { answers: next, candidates: waiting(form, next, rest) };
}

/** A multi-choice candidate adds to what is already ticked; any other replaces the answer. */
function merged(field: Field, current: Answer | undefined, value: Answer): Answer {
  if (field.kind.type !== "multi_choice" || !Array.isArray(value)) return value;
  const ticked = Array.isArray(current) ? current : [];
  return field.kind.options.map((option) => option.value).filter((key) => ticked.includes(key) || value.includes(key));
}
