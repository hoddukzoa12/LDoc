// Throwaway spike code. A stand-in for a model: one canned reading of one
// free-text answer, so the film can show where a model would come in. Everything
// else in the spike works without it.

import type { Value } from "./render";

export type IntentReading = { text: string; picks: Record<string, string>; values: Record<string, Value> };

const CANNED: { template: string; choice: string; phrase: string; reading: IntentReading }[] = [
  {
    template: "doc-037",
    choice: "employment",
    phrase: "6개월만써보고결정",
    reading: { text: "기간제로 하고, 계약기간은 6개월", picks: { employment: "fixed" }, values: { end_date: { raw: "6개월", origin: "intent", months: 6 } } },
  },
];

export function cannedReading(template: string, choice: string, typed: string): IntentReading | null {
  const phrase = typed.replace(/\s/g, "");
  return CANNED.find((entry) => entry.template === template && entry.choice === choice && entry.phrase === phrase)?.reading ?? null;
}
