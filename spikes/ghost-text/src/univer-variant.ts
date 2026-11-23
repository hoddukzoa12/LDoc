// Throwaway spike code. Ghost text on Univer Docs 1.5.2, two ways.
//
// "render": the ghost is never in the document. A layout presentation
// (registerDocumentLayoutPresentation) adds spaceBelow to the caret's paragraph
// so the following paragraphs move down, and a Documents.pageRender$ subscriber
// paints the ghost lines into that room on the page canvas. Tab and Esc are
// Univer shortcuts with a higher priority than the editor's own Tab.
//
// "real": the fallback. The ghost is real grey text, inserted and removed with
// untracked RichTextEditingMutations, so it is in the document while visible.

import {
  DocSelectionManagerService,
  DocSelectionRenderService,
  DocSkeletonManagerService,
  IRenderManagerService,
  IShortcutService,
  KeyCode,
  RichTextEditingMutation,
  registerDocumentLayoutPresentation,
  UniverDocsCorePreset,
} from "@univerjs/preset-docs-core";
import docsCoreKoKR from "@univerjs/preset-docs-core/locales/ko-KR";
import "@univerjs/preset-docs-core/lib/index.css";
import {
  BooleanNumber,
  CommandType,
  createUniver,
  DocumentFlavor,
  ICommandService,
  type IDocumentBody,
  type IDocumentData,
  IUniverInstanceService,
  JSONX,
  LocaleType,
  mergeLocales,
  TextX,
  TextXActionType,
  UniverInstanceType,
} from "@univerjs/presets";
import { fromUniver } from "../../../src/univer-document";
import { SKELETONS } from "./fixture";
import { type CaretContext, filler, GHOST_COLOR, type GhostKind, probe, suggest, type Timing } from "./shared";

type Mode = "render" | "real";

type Ghost = {
  kind: GhostKind;
  text: string;
  /** model offset of the caret the ghost follows */
  offset: number;
  /** startIndex of the caret paragraph's mark */
  paragraphEnd: number;
  keyAt: number;
  firedAt: number;
  version: number;
  /** render mode: wrapped lines, the first starts at the caret */
  lines: string[];
  pitch: number;
  font: string;
  room: number;
  /** real mode: length of the inserted ghost text */
  length: number;
  drawn: boolean;
  showMs: number;
};

/** Mirrors the app's toUniver document style: A4, 30 mm margins, 바탕 12 pt. */
function emptyDocument(paragraphs: string[]): IDocumentData {
  const dataStream = paragraphs.map((text) => `${text}\r`).join("");
  let at = -1;
  return {
    id: "spike",
    locale: LocaleType.KO_KR,
    documentStyle: {
      documentFlavor: DocumentFlavor.TRADITIONAL,
      pageSize: { width: 794, height: 1123 },
      marginTop: 113,
      marginBottom: 113,
      marginLeft: 113,
      marginRight: 113,
      textStyle: { ff: "바탕", fs: 12 },
    },
    body: {
      dataStream: `${dataStream}\n`,
      textRuns: [{ st: 0, ed: dataStream.length, ts: { fs: 12, bl: BooleanNumber.FALSE } }],
      paragraphs: paragraphs.map((text, index) => {
        at += text.length + 1;
        return { startIndex: at, paragraphId: `p${index}`, paragraphStyle: {} };
      }),
      sectionBreaks: [{ sectionId: "s0", startIndex: dataStream.length }],
    },
  };
}

function bodyOf(text: string, grey: boolean): IDocumentBody {
  const dataStream = text.replaceAll("\n", "\r");
  const paragraphs = [...dataStream].flatMap((char, index) => (char === "\r" ? [{ startIndex: index, paragraphStyle: {} }] : []));
  const textRuns = grey ? [{ st: 0, ed: dataStream.length, ts: { cl: { rgb: GHOST_COLOR } } }] : undefined;
  return { dataStream, paragraphs, ...(textRuns ? { textRuns } : {}) };
}

function editActions(offset: number, op: { insert: IDocumentBody } | { remove: number }) {
  const textX = new TextX();
  if (offset > 0) textX.push({ t: TextXActionType.RETAIN, len: offset });
  if ("insert" in op) textX.push({ t: TextXActionType.INSERT, body: op.insert, len: op.insert.dataStream.length });
  else textX.push({ t: TextXActionType.DELETE, len: op.remove });
  return JSONX.getInstance().editOp(textX.serialize(), ["body"]);
}

/**
 * Word wrap at spaces, which is how Univer breaks Korean here; a word wider
 * than the line breaks per character. Univer's CJK-Latin spacing is not copied.
 */
function wrap(text: string, font: string, firstWidth: number, width: number): string[] {
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const lines: string[] = [];
  text.split("\n").forEach((paragraph) => {
    let line = "";
    let room = lines.length === 0 ? firstWidth : width;
    for (const word of paragraph.split(/(?<= )/)) {
      const fitsNowhere = line === "" && lines.length === 0 && room < width && measure.measureText(word.trimEnd()).width > room;
      if ((line !== "" || fitsNowhere) && measure.measureText(line + word.trimEnd()).width > room) {
        lines.push(line);
        line = "";
        room = width;
      }
      for (const char of word) {
        if (line !== "" && measure.measureText(line + char).width > room && char !== " ") {
          lines.push(line);
          line = "";
          room = width;
        }
        line += char;
      }
    }
    lines.push(line);
  });
  return lines;
}

type CaretBox = { x: number; lineLeft: number; lineRight: number; baseline: number; pitch: number; font: string };

/** Finds the caret's line in one skeleton page, in the page's own coordinates. */
function findCaret(page: any, offset: number): CaretBox | null {
  for (const section of page.sections ?? []) {
    for (const column of section.columns ?? []) {
      for (const line of column.lines ?? []) {
        let index = line.st;
        for (const divide of line.divides ?? []) {
          const base = (divide.left ?? 0) + (divide.paddingLeft ?? 0);
          for (const glyph of divide.glyphGroup ?? []) {
            if (index === offset) {
              const left = page.marginLeft + (column.left ?? 0);
              const top = page.marginTop + (section.top ?? 0) + line.top;
              const fontSize = glyph.fontStyle?.fontSize ?? 16;
              return {
                x: left + base + glyph.left,
                lineLeft: left,
                lineRight: left + column.width,
                baseline: top + (line.marginTop ?? 0) + (line.paddingTop ?? 0) + line.asc,
                pitch: line.lineHeight,
                font: glyph.fontStyle?.fontString ?? `${fontSize}px serif`,
              };
            }
            index += glyph.count ?? 1;
          }
        }
      }
    }
  }
  return null;
}

/** Top of the line that starts at `offset`, for checking that the room moved the next paragraph. */
function lineTop(pages: any[], offset: number): number | null {
  let pageTop = 0;
  for (const page of pages) {
    for (const section of page.sections ?? []) {
      for (const column of section.columns ?? []) {
        for (const line of column.lines ?? []) {
          if (line.st === offset) return pageTop + page.marginTop + (section.top ?? 0) + line.top;
        }
      }
    }
    pageTop += page.pageHeight;
  }
  return null;
}

async function until<T>(read: () => T | null | undefined): Promise<T> {
  for (;;) {
    const value = read();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 20));
  }
}

export async function mountUniver(host: HTMLElement, mode: Mode, preset: "empty" | "skeleton", long: number) {
  const variant = mode === "render" ? "univer" : "univer-real";
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.KO_KR,
    locales: { [LocaleType.KO_KR]: mergeLocales(docsCoreKoKR) },
    presets: [UniverDocsCorePreset({ container: host, footer: false })],
  });
  const initial =
    preset === "skeleton" ? ["근로계약서", ...SKELETONS["근로계약서"].split("\n"), ...filler(long), ""] : [""];
  const fdoc = univerAPI.createDocument(emptyDocument(initial));
  const unitId = fdoc.getId();
  const injector = (univer as any).__getInjector();
  const commands = injector.get(ICommandService);
  const shortcuts = injector.get(IShortcutService);
  const model = injector.get(IUniverInstanceService).getUnit(unitId, UniverInstanceType.UNIVER_DOC);
  const render = await until(() => injector.get(IRenderManagerService).getRenderUnitById(unitId));
  const documents = render.mainComponent as any;
  const skeletons = render.with(DocSkeletonManagerService);
  const selectionRender = render.with(DocSelectionRenderService);
  const selections = injector.get(DocSelectionManagerService);

  let ghost: Ghost | null = null;
  let version = 0;
  let timer = 0;
  let composing = false;
  let ownChange = false;
  let pendingEdit = false;
  let lastDismissed: Ghost | null = null;
  let registration: { dispose(): void } | null = null;

  // Layout calls getSnapshot for every getBody(), so the projection is built
  // once per ghost; the model does not change while a ghost is visible.
  let projected: { version: number; source: IDocumentData; snapshot: IDocumentData } | null = null;
  const presentation = {
    getSnapshot(document: IDocumentData) {
      if (!ghost || ghost.room === 0 || !document.body?.paragraphs) return document;
      if (projected?.version === ghost.version && projected.source === document) return projected.snapshot;
      const g = ghost;
      const paragraphs = document.body.paragraphs.map((paragraph) =>
        paragraph.startIndex === g.paragraphEnd
          ? { ...paragraph, paragraphStyle: { ...paragraph.paragraphStyle, spaceBelow: { v: (paragraph.paragraphStyle?.spaceBelow?.v ?? 0) + g.room } } }
          : paragraph,
      );
      projected = { version: g.version, source: document, snapshot: { ...document, body: { ...document.body, paragraphs } } };
      return projected.snapshot;
    },
    captureState: () => null,
    applyActions: () => {},
    restoreState: () => {},
  };

  function relayout() {
    const started = performance.now();
    skeletons.getViewModel().reset(model);
    const reset = performance.now();
    skeletons.recalculate();
    probe.note(`relayout: view model reset ${(reset - started).toFixed(1)} ms, layout ${(performance.now() - reset).toFixed(1)} ms`);
    documents.makeDirty(true);
  }

  function pages(): any[] {
    return skeletons.getSkeleton()?.getSkeletonData()?.pages ?? [];
  }

  function caretContext(): { context: CaretContext; offset: number; paragraphEnd: number } | null {
    const range = selections.getActiveTextRange();
    if (!range || range.startOffset !== range.endOffset || (range.segmentId ?? "") !== "") return null;
    const body = model.getBody();
    const paragraphs = body.paragraphs ?? [];
    const offset = range.startOffset;
    const index = paragraphs.findIndex((paragraph: any) => paragraph.startIndex >= offset);
    if (index < 0) return null;
    const startOf = (i: number) => (i === 0 ? 0 : paragraphs[i - 1].startIndex + 1);
    const stream: string = body.dataStream;
    return {
      offset,
      paragraphEnd: paragraphs[index].startIndex,
      context: {
        before: stream.slice(startOf(index), offset),
        after: stream.slice(offset, paragraphs[index].startIndex),
        previous: index > 0 ? stream.slice(startOf(index - 1), paragraphs[index - 1].startIndex) : null,
        isLast: index === paragraphs.length - 1,
      },
    };
  }

  function mutate(actions: unknown, caret: number) {
    ownChange = true;
    try {
      commands.syncExecuteCommand(RichTextEditingMutation.id, {
        unitId,
        segmentId: "",
        actions,
        textRanges: [{ startOffset: caret, endOffset: caret, collapsed: true }],
        noHistory: true,
        debounce: false,
        isEditing: true,
      });
    } finally {
      ownChange = false;
    }
  }

  function show(base: Pick<Ghost, "kind" | "text" | "offset" | "paragraphEnd" | "keyAt" | "firedAt">) {
    const started = performance.now();
    const g: Ghost = { ...base, version: ++version, lines: [], pitch: 0, font: "", room: 0, length: 0, drawn: false, showMs: 0 };
    if (mode === "render") {
      const caret = pages().map((page) => findCaret(page, g.offset)).find(Boolean);
      if (!caret) return probe.note("render: caret line not found");
      g.lines = wrap(g.text, caret.font, caret.lineRight - caret.x, caret.lineRight - caret.lineLeft);
      g.pitch = caret.pitch;
      g.font = caret.font;
      g.room = (g.lines.length - 1) * caret.pitch;
      const nextStart = g.paragraphEnd + 1;
      const before = lineTop(pages(), nextStart);
      ghost = g;
      registration ??= registerDocumentLayoutPresentation(model, presentation as any);
      relayout();
      const after = lineTop(pages(), nextStart);
      probe.note(`render: room ${g.room.toFixed(1)} px, next paragraph moved ${before === null || after === null ? "n/a" : (after - before).toFixed(1)} px, font ${g.font}`);
    } else {
      const body = bodyOf(g.text, true);
      g.length = body.dataStream.length;
      ghost = g;
      mutate(editActions(g.offset, { insert: body }), g.offset);
    }
    g.showMs = performance.now() - started;
    probe.status(`${g.kind === "skeleton" ? "문서 뼈대" : "조항"} 제안 표시 중. Tab 받기, Esc 닫기`);
  }

  function hide(reason: string) {
    if (!ghost) return;
    const g = ghost;
    ghost = null;
    if (mode === "render") {
      registration?.dispose();
      registration = null;
      relayout();
    } else mutate(editActions(g.offset, { remove: g.length }), g.offset);
    probe.note(`hide: ${reason}`);
    probe.status("");
    lastDismissed = reason === "edit" ? g : null;
  }

  function accept() {
    const g = ghost;
    if (!g) return;
    hide("accept");
    ownChange = true;
    try {
      commands.syncExecuteCommand("doc.command.insert-text", {
        unitId,
        segmentId: "",
        body: bodyOf(g.text, false),
        range: { startOffset: g.offset, endOffset: g.offset, collapsed: true },
        debounce: false,
      });
    } finally {
      ownChange = false;
    }
  }

  function afterEdit() {
    const now = caretContext();
    window.clearTimeout(timer);
    if (!now) return;
    const dismissed = lastDismissed;
    lastDismissed = null;
    if (dismissed && !composing) {
      const typed = now.offset - dismissed.offset;
      const stream: string = model.getBody().dataStream;
      if (typed > 0 && typed < dismissed.text.length && stream.slice(dismissed.offset, now.offset) === dismissed.text.slice(0, typed)) {
        show({ ...dismissed, text: dismissed.text.slice(typed), offset: now.offset, paragraphEnd: now.paragraphEnd });
        return;
      }
    }
    if (composing) return;
    const suggestion = suggest(now.context);
    if (!suggestion) return;
    const keyAt = probe.lastKeyAt;
    const fire = () => {
      const still = caretContext();
      if (!still || still.offset !== now.offset || composing || ghost) return;
      show({ kind: suggestion.kind, text: suggestion.text, offset: now.offset, paragraphEnd: now.paragraphEnd, keyAt, firedAt: performance.now() });
    };
    if (suggestion.delay === 0) fire();
    else timer = window.setTimeout(fire, suggestion.delay);
  }

  documents.pageRender$.subscribe(({ page, pageLeft, pageTop, ctx }: any) => {
    const g = ghost;
    if (!g) return;
    if (mode === "render") {
      const caret = findCaret(page, g.offset);
      if (!caret) return;
      ctx.save();
      ctx.fillStyle = GHOST_COLOR;
      ctx.font = g.font;
      ctx.textBaseline = "alphabetic";
      g.lines.forEach((line, index) => {
        const x = index === 0 ? caret.x : caret.lineLeft;
        ctx.fillText(line, pageLeft + x, pageTop + caret.baseline + index * g.pitch);
      });
      ctx.restore();
    }
    if (!g.drawn) {
      g.drawn = true;
      const drawnAt = performance.now();
      requestAnimationFrame(() => {
        const timing: Timing = { variant, kind: g.kind, paragraphs: model.getBody().paragraphs.length, keyAt: g.keyAt, firedAt: g.firedAt, showMs: g.showMs, drawnAt, frameAt: performance.now() };
        probe.timings.push(timing);
      });
    }
  });

  // Hide before any editing command computes its change, so no edit sees the ghost.
  commands.beforeCommandExecuted((info: any) => {
    if (ownChange || !ghost) return;
    if (info.id.startsWith("doc.command.") || info.id === "univer.command.undo" || info.id === "univer.command.redo" || info.id === RichTextEditingMutation.id) hide("edit");
  });
  commands.onCommandExecuted((info: any) => {
    if (ownChange || info.id !== RichTextEditingMutation.id || info.params?.unitId !== unitId) return;
    // Undo and redo restore text; they should not offer what was just undone.
    if (info.params?.trigger === "univer.command.undo" || info.params?.trigger === "univer.command.redo") return;
    pendingEdit = true;
    setTimeout(() => {
      if (!pendingEdit) return;
      pendingEdit = false;
      afterEdit();
    }, 0);
  });
  selections.textSelection$.subscribe(() => {
    if (ownChange) return;
    if (pendingEdit) {
      pendingEdit = false;
      afterEdit();
      return;
    }
    const range = selections.getActiveTextRange();
    if (ghost && (!range || range.startOffset !== ghost.offset || range.endOffset !== ghost.offset)) hide("caret moved");
    else if (!ghost) window.clearTimeout(timer);
  });
  selectionRender.onCompositionstart$.subscribe(() => {
    composing = true;
    window.clearTimeout(timer);
    hide("composition");
  });
  selectionRender.onCompositionend$.subscribe(() => {
    composing = false;
  });

  commands.registerCommand({ id: "spike.ghost.accept", type: CommandType.OPERATION, handler: () => (accept(), true) });
  commands.registerCommand({ id: "spike.ghost.dismiss", type: CommandType.OPERATION, handler: () => (hide("esc"), true) });
  shortcuts.registerShortcut({ id: "spike.ghost.accept", binding: KeyCode.TAB, priority: 1000, preconditions: () => ghost !== null && !composing });
  shortcuts.registerShortcut({ id: "spike.ghost.dismiss", binding: KeyCode.ESC, priority: 1000, preconditions: () => ghost !== null });

  function setCaret(offset: number) {
    selections.replaceDocRanges([{ startOffset: offset, endOffset: offset }], { unitId, subUnitId: unitId }, true);
    selectionRender.focus();
  }

  window.spike = {
    variant,
    ready: true,
    ghost: () => (ghost ? { kind: ghost.kind, text: ghost.text } : null),
    text: () =>
      (model.getBody().dataStream as string)
        .replace(/\r\n$/, "")
        .split("\r")
        .join("\n"),
    data: () => JSON.stringify(fdoc.save()),
    exported: () => fromUniver(fdoc.save()).blocks.map((block) => block.text).join("\n"),
    focus: () => setCaret(0),
    caretToEndOfParagraph: (index) => setCaret(model.getBody().paragraphs[index].startIndex),
    scrollBy: (dy) => {
      const viewport = render.scene.getViewports()[0];
      viewport.scrollByViewportDeltaVal({ viewportScrollX: 0, viewportScrollY: dy });
    },
    zoom: (ratio) => commands.executeCommand("doc.operation.set-zoom-ratio", { zoomRatio: ratio, unitId }),
    composing: () => composing,
    inputElement: () => selectionRender.inputElement,
    undoDepth: () => null,
    timings: probe.timings,
    log: probe.log,
  };
}
