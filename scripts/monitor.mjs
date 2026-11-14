#!/usr/bin/env node
/**
 * Watch the deployed bank and say when something is wrong. Read-only: public RPC views, no keys, no transactions.
 *
 *   npm run monitor                 one check; exit code 1 if any ALERT
 *   npm run monitor -- --watch 10   check every 10 minutes until stopped
 *
 * Checks: every LEMON is accounted for (wallets + reserve + loans = supply), the supply is under the ceiling, the
 * number of accounts is under the cap, the contract can still pay for its storage, the bank day keeps moving (the
 * keeper is alive) and the chair keeps speaking; and it reports which keys the contract account still holds.
 */
const ACCOUNT = process.env.BANK ?? "lemonbank-587f5c93.testnet";
const RPCS = (process.env.NEAR_RPC_URLS || "https://rpc.testnet.near.org,https://test.rpc.fastnear.com,https://rpc.testnet.fastnear.com").split(",");
const YOCTO_PER_BYTE = 10n ** 19n;

async function rpc(params) {
  let last;
  for (let i = 0; i < 3 * RPCS.length; i++) {
    try {
      const r = await fetch(RPCS[i % RPCS.length], { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }), signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j.result) return j.result;
      last = new Error(JSON.stringify(j.error ?? j).slice(0, 200));
    } catch (e) { last = e; }
    await new Promise((ok) => setTimeout(ok, 800));
  }
  throw last;
}
const view = async (method, args = {}) => JSON.parse(Buffer.from((await rpc({ request_type: "call_function", account_id: ACCOUNT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") })).result).toString());

async function check() {
  const alerts = [], notes = [];
  const s = await view("get_state");
  let wallets = 0n;
  for (let from = 0; from < Number(s.accounts); from += 200) for (const [, w] of await view("get_depositors", { from_index: from, limit: 200 })) wallets += BigInt(w);
  const supply = BigInt(s.supply), held = wallets + BigInt(s.reserve) + BigInt(s.loans);
  (held === supply ? notes : alerts).push(`LEMON accounted for: wallets ${wallets} + reserve ${s.reserve} + loans ${s.loans} = ${held}, supply ${supply}`);
  if (s.max_supply) (supply <= BigInt(s.max_supply) ? notes : alerts).push(`supply ${supply} of the ceiling ${s.max_supply}`);
  else alerts.push("no supply ceiling is set");
  const cap = Number(s.max_accounts ?? 0);
  if (cap) (Number(s.accounts) < cap * 0.9 ? notes : alerts).push(`accounts ${s.accounts} of ${cap}`);
  const acc = await rpc({ request_type: "view_account", account_id: ACCOUNT });
  const free = BigInt(acc.amount) - BigInt(acc.storage_usage) * YOCTO_PER_BYTE;
  (free > 10n ** 24n ? notes : alerts).push(`contract balance free for storage: ${(Number(free / 10n ** 21n) / 1000).toFixed(3)} NEAR (${acc.storage_usage} bytes stored)`);
  const late = Date.now() - Number(s.next_epoch_ms);
  (late < 2 * 3600_000 ? notes : alerts).push(`bank day ${s.epoch_id}: ${late > 0 ? `next one due ${Math.round(late / 60000)} min ago` : `next one in ${Math.round(-late / 60000)} min`} (a day is ${Math.round(Number(s.epoch_ms) / 60000)} min)`);
  const silent = Number(s.epoch_id) - Number(s.policy_set_epoch_id);
  (silent <= 3 ? notes : alerts).push(`the chair last spoke ${silent} bank day(s) ago`);
  const keys = (await rpc({ request_type: "view_access_key_list", account_id: ACCOUNT })).keys;
  notes.push(`contract account keys: ${keys.length ? keys.map((k) => (k.access_key.permission === "FullAccess" ? "full access" : "function call")).join(", ") : "none (nobody can change its code)"}`);
  const at = new Date().toISOString().slice(0, 16).replace("T", " ");
  for (const n of notes) console.log(`${at}  ok     ${n}`);
  for (const a of alerts) console.log(`${at}  ALERT  ${a}`);
  return alerts.length;
}

const w = process.argv.indexOf("--watch");
if (w > 0) {
  const minutes = Number(process.argv[w + 1] ?? 10);
  for (;;) { try { await check(); } catch (e) { console.log(`ALERT  the bank could not be read: ${e.message ?? e}`); } await new Promise((ok) => setTimeout(ok, minutes * 60_000)); }
} else process.exit((await check()) ? 1 : 0);
