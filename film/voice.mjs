// Fit the film to the narration.
//
//   npm run voice [-- --tempo 1.1] [-- --cuts 5.1,10.3,...]
//
// Input:  voiceover.mp3            one take of the script in VOICEOVER.md, a clear pause between the eleven lines
// Output: public/voiceover.mp3     the narration (tempo raised without changing the pitch, if asked)
//         src/voiceTiming.ts       how long each scene lasts, so the picture follows the voice
//
// The ten longest pauses of the take are taken as the breaks between the eleven lines; the script prints every
// line's length next to its share of the words, and warns when the two disagree (then pass the breaks with --cuts,
// in seconds of the raw take). Render afterwards with `npm run render`.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : null; };
const TEMPO = Number(arg("tempo") ?? 1), SRC = "voiceover.mp3", LINES_N = 11, END_CARD = 2.6, LEAD = 0.25;
if (!existsSync(SRC)) { console.error("voice: film/voiceover.mp3 not found"); process.exit(1); }
const script = readFileSync("VOICEOVER.md", "utf8").split("```text")[1].split("```")[0].split("\n").map((l) => l.trim()).filter(Boolean);
if (script.length !== LINES_N) { console.error(`voice: VOICEOVER.md has ${script.length} lines, the film has ${LINES_N} scenes`); process.exit(1); }

const probe = spawnSync("ffmpeg", ["-hide_banner", "-i", SRC, "-af", "silencedetect=noise=-34dB:d=0.22", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const total = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", SRC], { encoding: "utf8" }));
const starts = [...probe.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1])), ends = [...probe.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
const pauses = starts.map((a, i) => ({ a, b: ends[i] ?? total })).filter((p) => p.a > 0.2 && p.b < total - 0.2);
const first = starts[0] !== undefined && starts[0] < 0.2 ? ends[0] : 0;                       // where the first word begins
const last = starts.length && (ends[starts.length - 1] === undefined || ends[starts.length - 1] > total - 0.2) ? starts[starts.length - 1] : total; // where the last word ends
let cuts;
if (arg("cuts")) cuts = arg("cuts").split(",").map(Number);
else {
  if (pauses.length < LINES_N - 1) { console.error(`voice: found ${pauses.length} pauses, need at least ${LINES_N - 1}; record with clearer pauses or pass --cuts`); process.exit(1); }
  cuts = [...pauses].sort((x, y) => (y.b - y.a) - (x.b - x.a)).slice(0, LINES_N - 1).map((p) => (p.a + p.b) / 2).sort((x, y) => x - y);
}
if (cuts.length !== LINES_N - 1) { console.error(`voice: need ${LINES_N - 1} breaks, got ${cuts.length}`); process.exit(1); }
const edges = [Math.max(0, first - LEAD), ...cuts, last];
const raw = edges.slice(1).map((e, i) => e - edges[i]);
const words = script.map((l) => l.split(/\s+/).length), allWords = words.reduce((a, b) => a + b, 0), spoken = raw.reduce((a, b) => a + b, 0);
let odd = 0;
raw.forEach((d, i) => { const want = (words[i] / allWords) * spoken, off = Math.abs(d - want) / want; if (off > 0.4) odd++;
  console.log(`${String(i + 1).padStart(2)}  ${d.toFixed(2)}s  (by its words: ${want.toFixed(2)}s)${off > 0.4 ? "  <-- check this break" : ""}  ${script[i].slice(0, 60)}`); });
if (odd) console.log(`voice: ${odd} line(s) do not match their length: listen, and pass the breaks with --cuts if the pauses were misread`);

mkdirSync("public", { recursive: true });
const from = edges[0], to = Math.min(total, last + 0.35);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", SRC, "-af", `atrim=${from.toFixed(3)}:${to.toFixed(3)},asetpts=PTS-STARTPTS${TEMPO !== 1 ? `,atempo=${TEMPO}` : ""},afade=t=out:st=${((to - from) / TEMPO - 0.15).toFixed(3)}:d=0.15,loudnorm=I=-16:TP=-1.5:LRA=11`, "-ar", "44100", "-b:a", "192k", "public/voiceover.mp3"]);
const secs = raw.map((d) => d / TEMPO); secs[secs.length - 1] += END_CARD;
writeFileSync("src/voiceTiming.ts", `// Written by \`npm run voice\` from film/voiceover.mp3 (${total.toFixed(1)} s, tempo ${TEMPO}): each scene lasts as long as its line.
export const HAS_VOICE = true;
export const SCENE_SECONDS = [${secs.map((x) => x.toFixed(2)).join(", ")}];
`);
console.log(`voice: ${secs.reduce((a, b) => a + b, 0).toFixed(1)} s of film; public/voiceover.mp3 and src/voiceTiming.ts written`);
