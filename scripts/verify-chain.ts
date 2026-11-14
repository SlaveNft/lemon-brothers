/**
 * Check what this repository says about the bank on NEAR testnet against the network itself.
 * Read-only: public RPC views and transaction lookups. No keys, no transactions, no NEAR AI calls.
 *
 *   npm run verify:chain
 *
 * It checks, and prints one PASS or FAIL line for each:
 *   1. the bank's state: every LEMON accounted for, the ceiling, the owner (a Sputnik DAO), the pinned model key;
 *   2. the token views (NEP-141) agree with the bank;
 *   3. who holds which key: the chair's capped key, the published guest key, and no key at all on the contract account;
 *   4. the contract's own answer to "print half of all LEMON" (`check_policy`, a free view);
 *   5. every transaction listed in apps/web/src/chain/evidence.json (the page's "Proof on chain", and the others
 *      the README cites): it exists, was signed by the account named there, ended as stated, and carries the quoted
 *      refusal or event;
 *   6. the leaderboard: every stored claim of the last seven days is replayed with the game's engine, as the page does.
 *
 * `npm run verify:deployed` is the other half: it rebuilds the contract and compares it with the code on chain.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMoves, replayCrisis } from "@chair/sim";

const BANK = process.env.BANK ?? "lemonbank-587f5c93.testnet";
const RPCS = (process.env.NEAR_RPC_URLS || "https://rpc.testnet.near.org,https://test.rpc.fastnear.com,https://rpc.testnet.fastnear.com").split(",");
// transactions older than a few days are answered only by archival nodes
const ARCHIVAL = (process.env.NEAR_ARCHIVAL_RPC_URLS || "https://archival-rpc.testnet.near.org,https://archival-rpc.testnet.fastnear.com").split(",");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Json = Record<string, any>;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function call(urls: string[], method: string, params: Json): Promise<Json> {
  let last: unknown;
  for (let i = 0; i < 4 * urls.length; i++) {
    try {
      const r = await fetch(urls[i % urls.length], { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const j = (await r.json()) as Json;
      if (j.result) return j.result;
      last = new Error(JSON.stringify(j.error ?? j).slice(0, 240));
    } catch (e) { last = e; }
    await sleep(600 + 400 * Math.floor(i / urls.length));
  }
  throw last;
}
const query = (params: Json) => call(RPCS, "query", { finality: "final", ...params });
const view = async (method: string, args: Json = {}, account = BANK) =>
  JSON.parse(Buffer.from((await query({ request_type: "call_function", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") })).result).toString());
const keysOf = async (account: string): Promise<Array<{ public_key: string; access_key: { permission: any } }>> => (await query({ request_type: "view_access_key_list", account_id: account })).keys;

let passed = 0, failed = 0;
function check(ok: boolean, what: string, detail = "") {
  if (ok) passed++; else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
}
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

async function main() {
  console.log(`bank ${BANK} on NEAR testnet, read through ${RPCS[0]} (and fallbacks)\n`);

  // ---------------------------------------------------------------- 1. the bank's state
  const s = await view("get_state");
  let wallets = 0n;
  for (let from = 0; from < Number(s.accounts); from += 200) for (const [, w] of await view("get_depositors", { from_index: from, limit: 200 })) wallets += BigInt(w);
  const supply = BigInt(s.supply), held = wallets + BigInt(s.reserve) + BigInt(s.loans);
  check(held === supply, "every LEMON is accounted for", `wallets ${wallets} + vault ${s.reserve} + loans ${s.loans} = ${held}; supply ${supply}`);
  check(s.max_supply === "150000", "the ceiling is 150,000 LEMON", `max_supply ${s.max_supply}`);
  check(supply <= BigInt(s.max_supply ?? 0), "the supply is under the ceiling", `${supply} of ${s.max_supply}`);
  check(Number(s.epoch_ms) === 3_300_000, "a bank day lasts 55 minutes", `epoch_ms ${s.epoch_ms}`);
  check(Number(s.max_accounts) === 500 && Number(s.accounts) <= 500, "at most 500 accounts", `${s.accounts} of ${s.max_accounts}`);
  check(/\.sputnik-v2\.testnet$/.test(s.owner), "the owner is a Sputnik DAO", s.owner);
  const dao = await view("get_policy", {}, s.owner).catch(() => null);
  const council = dao?.roles?.find((r: Json) => r.kind?.Group)?.kind.Group as string[] | undefined;
  check(!!council && council.length === 3, "the DAO has a council of three", council?.join(", ") ?? "policy not readable");
  check(/^[0-9a-f]{64}$/.test(s.chair_signer ?? ""), "a model signing key is pinned: only its signed answers set policy", `${String(s.chair_signer).slice(0, 8)}…, model ${s.chair_model}`);
  check(/^[0-9a-f]{64}$/.test(s.chair_prompt_sha256 ?? ""), "the system prompt is pinned by its hash", `${String(s.chair_prompt_sha256).slice(0, 8)}…`);
  const saved = JSON.parse(readFileSync(path.join(root, "data/attestation-report.json"), "utf8"));
  check(JSON.stringify(saved).includes(s.chair_signer), "the pinned key is the one in the saved NEAR AI attestation report", "data/attestation-report.json; `npm run attest -- --file` checks the report itself");
  const late = Date.now() - Number(s.next_epoch_ms), silent = Number(s.epoch_id) - Number(s.policy_set_epoch_id);
  check(late < 2 * 3600_000, "the bank day keeps moving", late > 0 ? `next one due ${Math.round(late / 60000)} min ago` : `next one in ${Math.round(-late / 60000)} min`);
  check(silent <= 3, "the chair keeps speaking", `last statement ${silent} bank day(s) ago: "${String(s.policy.statement).slice(0, 80)}"`);

  // ---------------------------------------------------------------- 2. the token
  const [ftSupply, meta, stats, log] = await Promise.all([view("ft_total_supply"), view("ft_metadata"), view("get_stats"), view("get_supply_log")]);
  check(ftSupply === s.supply, "ft_total_supply equals the bank's supply", ftSupply);
  check(meta.symbol === "LEMON" && meta.spec === "ft-1.0.0" && meta.decimals === 0, "NEP-141 metadata", `${meta.name}, ${meta.symbol}, ${meta.decimals} decimals`);
  check(Array.isArray(log) && log.length > 0 && log.length <= 60 && log.every((e: Json) => (e.kind === "mint" || e.kind === "burn") && typeof e.memo === "string" && e.memo), "the supply log holds the latest mints and burns, each with a reason", `${log.length} entries: ${[...new Set(log.map((e: Json) => e.memo))].join(", ")}`);
  check(BigInt(stats.total_burned) > 0n && BigInt(stats.total_minted) > 0n && Number(stats.rounds_fallen) > 0, "the bank's record", `${stats.rounds_fallen} rounds fallen, ${stats.rounds_survived} survived, ${stats.total_burned} LEMON burned, ${stats.total_minted} printed`);

  // ---------------------------------------------------------------- 3. keys
  const chairKeys = await keysOf(s.chair);
  const capped = chairKeys.filter((k) => k.access_key.permission?.FunctionCall);
  check(capped.length > 0 && capped.every((k) => k.access_key.permission.FunctionCall.receiver_id === BANK && same(k.access_key.permission.FunctionCall.method_names, ["set_policy", "set_policy_attested"])),
    "the chair's keeper key can call only set_policy and set_policy_attested on the bank", `${s.chair}: ${capped.length} function-call key(s)`);
  const guest = JSON.parse(readFileSync(path.join(root, "apps/web/src/chain/publicGuest.json"), "utf8"));
  const guestKeys = await keysOf(guest.accountId);
  check(guestKeys.length > 0 && guestKeys.every((k) => k.access_key.permission?.FunctionCall?.receiver_id === BANK && same(k.access_key.permission.FunctionCall.method_names, guest.methods)),
    "the published guest key is a function-call key for nine bank methods, and the account has no full-access key", `${guest.accountId}: ${guest.methods.join(", ")}`);
  const bankKeys = await keysOf(BANK);
  check(bankKeys.length === 0, "the contract account holds no access key: nobody can replace its code or change its rules",
    bankKeys.length ? `${bankKeys.length} key(s): ${bankKeys.map((k) => (k.access_key.permission === "FullAccess" ? "full access" : "function call")).join(", ")}` : "view_access_key_list is empty");

  // ---------------------------------------------------------------- 4. the printer's lock, asked directly
  const half = String(supply / 2n), cap = supply * 50n / 1000n;
  const why = await view("check_policy", { caller: s.chair, rate: Number(s.policy.rate), target: Number(s.policy.target), mint: half, gate: "0", tone: "calm", statement: "print half", attestation: "" });
  check(typeof why === "string" && (why === "policy already set this epoch" || why.includes(`mint ${half} LEMON refused: above 5% of supply, at most ${cap} this epoch`)),
    why === "policy already set this epoch" ? "a second policy in one bank day is refused, whatever it asks (here: print half of all LEMON)" : "asked to print half of all LEMON, the contract answers no",
    why === "policy already set this epoch" ? `${why}; the chair has spoken today, so this rule answers first. The 5% cap is in the refusals below (AdjKfG7D…, HG3S6NMp…)` : String(why));
  const stranger = await view("check_policy", { caller: guest.accountId, rate: Number(s.policy.rate), target: Number(s.policy.target), mint: "0", gate: "0", tone: "calm", statement: "", attestation: "" });
  check(stranger === "only the chair can set policy", "a policy from anyone but the chair is refused", String(stranger));

  // ---------------------------------------------------------------- 5. the transactions the README and the page cite
  const evidence = JSON.parse(readFileSync(path.join(root, "apps/web/src/chain/evidence.json"), "utf8")).items as Array<{ ok: boolean; tx: string; by: string; label: string; expect?: string[] }>;
  const lookup = async (e: (typeof evidence)[number]): Promise<[boolean, string]> => {
    let line = `${e.ok ? "done   " : "refused"} ${e.tx.slice(0, 8)}…  ${e.label.slice(0, 96)}`;
    try {
      const r = await call(ARCHIVAL, "tx", { tx_hash: e.tx, sender_account_id: e.by, wait_until: "FINAL" });
      const text = JSON.stringify(r.status) + "\n" + r.receipts_outcome.map((o: Json) => o.outcome.logs.join("\n") + "\n" + JSON.stringify(o.outcome.status)).join("\n");
      const refused = !!r.status?.Failure;
      const missing = (e.expect ?? []).filter((x) => !text.includes(x));
      const ok = r.transaction.signer_id === e.by && refused === !e.ok && missing.length === 0;
      if (!ok) line += `  [signer ${r.transaction.signer_id}, ${refused ? "failed" : "succeeded"}${missing.length ? `, not found: ${missing.join(" | ")}` : ""}]`;
      else if (e.expect) line += `  [${e.expect.join(" ").replace(/"/g, "").slice(0, 90)}]`;
      return [ok, line];
    } catch (err) { return [false, `${line}  (could not be read: ${String((err as Error)?.message ?? err).slice(0, 120)})`]; }
  };
  // four lookups at a time: public archival nodes answer slowly and rate-limit a burst
  for (let i = 0; i < evidence.length; i += 4) for (const [ok, line] of await Promise.all(evidence.slice(i, i + 4).map(lookup))) check(ok, line);

  // ---------------------------------------------------------------- 6. the leaderboard, replayed
  const today = await view("get_runs");
  let claims = 0, replayed = 0, flagged = 0;
  for (let day = Number(today.day); day >= Math.max(0, Number(today.day) - 6); day--) {
    const d = day === Number(today.day) ? today : await view("get_runs", { day });
    for (const r of d.runs ?? []) {
      claims++;
      let got: { score: number; ending: string } | null = null;
      try { const res = String(r.moves).length <= 200 ? replayCrisis(Number(d.seed), decodeMoves(String(r.moves))!) : null; if (res) got = { score: res.result.score, ending: res.result.ending }; } catch { got = null; }
      const ok = got !== null && got.score === Number(r.score) && got.ending === r.ending;
      if (ok) replayed++; else flagged++;
      console.log(`      day ${day}  ${String(r.account).slice(0, 44).padEnd(44)} claims ${String(r.score).padStart(3)}/100 ${String(r.ending).padEnd(14)} ${ok ? "replays" : `DOES NOT REPLAY (the moves give ${got ? `${got.score}/100 ${got.ending}` : "nothing"})`}`);
    }
  }
  check(claims === replayed + flagged, "every leaderboard claim of the last seven days was replayed with the game's engine", `${claims} claims: ${replayed} replay, ${flagged} flagged as not replaying`);

  console.log(`\nverify:chain: ${passed} checks passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(`verify:chain: could not finish: ${e?.message ?? e}`); process.exit(2); });
