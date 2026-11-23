import { describe, expect, test } from "vitest";
import type { Field } from "./bindings/Field";
import type { Form } from "./bindings/Form";
import type { Source } from "./bindings/Source";
import { type Assisted, type Readable, accept, answerByHand, apply, unanswered, waiting } from "./candidates";

function field(id: string, kind: Field["kind"], show_when: Field["show_when"] = null): Field {
  return { id, label: id, help: null, kind, required: true, show_when, sensitivity: "public" };
}

const options = (...values: string[]) => values.map((value) => ({ value, label: value }));

const form: Form = {
  steps: [
    {
      title: "거래",
      fields: [
        field("trade_type", { type: "choice", options: options("one_time", "continuous") }),
        field("supplied_on", { type: "date" }, { field: "trade_type", is_one_of: ["one_time"] }),
        field("total", { type: "money" }),
        field("evidence", { type: "multi_choice", options: options("contract", "statement", "tax_invoice") }),
      ],
    },
  ],
};

const quote = (text: string): Source => ({ by: "quote", text });

const candidate = (field: string, value: Readable["value"], source: Source = { by: "choice" }): Readable => ({
  status: "readable",
  field,
  value,
  source,
});

const empty: Assisted = { answers: {}, filled: {}, candidates: [] };

describe("a turn's candidates", () => {
  test("fill an empty field and say where its value came from", () => {
    const total = candidate("total", "10,000,000", quote("10,000,000원"));
    const after = apply(form, empty, [total]);
    expect(after.answers).toEqual({ total: "10,000,000" });
    expect(after.filled).toEqual({ total: [quote("10,000,000원")] });
    expect(after.candidates).toEqual([]);
  });

  test("give a multi-choice field every choice they tick, in the order of the options", () => {
    const after = apply(form, empty, [candidate("evidence", ["tax_invoice"]), candidate("evidence", ["contract"])]);
    expect(after.answers).toEqual({ evidence: ["contract", "tax_invoice"] });
    expect(after.candidates).toEqual([]);
  });

  test("that disagree on a single-answer field leave it empty and both wait", () => {
    const ten = candidate("total", "10,000,000", quote("10,000,000원"));
    const three = candidate("total", "3,000,000", quote("3,000,000원"));
    const after = apply(form, empty, [ten, three]);
    expect(after.answers).toEqual({});
    expect(after.filled).toEqual({});
    expect(after.candidates).toEqual([ten, three]);
  });

  test("that agree fill the field once", () => {
    const after = apply(form, empty, [candidate("total", "10,000,000", quote("10,000,000원")), candidate("total", "10,000,000")]);
    expect(after.answers).toEqual({ total: "10,000,000" });
    expect(after.candidates).toEqual([]);
  });

  test("do not overwrite an answer: a different value waits and the same value goes", () => {
    const answered: Assisted = { ...empty, answers: { total: "7,000,000", evidence: ["statement"] } };
    const ten = candidate("total", "10,000,000");
    const after = apply(form, answered, [ten, candidate("total", "7,000,000"), candidate("evidence", ["statement"])]);
    expect(after.answers).toEqual(answered.answers);
    expect(after.filled).toEqual({});
    expect(after.candidates).toEqual([ten]);
  });

  test("fill a field behind a choice when the same turn makes the choice", () => {
    const after = apply(form, empty, [candidate("supplied_on", "2026-03-02"), candidate("trade_type", "one_time")]);
    expect(after.answers).toEqual({ trade_type: "one_time", supplied_on: "2026-03-02" });
    expect(after.candidates).toEqual([]);
  });

  test("do not fill a field the turn's own choice hides", () => {
    const after = apply(form, empty, [candidate("supplied_on", "2026-03-02"), candidate("trade_type", "continuous")]);
    expect(after.answers).toEqual({ trade_type: "continuous" });
    expect(after.candidates).toEqual([]);
  });

  test("for a field behind a choice nobody made wait until the choice shows it", () => {
    const supplied = candidate("supplied_on", "2026-03-02");
    const after = apply(form, empty, [supplied]);
    expect(after.answers).toEqual({});
    expect(after.candidates).toEqual([supplied]);
    expect(waiting(form, { trade_type: "one_time" }, after.candidates)).toEqual([supplied]);
    expect(waiting(form, { trade_type: "continuous" }, after.candidates)).toEqual([]);
  });

  test("leave a field that already has candidates waiting to the person", () => {
    const ten = candidate("total", "10,000,000");
    const three = candidate("total", "3,000,000");
    const seven = candidate("total", "7,000,000");
    const after = apply(form, apply(form, empty, [ten, three]), [seven]);
    expect(after.answers).toEqual({});
    expect(after.candidates).toEqual([ten, three, seven]);
  });
});

describe("the person", () => {
  test("accepting one of two candidates decides the field and marks where it came from", () => {
    const ten = candidate("total", "10,000,000", quote("10,000,000원"));
    const three = candidate("total", "3,000,000", quote("3,000,000원"));
    const after = accept(form, apply(form, empty, [ten, three]), three);
    expect(after.answers).toEqual({ total: "3,000,000" });
    expect(after.filled).toEqual({ total: [quote("3,000,000원")] });
    expect(after.candidates).toEqual([]);
  });

  test("accepting a multi-choice candidate adds its choice to what is ticked", () => {
    const contract = candidate("evidence", ["contract"]);
    const after = accept(form, { ...empty, answers: { evidence: ["statement"] }, candidates: [contract] }, contract);
    expect(after.answers).toEqual({ evidence: ["contract", "statement"] });
    expect(after.candidates).toEqual([]);
  });

  test("answering a filled field by hand removes its mark, and clearing removes the answer too", () => {
    const filled = apply(form, empty, [candidate("total", "10,000,000", quote("10,000,000원"))]);
    const typed = answerByHand(form, filled, "total", "9,000,000");
    expect(typed.answers).toEqual({ total: "9,000,000" });
    expect(typed.filled).toEqual({});
    const cleared = answerByHand(form, filled, "total", undefined);
    expect(cleared.answers).toEqual({});
    expect(cleared.filled).toEqual({});
  });

  test("typing the value a candidate holds drops the candidate", () => {
    const ten = candidate("total", "10,000,000");
    const three = candidate("total", "3,000,000");
    const after = answerByHand(form, apply(form, empty, [ten, three]), "total", "3,000,000");
    expect(after.candidates).toEqual([ten]);
  });
});

test("the required fields left are the shown ones with no answer", () => {
  const fields = form.steps[0]!.fields;
  expect(unanswered(fields, {}).map((each) => each.id)).toEqual(["trade_type", "total", "evidence"]);
  expect(unanswered(fields, { trade_type: "one_time", total: " " }).map((each) => each.id)).toEqual([
    "supplied_on",
    "total",
    "evidence",
  ]);
});
