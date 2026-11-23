import { expect, test } from "vitest";
import type { Document } from "./bindings/Document";
import sample from "./fixtures/payment-order-goods.document.json";
import { fromUniver, toUniver } from "./univer-document";

// Written by the core's `writes_the_sample_document` test from the example answers.
const draft = sample as Document;

test("the sample draft survives a round trip through a Univer snapshot", () => {
  expect(fromUniver(toUniver(draft))).toEqual(draft);
});
