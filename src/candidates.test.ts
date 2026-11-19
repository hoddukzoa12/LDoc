import { expect, test } from "vitest";
import type { Readable } from "./AssistPanel";
import type { Field } from "./bindings/Field";
import type { Form } from "./bindings/Form";
import { accept, waiting } from "./candidates";

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

const candidate = (field: string, value: Readable["value"]): Readable => ({
  status: "readable",
  field,
  value,
  quoted: null,
});

test("a candidate behind a choice waits until the choice is made, and goes when the choice hides its field", () => {
  const supplied = candidate("supplied_on", "2026-03-02");
  expect(waiting(form, {}, [supplied])).toEqual([supplied]);
  expect(waiting(form, { trade_type: "one_time" }, [supplied])).toEqual([supplied]);
  expect(waiting(form, { trade_type: "continuous" }, [supplied])).toEqual([]);
});

test("accepting a choice drops the candidates of the fields it hides", () => {
  const continuous = candidate("trade_type", "continuous");
  const supplied = candidate("supplied_on", "2026-03-02");
  const after = accept(form, {}, [continuous, supplied], continuous);
  expect(after.answers).toEqual({ trade_type: "continuous" });
  expect(after.candidates).toEqual([]);
});

test("two candidates for a multi-choice field both wait and each adds its choice", () => {
  const statement = candidate("evidence", ["statement"]);
  const contract = candidate("evidence", ["contract"]);
  const first = accept(form, {}, [statement, contract], statement);
  expect(first.candidates).toEqual([contract]);
  const second = accept(form, first.answers, first.candidates, contract);
  expect(second.answers).toEqual({ evidence: ["contract", "statement"] });
  expect(second.candidates).toEqual([]);
});

test("accepting one of two candidates for a single-answer field decides it", () => {
  const ten = candidate("total", "10,000,000");
  const three = candidate("total", "3,000,000");
  const after = accept(form, {}, [ten, three], three);
  expect(after.answers).toEqual({ total: "3,000,000" });
  expect(after.candidates).toEqual([]);
});
