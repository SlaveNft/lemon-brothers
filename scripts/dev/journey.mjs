// A new visitor's whole path, driven in one clean headless Chrome profile against the running dev server
// (npm run dev) and the real bank on NEAR testnet:
//
//   landing page (and its slider) -> "My coins" -> get 1,000 $LEMON -> put 500 in the bank -> start the next
//   bank day -> take everything out
//
// After each click it waits for the page's own result line, saves a screenshot, and then checks the page against
// the network: the transaction behind the link must be executed with no failed receipt, and the balance on screen
// must equal `get_account` read over RPC. These are real testnet transactions from a throwaway guest account.
// Needs Google Chrome and Node 22+ (built-in WebSocket); no packages.
//
//   node scripts/dev/journey.mjs <outDir> [width] [height]
//
// Environment: BASE = page address (default http://127.0.0.1:5190/), LANG_UI = ru | en (default en), DPR = pixel
// ratio, GUEST = a stored guest account as JSON to continue with (skips the faucet), STEPS = how far to go:
// "look" (no transaction), "get", "deposit", "day", "run" (default).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [outDir, W = "1440", H = "900"] = process.argv.slice(2);
if (!outDir) { console.error("usage: node scripts/dev/journey.mjs <outDir> [width] [height]"); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE ?? "http://127.0.0.1:5190/", lang = process.env.LANG_UI ?? "en";
const upTo = ["look", "get", "deposit", "day", "run"].indexOf(process.env.STEPS ?? "run");
const CONTRACT = "lemonbank-587f5c93.testnet";
const RPCS = ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com", "https://near-testnet.drpc.org", "https://rpc.testnet.near.org"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the network, read independently of the page
async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (j.error) throw new Error(j.error?.cause?.name ?? j.error?.message ?? "rpc error");
      return j.result;
    } catch (e) { last = e; }
  }
  throw last;
}
async function view(method, args = {}) {
  const r = await rpc("query", { request_type: "call_function", finality: "optimistic", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
}
/** A transaction is good only if it executed and none of its receipts failed (a cross-contract failure hides there). */
async function checkTx(hash, signer) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await rpc("tx", { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" });
      const failed = (r.receipts_outcome ?? []).filter((o) => o.outcome?.status && "Failure" in o.outcome.status).length;
      const ok = r.status && "SuccessValue" in r.status && failed === 0;
      return { ok, finality: r.final_execution_status, failedReceipts: failed, method: r.transaction?.actions?.[0]?.FunctionCall?.method_name, receiver: r.transaction?.receiver_id };
    } catch (e) { await sleep(1500); if (i === 5) return { ok: false, error: String(e.message ?? e) }; }
  }
}

// ---------------------------------------------------------------- the browser
const port = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "journey-"))}`,
  `--window-size=${W},${H}`, "--hide-scrollbars", "--mute-audio", "--no-first-run", "about:blank",
], { stdio: "ignore" });
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(), pageErrors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 86 }); writeFileSync(join(outDir, name), Buffer.from(s.data, "base64")); };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: +(process.env.DPR ?? 1), mobile: +W < 600 });
if (process.env.GUEST) await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("chair.guest", ${JSON.stringify(process.env.GUEST)})` });

const report = { at: new Date().toISOString(), network: "NEAR testnet", contract: CONTRACT, viewport: `${W}x${H}`, lang, steps: [], pageErrors };
const fail = (why) => { report.failed = why; console.log("FAILED:", why); };
/** What the page shows about the visitor's coin right now. */
const seen = () => ev(`(() => {
  const w = document.querySelector("section.wallet"), n = (s) => s ? Number(s.textContent.replace(/[^0-9]/g, "")) : null;
  const bal = [...(w?.querySelectorAll(".w-bal > div b") ?? [])].map(n);
  const res = w?.querySelector(".w-result");
  return { step: w?.querySelector(".w-steps li.now b")?.textContent ?? null, wallet: bal[0] ?? null, deposit: bal[1] ?? null,
    account: w?.querySelector(".w-acct a")?.textContent ?? null, chip: document.querySelector(".wchip")?.textContent ?? null,
    net: document.querySelector(".net")?.textContent ?? null,
    result: res ? { ok: !res.classList.contains("bad"), text: res.querySelector("p")?.textContent ?? "", label: res.querySelector(".chip")?.textContent ?? "", tx: res.querySelector("a")?.href ?? null } : null,
    primary: w?.querySelector(".w-step button.primary")?.textContent ?? null, primaryDisabled: w?.querySelector(".w-step button.primary")?.disabled ?? null };
})()`);
/** Click a button inside "Your $LEMON" and wait for the page's own result line (or give up after `ms`). */
async function press(selector, ms = 90000) {
  const clicked = await ev(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b || b.disabled) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; })()`);
  if (!clicked) return false;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { await sleep(500); const s = await seen(); if (s.result) { await sleep(3200); return Date.now() - t0 - 3200; } } // + the page's second read
  return -1;
}
/** One step: press, screenshot, then hold the page against the network. */
async function step(name, file, selector, expectMethod) {
  const before = await seen();
  const took = await press(selector);
  if (took === false) { fail(`${name}: the button ${selector} is missing or disabled (primary: ${before.primary})`); return false; }
  await ev(`document.querySelector("section.wallet").scrollIntoView({ block: "start" }); window.scrollBy(0, -90)`);
  await sleep(300); await shot(file);
  const after = await seen();
  const entry = { name, screenshot: file, seconds: took < 0 ? null : Math.round(took / 100) / 10, pageSays: after.result, before: { wallet: before.wallet, deposit: before.deposit }, after: { wallet: after.wallet, deposit: after.deposit }, account: after.account, topBar: after.chip };
  report.steps.push(entry);
  if (!after.result) { fail(`${name}: no result line appeared`); return false; }
  if (!after.result.ok) { fail(`${name}: the page reports a failure: ${after.result.text}`); return false; }
  const hash = after.result.tx ? decodeURIComponent(after.result.tx.split("/txns/")[1] ?? "") : "";
  if (hash) {
    entry.tx = hash; entry.explorer = after.result.tx;
    entry.network = await checkTx(hash, after.account);
    if (!entry.network.ok) { fail(`${name}: the network does not confirm ${hash}`); return false; }
    if (entry.network.method !== expectMethod || entry.network.receiver !== CONTRACT) { fail(`${name}: the linked transaction is ${entry.network.method} on ${entry.network.receiver}, expected ${expectMethod} on ${CONTRACT}`); return false; }
  } else entry.note = "no transaction link (shared guest account whose handout was already claimed)";
  const chain = await view("get_account", { account_id: after.account });
  entry.chainAccount = { wallet: Number(chain?.wallet ?? 0), deposit: Number(chain?.deposit_value ?? 0) };
  if (entry.chainAccount.wallet !== after.wallet || entry.chainAccount.deposit !== after.deposit) { fail(`${name}: the page shows ${after.wallet}/${after.deposit}, the network says ${entry.chainAccount.wallet}/${entry.chainAccount.deposit}`); return false; }
  console.log(`ok  ${name}: ${entry.seconds}s  wallet ${before.wallet ?? "-"} -> ${after.wallet}  deposit ${before.deposit ?? "-"} -> ${after.deposit}  ${hash}`);
  return true;
}

try {
  await send("Page.navigate", { url: `${BASE}?lang=${lang}` });
  await sleep(6000);
  await shot("1-first-screen.jpg");
  const first = await seen();
  report.firstScreen = { headline: await ev(`document.querySelector(".first h1")?.textContent`), network: first.net,
    screens: await ev(`[...document.querySelectorAll(".topbar .tab .wide")].map((x) => x.textContent)`),
    pageHeightInScreens: await ev(`Math.round((document.documentElement.scrollHeight / innerHeight) * 10) / 10`) };
  console.log("first screen:", JSON.stringify(report.firstScreen));
  // the slider on the first screen: 45 of the 60 run, and the picture shows a closed bank with 15 left in it
  await ev(`(() => { const i = document.getElementById("try-n"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "45"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(1800);
  await shot("2-slider-panic.jpg");
  report.slider = await ev(`({ closed: !!document.querySelector(".first-pic .t-stamp.closed"), leftInBank: document.querySelectorAll(".first-pic .seat").length - [...document.querySelectorAll(".first-pic .seat")].filter((g) => g.style.opacity === "0").length, story: document.querySelector(".try-story")?.textContent })`);
  if (!report.slider.closed || report.slider.leftInBank !== 15) fail(`the slider at 45 should show a closed bank with 15 left, got ${JSON.stringify(report.slider)}`);
  // the page's own card leads to the coin
  await ev(`document.querySelector('.next-card[href="#coins"]').click()`);
  await sleep(2500);
  await shot("2b-my-coins.jpg");
  report.afterCoinCard = { walletInView: await ev(`(() => { const w = document.querySelector("section.wallet"); if (!w) return false; const r = w.getBoundingClientRect(); return r.top < innerHeight * 0.5 && r.bottom > 0; })()`), ...(await seen()) };
  if (!report.afterCoinCard.walletInView) fail("the card \"Get the coin\" did not open \"Your $LEMON\"");

  const go = async () => {
    if (upTo < 1) return;
    if (!process.env.GUEST && !(await step("get the coin", "3-coin-received.jpg", "section.wallet .w-step button.primary", "airdrop"))) return;
    if (upTo < 2) return;
    if (!(await step("put 500 in the bank", "4-deposited.jpg", "section.wallet .w-step button.primary", "deposit"))) return;
    if (upTo < 3) return;
    // a bank day is 55 minutes on testnet: start the next one only if it is due, otherwise check that the page says
    // when it will be, and go on to the withdrawal
    const due = await seen();
    if (due.primaryDisabled) {
      const label = await ev(`document.querySelector("section.wallet .w-choice button.primary")?.textContent ?? ""`);
      report.nextBankDay = label;
      console.log(`the bank day is still running; the page says: "${label}"`);
      if (!/\d/.test(label)) fail(`the page does not say when the next bank day starts: "${label}"`);
    } else if (!(await step("start the next bank day", "5-next-bank-day.jpg", "section.wallet .w-choice button.primary", "advance_epoch"))) return;
    if (upTo < 4) return;
    await step("take everything out", "6-ran.jpg", "section.wallet .w-choice button.run", "withdraw_all");
  };
  await go();
  report.guest = await ev(`localStorage.getItem("chair.guest") ? JSON.parse(localStorage.getItem("chair.guest")).accountId : null`);
  if (process.env.KEEP_GUEST) writeFileSync(process.env.KEEP_GUEST, await ev(`localStorage.getItem("chair.guest") ?? ""`));
} catch (e) { fail(String(e.message ?? e)); }
report.ok = !report.failed && pageErrors.length === 0;
writeFileSync(join(outDir, "journey.json"), JSON.stringify(report, null, 2));
console.log(report.ok ? "JOURNEY OK" : "JOURNEY FAILED", "->", join(outDir, "journey.json"));
ws.close(); chrome.kill();
process.exit(report.ok ? 0 : 1);
