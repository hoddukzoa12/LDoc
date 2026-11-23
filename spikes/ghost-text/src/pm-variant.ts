// Throwaway spike code. The same ghost text on plain ProseMirror: the ghost is a
// widget decoration at the caret, so it is never in the document, and the
// browser lays it out inline, pushing the following paragraphs down.

import { baseKeymap } from "prosemirror-commands";
import { closeHistory, history, isHistoryTransaction, redo, undo, undoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Fragment, Schema, Slice } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import { SKELETONS } from "./fixture";
import { type CaretContext, filler, type GhostKind, probe, suggest } from "./shared";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0], parseDOM: [{ tag: "p" }] },
    text: {},
  },
});

type Ghost = { kind: GhostKind; text: string; pos: number; keyAt: number; firedAt: number; version: number };

const ghostKey = new PluginKey<Ghost | null>("ghost");

function caretContext(state: EditorState): CaretContext | null {
  const { $head, empty } = state.selection;
  if (!empty) return null;
  const index = $head.index(0);
  const paragraph = $head.parent;
  return {
    before: paragraph.textBetween(0, $head.parentOffset),
    after: paragraph.textBetween($head.parentOffset, paragraph.content.size),
    previous: index > 0 ? state.doc.child(index - 1).textContent : null,
    isLast: index === state.doc.childCount - 1,
  };
}

function ghostElement(ghost: Ghost) {
  const span = document.createElement("span");
  span.className = "ghost";
  span.textContent = ghost.text;
  span.contentEditable = "false";
  span.setAttribute("aria-hidden", "true");
  return span;
}

export function mountProseMirror(host: HTMLElement, preset: "empty" | "skeleton", long: number) {
  let timer = 0;
  let version = 0;
  let skipEvaluate = false;
  let lastWasHistory = false;

  const ghostOf = (state: EditorState) => ghostKey.getState(state) ?? null;

  function accept(view: EditorView, ghost: Ghost) {
    const parts = ghost.text.split("\n");
    const tr = closeHistory(view.state.tr);
    if (parts.length === 1) tr.insertText(parts[0], ghost.pos);
    else {
      const nodes = parts.map((part) => schema.node("paragraph", null, part ? [schema.text(part)] : []));
      tr.replace(ghost.pos, ghost.pos, new Slice(Fragment.from(nodes), 1, 1));
    }
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(ghost.pos, 1)));
    tr.setMeta(ghostKey, null).scrollIntoView();
    skipEvaluate = true;
    view.dispatch(tr);
  }

  function evaluate(view: EditorView) {
    window.clearTimeout(timer);
    if (view.composing || ghostOf(view.state)) return;
    const context = caretContext(view.state);
    const suggestion = context && suggest(context);
    if (!suggestion) return;
    const { doc } = view.state;
    const pos = view.state.selection.head;
    const keyAt = probe.lastKeyAt;
    const fire = () => {
      if (view.state.doc !== doc || view.state.selection.head !== pos || view.composing) return;
      const ghost: Ghost = { kind: suggestion.kind, text: suggestion.text, pos, keyAt, firedAt: performance.now(), version: ++version };
      const started = performance.now();
      view.dispatch(view.state.tr.setMeta(ghostKey, ghost));
      const drawnAt = performance.now();
      requestAnimationFrame(() => {
        probe.timings.push({ variant: "prosemirror", kind: ghost.kind, paragraphs: view.state.doc.childCount, keyAt, firedAt: ghost.firedAt, showMs: drawnAt - started, drawnAt, frameAt: performance.now() });
      });
    };
    if (suggestion.delay === 0) queueMicrotask(fire);
    else timer = window.setTimeout(fire, suggestion.delay);
  }

  const ghostPlugin = new Plugin<Ghost | null>({
    key: ghostKey,
    state: {
      init: () => null,
      apply(tr, ghost) {
        if (tr.docChanged) lastWasHistory = isHistoryTransaction(tr);
        const meta = tr.getMeta(ghostKey);
        if (meta !== undefined) return meta;
        if (!ghost) return null;
        if (tr.docChanged || !tr.selection.empty || tr.selection.head !== ghost.pos) return null;
        return ghost;
      },
    },
    props: {
      decorations(state) {
        const ghost = ghostOf(state);
        if (!ghost) return null;
        return DecorationSet.create(state.doc, [
          Decoration.widget(ghost.pos, () => ghostElement(ghost), { side: 1, key: `ghost-${ghost.version}`, ignoreSelection: true }),
        ]);
      },
      handleKeyDown(view, event) {
        const ghost = ghostOf(view.state);
        if (!ghost || view.composing || event.isComposing) return false;
        if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          accept(view, ghost);
          return true;
        }
        if (event.key === "Escape") {
          view.dispatch(view.state.tr.setMeta(ghostKey, null));
          return true;
        }
        return false;
      },
      handleTextInput(view, from, to, text) {
        const ghost = ghostOf(view.state);
        if (!ghost || from !== ghost.pos || to !== from || text.length >= ghost.text.length || !ghost.text.startsWith(text)) return false;
        const tr = view.state.tr.insertText(text, from);
        tr.setMeta(ghostKey, { ...ghost, text: ghost.text.slice(text.length), pos: from + text.length, version: ++version });
        skipEvaluate = true;
        view.dispatch(tr);
        return true;
      },
      handleDOMEvents: {
        compositionstart(view) {
          window.clearTimeout(timer);
          if (ghostOf(view.state)) view.dispatch(view.state.tr.setMeta(ghostKey, null));
          return false;
        },
      },
    },
    view: () => ({
      update(view, previous) {
        if (previous.doc.eq(view.state.doc)) {
          if (!previous.selection.eq(view.state.selection)) window.clearTimeout(timer);
          return;
        }
        if (skipEvaluate || lastWasHistory) {
          skipEvaluate = false;
          return;
        }
        evaluate(view);
      },
    }),
  });

  const initial = preset === "skeleton" ? ["근로계약서", ...SKELETONS["근로계약서"].split("\n"), ...filler(long), ""] : [""];
  const doc = schema.node(
    "doc",
    null,
    initial.map((text) => schema.node("paragraph", null, text ? [schema.text(text)] : [])),
  );
  const view = new EditorView(host, {
    state: EditorState.create({
      doc,
      plugins: [ghostPlugin, history(), keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }), keymap(baseKeymap)],
    }),
  });

  function setCaret(pos: number) {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    view.focus();
  }

  window.spike = {
    variant: "prosemirror",
    ready: true,
    ghost: () => {
      const ghost = ghostOf(view.state);
      return ghost ? { kind: ghost.kind, text: ghost.text } : null;
    },
    text: () => {
      const lines: string[] = [];
      view.state.doc.forEach((node) => lines.push(node.textContent));
      return lines.join("\n");
    },
    data: () => JSON.stringify(view.state.doc.toJSON()),
    exported: () => window.spike.text(),
    focus: () => setCaret(1),
    caretToEndOfParagraph: (index) => {
      let pos = 0;
      for (let i = 0; i < index; i++) pos += view.state.doc.child(i).nodeSize;
      setCaret(pos + 1 + view.state.doc.child(index).content.size);
    },
    scrollBy: (dy) => host.scrollBy(0, dy),
    composing: () => view.composing,
    inputElement: () => view.dom,
    undoDepth: () => undoDepth(view.state),
    timings: probe.timings,
    log: probe.log,
  };
  (window as any).ghostGeometry = () => {
    const span = view.dom.querySelector(".ghost");
    if (!span) return null;
    const rect = span.getBoundingClientRect();
    const next = span.closest("p")?.nextElementSibling?.getBoundingClientRect();
    return { ghostTop: rect.top, ghostBottom: rect.bottom, nextTop: next?.top ?? null };
  };
}
