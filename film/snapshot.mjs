// Read the bank on NEAR testnet (public RPC, read-only) and save the numbers the film shows as src/chain.json.
//   npm run snapshot
import { writeFileSync } from "node:fs";
const BANK = "lemonbank-96b0974e.testnet";
const RPCS = ["https://rpc.testnet.near.org", "https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com"];
async function view(method, args = {}) {
  let last;
  for (let i = 0; i < 9; i++) {
    try {
      const r = await fetch(RPCS[i % RPCS.length], { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: BANK, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
      const j = await r.json();
      if (j.result?.result) return JSON.parse(Buffer.from(j.result.result).toString());
      last = new Error(JSON.stringify(j.error ?? j).slice(0, 200));
    } catch (e) { last = e; }
  }
  throw last;
}
const [s, stats, log] = await Promise.all([view("get_state"), view("get_stats"), view("get_supply_log")]);
const keys = (await (await fetch(RPCS[0], { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key_list", finality: "final", account_id: BANK } }) })).json()).result.keys.length;
const out = {
  readAt: new Date().toISOString(), contract: BANK, keys,
  supply: Number(s.supply), ceiling: Number(s.max_supply), vault: Number(s.reserve), owed: Number(s.liabilities), loans: Number(s.loans),
  bankDay: Number(s.epoch_id), round: Number(s.round) + 1, accounts: Number(s.accounts),
  burned: Number(stats.total_burned), printed: Number(stats.total_minted), fallen: Number(stats.rounds_fallen), survived: Number(stats.rounds_survived),
  chair: s.chair, owner: s.owner, model: s.chair_model, signer: s.chair_signer, statement: s.policy.statement, tone: s.policy.tone,
  rateBps: Number(s.policy.rate), targetPermille: Number(s.policy.target),
  log: log.map((e) => ({ day: Number(e.epoch_id), kind: e.kind, amount: Number(e.amount), memo: e.memo })),
};
writeFileSync(new URL("./src/chain.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`bank day ${out.bankDay}: ${out.supply} LEMON, ${out.burned} burned, ${out.printed} printed, fallen ${out.fallen} times; "${out.statement.slice(0, 70)}…"`);
