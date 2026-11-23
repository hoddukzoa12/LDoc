// Throwaway spike code. The suggestion rule and the timing probe both editors share.

import { SKELETONS, TRIGGERS } from "./fixture";

export const PAUSE_MS = 600;
export const GHOST_COLOR = "#9aa0a6";

export type GhostKind = "skeleton" | "clause";
export type Suggestion = { kind: GhostKind; text: string; delay: number };

/** What an editor knows around a collapsed caret, in plain text. Paragraphs in `text` are split by "\n". */
export type CaretContext = { before: string; after: string; previous: string | null; isLast: boolean };

export function suggest(context: CaretContext): Suggestion | null {
  if (context.after !== "") return null;
  if (context.before === "" && context.isLast && context.previous !== null) {
    const skeleton = SKELETONS[context.previous.trim()];
    if (skeleton) return { kind: "skeleton", text: skeleton, delay: 0 };
  }
  for (const trigger of TRIGGERS) {
    if (context.before.endsWith(trigger.phrase)) return { kind: "clause", text: trigger.text, delay: PAUSE_MS };
  }
  return null;
}

/** One ghost shown: when its last key went down, when the pause ended, when it reached a frame. */
export type Timing = {
  variant: string;
  kind: GhostKind;
  paragraphs: number;
  /** keydown of the last key before the ghost, performance.now() clock */
  keyAt: number;
  /** the pause timer fired, or the rule matched for a ghost with no pause */
  firedAt: number;
  /** synchronous work to put the ghost on screen (relayout for Univer, dispatch for ProseMirror) */
  showMs: number;
  /** Univer: the page draw that painted the ghost. ProseMirror: the DOM holds the widget. */
  drawnAt: number;
  /** the next animation frame after drawnAt */
  frameAt: number;
};

export const probe = {
  lastKeyAt: 0,
  timings: [] as Timing[],
  log: [] as string[],
  status: (_text: string) => {},
  note(line: string) {
    probe.log.push(`${performance.now().toFixed(1)} ${line}`);
  },
};

window.addEventListener("keydown", () => (probe.lastKeyAt = performance.now()), true);

export type SpikeApi = {
  variant: string;
  ready: boolean;
  ghost(): { kind: GhostKind; text: string } | null;
  /** The document's paragraphs, joined by "\n". */
  text(): string;
  /** The document data the app would save, serialized. */
  data(): string;
  /** What the app's DOCX export would receive, one block per line. */
  exported(): string;
  focus(): void;
  caretToEndOfParagraph(index: number): void;
  scrollBy(dy: number): void;
  zoom?(ratio: number): void;
  composing(): boolean;
  inputElement(): HTMLElement;
  undoDepth(): number | null;
  timings: Timing[];
  log: string[];
};

declare global {
  interface Window {
    spike: SpikeApi;
  }
}

/** A long document for the layout-cost check: the skeleton plus `count` filler paragraphs. */
export function filler(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `제${index + 11}조 (채움 ${index + 1}) 긴 문서에서 레이아웃 비용을 재려고 넣은 문단입니다. 내용은 의미가 없습니다.`);
}
