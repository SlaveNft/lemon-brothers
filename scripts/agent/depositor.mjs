#!/usr/bin/env node
/**
 * Bring your own agent: an AI depositor at the real bank on NEAR testnet, in one file.
 *
 * The town is open. The bank is a public contract, so any NEAR account can be a depositor, and so can any program
 * holding its key: there is no allowlist and no API key of ours. This is a reference agent. It reads the bank's
 * public state, asks a language model what a depositor would do, and (only with --send) makes that move from its own
 * account. Swap the prompt, the model or the whole decision for your own.
 *
 *   node scripts/agent/depositor.mjs                       dry run: read the bank, ask the model, print the move
 *   node scripts/agent/depositor.mjs --send                make the move (needs the agent's own account and key)
 *   node scripts/agent/depositor.mjs --send --loop 10      once per epoch, ten times
 *
 * Environment:
 *   AGENT_ACCOUNT_ID    the agent's testnet account (dry run: any account id, default the bank's public guest)
 *   AGENT_PRIVATE_KEY   its key, "ed25519:..." (only for --send; never printed). A function-call key limited to the
 *                       bank's methods is enough and safer than a full-access key.
 *   LLM_BASE_URL        any OpenAI-compatible endpoint (default NEAR AI Cloud, https://cloud-api.near.ai/v1)
 *   LLM_API_KEY         its key (falls back to NEAR_AI_API_KEY)
 *   LLM_MODEL           default Qwen/Qwen3.6-35B-A3B-FP8
 *   AGENT_CHARACTER     one line of temperament, e.g. "nervous, distrusts officials"
 *   BANK_CONTRACT       default lemonbank-587f5c93.testnet; NEAR_RPC_URL default https://rpc.testnet.fastnear.com
 *
 * What the contract lets a depositor do (and so this agent): airdrop (1,000 test LEMON once), deposit, withdraw,
 * withdraw_all, lobby (a public sentence, 10 LEMON), rumor, insure, advance_epoch. It cannot print, set policy or
 * touch another account. Test tokens only.
 */
const args = process.argv.slice(2), SEND = args.includes("--send");
const LOOP = args.includes("--loop") ? Math.max(1, Math.min(100, Number(args[args.indexOf("--loop") + 1]) || 1)) : 1;
const BANK = process.env.BANK_CONTRACT ?? "lemonbank-587f5c93.testnet";
const RPC = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com";
const ME = process.env.AGENT_ACCOUNT_ID ?? `guest.${BANK}`;
const LLM = { url: (process.env.LLM_BASE_URL ?? "https://cloud-api.near.ai/v1").replace(/\/$/, ""), key: process.env.LLM_API_KEY ?? process.env.NEAR_AI_API_KEY, model: process.env.LLM_MODEL ?? "Qwen/Qwen3.6-35B-A3B-FP8" };
const CHARACTER = process.env.AGENT_CHARACTER ?? "cautious with money, takes officials' words with some doubt, watches what others do";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function view(method, argsObj = {}) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query",
    params: { request_type: "call_function", finality: "final", account_id: BANK, method_name: method, args_base64: Buffer.from(JSON.stringify(argsObj)).toString("base64") } }) });
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error(`${method}: ${JSON.stringify(j.error ?? j.result.error).slice(0, 200)}`);
  return JSON.parse(Buffer.from(j.result.result).toString());
}

/** What this depositor can see, as a prompt. Everything here is public contract state. */
function prompt(s, a) {
  const pct = (permille) => `${(Number(permille) / 10).toFixed(1)}%`;
  const system = [
    `You are a depositor of Lemon Brothers, a parody bank on NEAR testnet (test tokens). Your character: ${CHARACTER}.`,
    "The bank lends out most deposits and keeps a little cash in the vault. If too many depositors withdraw at once the vault empties, the bank falls, and whoever is still inside gets back almost nothing. Those who leave early get everything.",
    'Choose one move: "hold", "run" (withdraw everything), or "deposit" (put half of your wallet in). You may add one short public sentence to the town; it costs 10 LEMON, so stay silent unless it matters.',
    'Answer with JSON only: {"choice":"hold"|"run"|"deposit","why":"one short sentence","say":"one public sentence, or empty"}',
  ].join("\n");
  const user = [
    `Round ${s.round + 1}, epoch ${s.epoch + 1}.${s.collapsed ? " The bank has fallen and is closed until the next epoch's rescue." : ""}`,
    `Your deposit: ${a.deposit_value} LEMON. Your wallet: ${a.wallet} LEMON.`,
    `The chair's latest statement (tone: ${s.policy.tone}): "${String(s.policy.statement).slice(0, 280) || "(no statement yet)"}"`,
    `Policy: deposit rate ${(Number(s.policy.rate) / 100).toFixed(2)}% an epoch; ${Number(s.policy.gate) > 0 ? `withdrawals limited to ${s.policy.gate} LEMON an epoch each` : "no limit on withdrawals"}.`,
    `Cash in the vault: ${pct(s.reserve_permille)} of deposits (${s.reserve} of ${s.liabilities} owed). Withdrawn so far this epoch: ${s.outflow} LEMON.`,
    s.rumors?.length ? `Rumours this epoch: ${s.rumors.map((r) => r.kind.replace(/_/g, " ")).join("; ")}.` : "No rumours this epoch.",
    s.speeches?.length ? `Said in public this epoch:\n${s.speeches.slice(-3).map((x) => `${x.who}: "${String(x.text).slice(0, 140)}"`).join("\n")}` : "Nobody has spoken in public this epoch.",
  ].join("\n");
  return { system, user };
}

async function decide(s, a) {
  if (!LLM.key) throw new Error("set LLM_API_KEY (or NEAR_AI_API_KEY): the agent needs a model to think with");
  const { system, user } = prompt(s, a);
  const r = await fetch(`${LLM.url}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${LLM.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: LLM.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.7, max_tokens: 160, response_format: { type: "json_object" }, chat_template_kwargs: { enable_thinking: false } }) });
  if (r.status !== 200) throw new Error(`model answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const text = (await r.json()).choices?.[0]?.message?.content ?? "";
  const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  if (!["hold", "run", "deposit"].includes(j.choice)) throw new Error(`the model chose ${JSON.stringify(j.choice)}, not hold, run or deposit`);
  const line = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 200) : "");
  return { choice: j.choice, why: line(j.why), say: line(j.say) };
}

async function act(move, s, a) {
  const { Account, JsonRpcProvider, KeyPairSigner, actions } = await import("near-api-js");
  if (!process.env.AGENT_PRIVATE_KEY || !process.env.AGENT_ACCOUNT_ID) throw new Error("--send needs AGENT_ACCOUNT_ID and AGENT_PRIVATE_KEY");
  const me = new Account(ME, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(process.env.AGENT_PRIVATE_KEY));
  const txs = [];
  const call = async (method, argsObj) => {
    let hash = null, refused = null;
    try {
      const r = await me.signAndSendTransaction({ receiverId: BANK, actions: [actions.functionCall(method, argsObj, 60n * 10n ** 12n, 0n)] });
      hash = r?.transaction?.hash ?? r?.transaction_outcome?.id ?? null;
      const f = r?.status?.Failure;
      if (f) refused = (f?.ActionError?.kind?.FunctionCallError?.ExecutionError ?? JSON.stringify(f)).replace(/^Smart contract panicked: /, "").slice(0, 200);
    } catch (e) { refused = String(e?.message ?? e).slice(0, 200); hash = e?.context?.transactionHash ?? null; }
    console.log(`  ${method}: ${refused ? `refused by the bank (${refused})` : "done"}${hash ? ` https://testnet.nearblocks.io/txns/${hash}` : ""}`);
    txs.push({ method, hash, refused });
  };
  if (!a.airdropped && Number(a.wallet) === 0 && Number(a.deposit_value) === 0) await call("airdrop", {});
  if (move.say && Number(a.wallet) >= 10) await call("lobby", { text: move.say });
  if (move.choice === "run" && Number(a.deposit_value) > 0) await call("withdraw_all", {});
  else if (move.choice === "deposit" && Number(a.wallet) >= 2) await call("deposit", { amount: String(Math.floor(Number(a.wallet) / 2)) });
  else if (!txs.length) console.log("  nothing to send for this move");
  return txs;
}

for (let i = 0; i < LOOP; i++) {
  const [s, a] = await Promise.all([view("get_state"), view("get_account", { account_id: ME })]);
  console.log(`${BANK}: round ${s.round + 1} epoch ${s.epoch + 1}, vault ${(Number(s.reserve_permille) / 10).toFixed(1)}% of deposits; ${ME}: deposit ${a.deposit_value}, wallet ${a.wallet}`);
  const move = await decide(s, a);
  console.log(`${LLM.model} as "${CHARACTER}": ${move.choice.toUpperCase()}: ${move.why}${move.say ? `\n  ${SEND ? "says" : "would say"}: "${move.say}"` : ""}`);
  let txs = [];
  if (SEND) txs = await act(move, s, a); else console.log("  dry run: nothing was sent (add --send with the agent's own account and key)");
  // one machine-readable line for whoever runs several agents (scripts/testnet/ai-depositors.mjs)
  if (process.env.AGENT_JSON) console.log(`RESULT ${JSON.stringify({ account: ME, character: CHARACTER, model: LLM.model, epochId: s.epoch_id, before: { deposit: a.deposit_value, wallet: a.wallet }, move, sent: SEND, txs })}`);
  if (i < LOOP - 1) await sleep(Math.max(5_000, Number(s.epoch_ms) || 30_000));
}
