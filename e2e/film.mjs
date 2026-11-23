// Films a run of e2e/run.mjs when LDOC_FILM=1. It records the X display and
// burns the scene names into the strip the app window leaves free at the
// bottom of the screen. Without LDOC_FILM every function here does nothing,
// so the test runs at full speed.

import { execFileSync, spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILMED = process.env.LDOC_FILM === "1";
const FRAMES_PER_SECOND = "15";
/** libass sizes are relative to a 288-line screen, so this is about 31 px on a 1000-line one. */
const CAPTION_STYLE = "FontName=Noto Sans CJK KR,FontSize=9,MarginV=10";

/** @type {{ at: number, text: string }[]} */
const scenes = [];
let recorder = null;
let startedAt = 0;

/** Starts recording the display into `out`. */
export async function startFilm(out) {
  if (!FILMED) return;
  const size = execFileSync("xdotool", ["getdisplaygeometry"], { encoding: "utf8" }).trim().replace(" ", "x");
  recorder = spawn(
    "ffmpeg",
    [
      ...["-loglevel", "error", "-y"],
      ...["-f", "x11grab", "-draw_mouse", "0", "-framerate", FRAMES_PER_SECOND, "-video_size", size],
      ...["-i", process.env.DISPLAY],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-crf", "18"],
      join(out, "raw.mkv"),
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  // The grab starts a moment after the process does.
  await new Promise((done) => setTimeout(done, 500));
  startedAt = Date.now();
}

/** Names what the viewer sees from now until the next scene. */
export function scene(text) {
  if (FILMED) scenes.push({ at: Date.now() - startedAt, text });
}

/** Leaves the screen as it is long enough to be read. */
export async function hold(ms) {
  if (FILMED) await new Promise((done) => setTimeout(done, ms));
}

/** Stops the recording and writes `demo.mp4` with the scene names burned in. */
export async function finishFilm(out) {
  if (!recorder) return;
  const length = Date.now() - startedAt;
  recorder.stdin.end("q");
  await new Promise((done) => recorder.on("exit", done));
  const captions = scenes.map((scene, index) => {
    const until = scenes[index + 1]?.at ?? length;
    return `${index + 1}\n${stamp(scene.at)} --> ${stamp(until)}\n${scene.text}\n`;
  });
  writeFileSync(join(out, "demo.srt"), captions.join("\n"));
  execFileSync(
    "ffmpeg",
    [
      ...["-loglevel", "error", "-y", "-i", "raw.mkv"],
      ...["-vf", `subtitles=demo.srt:force_style='${CAPTION_STYLE}'`],
      ...["-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
      "demo.mp4",
    ],
    { cwd: out, stdio: "inherit" },
  );
  rmSync(join(out, "raw.mkv"));
}

/** Milliseconds as an SRT time, 00:01:02,345. */
function stamp(ms) {
  const part = (value, width = 2) => String(Math.floor(value)).padStart(width, "0");
  return `${part(ms / 3_600_000)}:${part((ms / 60_000) % 60)}:${part((ms / 1000) % 60)},${part(ms % 1000, 3)}`;
}
