// The shell commands, typed with the bindings ts-rs generates from the core and the shell.

import { invoke } from "@tauri-apps/api/core";
import type { Answer } from "./bindings/Answer";
import type { AssistError } from "./bindings/AssistError";
import type { AssistRun } from "./bindings/AssistRun";
import type { AssistStatus } from "./bindings/AssistStatus";
import type { DocSummary } from "./bindings/DocSummary";
import type { Document } from "./bindings/Document";
import type { Draft } from "./bindings/Draft";
import type { DraftError } from "./bindings/DraftError";
import type { Form } from "./bindings/Form";
import type { Masking } from "./bindings/Masking";
import type { MaskPreview } from "./bindings/MaskPreview";
import type { SentBody } from "./bindings/SentBody";
import type { TurnPlan } from "./bindings/TurnPlan";

/** The core's `Answers`: raw answers keyed by field id. */
export type Answers = Record<string, Answer>;

export type DraftResult = { ok: true; draft: Draft } | { ok: false; error: DraftError };

export const catalog = () => invoke<DocSummary[]>("catalog");

export const form = (id: string) => invoke<Form | null>("form", { id });

/** Resolves with the core's `DraftError` when it rejects the answers. Any other failure throws. */
export async function draft(id: string, answers: Answers): Promise<DraftResult> {
  try {
    return { ok: true, draft: await invoke<Draft>("draft", { id, answers }) };
  } catch (error) {
    if (typeof error === "object" && error !== null && "type" in error) {
      return { ok: false, error: error as DraftError };
    }
    throw error;
  }
}

export const exportDocx = (document: Document, path: string) =>
  invoke<null>("export_docx", { document, path });

export const assistStatus = () => invoke<AssistStatus>("assist_status");

/** How much of a pasted text the shell hides before it leaves. The setting lives in the shell, in memory. */
export const assistMasking = () => invoke<Masking>("assist_masking");

/** Changing the setting drops a preview awaiting approval. */
export const assistSetMasking = (masking: Masking) => invoke<null>("assist_set_masking", { masking });

/**
 * Masks the text as the shell's setting says and runs one fill turn on it, with no preview. Rejects with an
 * `AssistError`, `masking_mismatch` under "reviewed".
 */
export const assistSend = (text: string, doc: string, answers: Answers) =>
  invoke<AssistRun>("assist_send", { text, doc, answers });

/**
 * Masks the text in the core under "reviewed". Nothing leaves until the returned `text_id` is approved. Rejects with
 * an `AssistError`.
 */
export const assistPreview = (text: string, doc: string, answers: Answers, extraMasks: string[]) =>
  invoke<MaskPreview>("assist_preview", { text, doc, answers, extraMasks });

/** The shell's `AssistError` when an assist call rejected with one. */
export function asAssistError(error: unknown): AssistError | null {
  return typeof error === "object" && error !== null && "type" in error ? (error as AssistError) : null;
}

/** Approves the previewed text by its id and runs one turn on it. Rejects with an `AssistError`. */
export const assistRun = (plan: TurnPlan, approvedTextId: string) =>
  invoke<AssistRun>("assist_run", { plan, approvedTextId });

export const assistSent = (id: string) => invoke<SentBody[]>("assist_sent", { id });
