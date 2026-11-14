// Drive headless Chrome over the DevTools protocol: load a page of the running dev server (npm run dev), run a
// script in it, report page errors and the frame rate, and save a screenshot.
// Needs Google Chrome and Node 22+ (built-in WebSocket); no packages.
//
//   node scripts/dev/capture.mjs <url> <width> <height> <out.png|out.jpg> [waitMs] [jsBeforeShot]
//
// Environment: DPR = device pixel ratio (default 1), PRE = script run before the page's own (e.g. set localStorage), NOFPS=1 = skip the 2 s frame count.
// Example: PRE="localStorage.setItem('chair.lang','ru')" node scripts/dev/capture.mjs http://localhost:5190/ 1440 900 /tmp/a.jpg
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [url, W, H, out, waitMs = "6000", js = ""] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`,
  `--window-size=${W},${H}`, "--hide-scrollbars", "--mute-audio", "--no-first-run", "--enable-gpu", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") console.log("PAGE ERROR:", m.params.exceptionDetails.exception?.description?.slice(0, 600)); if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) console.log("CONSOLE:", m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 500)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: +(process.env.DPR ?? 1), mobile: +W < 600 });
if (process.env.PRE) await send("Page.addScriptToEvaluateOnNewDocument", { source: process.env.PRE });
await send("Page.navigate", { url });
await sleep(+waitMs);
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) console.log("EXC:", r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
if (js) console.log("js:", JSON.stringify(await ev(js)));
const fps = process.env.NOFPS ? "skipped" : await ev(`new Promise(res=>{let n=0;const t0=performance.now();const f=()=>{n++;performance.now()-t0>2000?res(Math.round(n/2)):requestAnimationFrame(f)};requestAnimationFrame(f)})`);
console.log("fps:", fps);
const shot = await send("Page.captureScreenshot", out.endsWith(".jpg") ? { format: "jpeg", quality: 88 } : { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
ws.close(); chrome.kill();
