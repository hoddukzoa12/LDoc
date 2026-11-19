// The four shell commands, typed with the bindings ts-rs generates from the core.

import { invoke } from "@tauri-apps/api/core";
import type { Answer } from "./bindings/Answer";
import type { DocSummary } from "./bindings/DocSummary";
import type { Document } from "./bindings/Document";
import type { Draft } from "./bindings/Draft";
import type { DraftError } from "./bindings/DraftError";
import type { Form } from "./bindings/Form";

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
