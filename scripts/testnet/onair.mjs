// Keeps the chair's press conferences on a published schedule: at every slot of apps/web/src/chain/schedule.json
// (every `everyMinutes`, counted from midnight UTC) it runs the keeper for `bankDays` bank days, so the chair makes
// one signed statement per bank day and the page's "next press conference" is true.
//
//   node scripts/testnet/onair.mjs            print the next slots and exit: sends nothing (the default)
//   node scripts/testnet/onair.mjs --run      wait for each slot and run the keeper; stop with Ctrl+C
//   node scripts/testnet/onair.mjs --run --slots 8    stop after eight press conferences
//
// Run it only with the project owner's go-ahead: every bank day of a press conference is testnet transactions and,
// with NEAR_AI_API_KEY set, one paid NEAR AI completion (one per bank day). Set "active": true in
// schedule.json in the same change, so the page promises the times only while this is running.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const s = JSON.parse(readFileSync(path.join(ROOT, "apps/web/src/chain/schedule.json"), "utf8"));
if (!(Number.isInteger(s.everyMinutes) && s.everyMinutes >= 5 && 1440 % s.everyMinutes === 0 && Number.isInteger(s.bankDays) && s.bankDays >= 1)) {
  throw new Error("schedule.json: everyMinutes must be 5 or more and divide a day (1440), bankDays 1 or more");
}
const step = s.everyMinutes * 60_000;
/** The same rule as apps/web/src/chain/schedule.ts: the first slot that starts after `now`, counted from midnight UTC. */
const nextSlot = (now) => Math.floor(now / step) * step + step;
const args = process.argv.slice(2), run = args.includes("--run");
const maxSlots = args.includes("--slots") ? Number(args[args.indexOf("--slots") + 1]) : Infinity;
const iso = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

if (!run) {
  let t = nextSlot(Date.now());
  console.log(`schedule: every ${s.everyMinutes} minutes from 00:00 UTC, ${s.bankDays} bank days each; "active" in schedule.json is ${s.active}`);
  for (let i = 0; i < 4; i++, t += step) console.log(`  press conference ${i + 1}: ${iso(t)}`);
  console.log(`a day of this is ${1440 / s.everyMinutes} press conferences = ${(1440 / s.everyMinutes) * s.bankDays} chair statements (one NEAR AI completion each with a key)`);
  console.log("nothing was sent. To keep the schedule: node scripts/testnet/onair.mjs --run");
  process.exit(0);
}
if (!s.active) console.log('note: "active" is false in schedule.json, so the page does not announce these times');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let n = 0; n < maxSlots; n++) {
  const at = nextSlot(Date.now());
  console.log(`next press conference: ${iso(at)} (in ${Math.round((at - Date.now()) / 60_000)} min)`);
  await sleep(at - Date.now());
  console.log(`on air: ${iso(Date.now())}`);
  const code = await new Promise((done) => spawn("npm", ["run", "testnet:keeper"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, EPOCHS: String(s.bankDays) } }).on("exit", done));
  console.log(`off air: ${iso(Date.now())}, keeper exit code ${code}`);
}
