// Throwaway spike: one page, three ghost-text variants behind the links in the
// header. #univer, #univer-real, #prosemirror pick the variant; ?preset=skeleton
// starts with the skeleton accepted; ?long=N adds N filler paragraphs.

import { mountProseMirror } from "./pm-variant";
import { probe } from "./shared";
import { mountUniver } from "./univer-variant";

const variant = location.hash.slice(1) || "univer";
const params = new URLSearchParams(location.search);
const preset = params.get("preset") === "skeleton" ? "skeleton" : "empty";
const long = Number(params.get("long") ?? 0);
const host = document.getElementById("host")!;
const status = document.getElementById("status")!;

for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-variant]")) {
  if (link.dataset.variant === variant) link.setAttribute("aria-current", "page");
}
window.addEventListener("hashchange", () => location.reload());
probe.status = (text) => (status.textContent = text);

if (variant === "prosemirror") {
  host.classList.add("pm");
  mountProseMirror(host, preset, long);
} else {
  await mountUniver(host, variant === "univer-real" ? "real" : "render", preset, long);
}
