// App entry. ?today=YYYY-MM-DD pins "today" for a stable recording.

import { DOC037 } from "./doc037";
import { mountEditor } from "./editor";
import { systemToday, toYMD } from "./logic";

const pinned = new URLSearchParams(location.search).get("today");
const today = (pinned && toYMD(pinned)) || systemToday();
document.getElementById("today")!.textContent = `오늘 ${today.y}-${String(today.m).padStart(2, "0")}-${String(today.d).padStart(2, "0")}${pinned ? " (고정)" : ""}`;

const api = mountEditor(document.getElementById("host")!, document.getElementById("open")!, DOC037, today);
const banner = document.getElementById("banner")!;

Object.assign(window, {
  spike: {
    ...api,
    ready: true,
    banner(text: string, tone: "ok" | "bad" | "" = "") {
      banner.textContent = text;
      banner.className = tone;
      banner.hidden = !text;
    },
    scrollToKey(key: string, block: ScrollLogicalPosition = "center") {
      document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block });
    },
    scrollToText(text: string, block: ScrollLogicalPosition = "center") {
      const line = [...document.querySelectorAll("#host p")].find((p) => p.textContent?.includes(text));
      line?.scrollIntoView({ block });
      return !!line;
    },
    scrollBy: (dy: number) => document.getElementById("host")!.scrollBy(0, dy),
    composing: () => api.view.composing,
    inputElement: () => api.view.dom,
  },
});
