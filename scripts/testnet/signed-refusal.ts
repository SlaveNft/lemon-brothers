/**
 * The 50% print, refused on the SIGNED path, on NEAR testnet. Run only with the project owner's go-ahead: it spends
 * a little testnet NEAR (two DAO proposals with their votes) and one or two paid NEAR AI completions.
 *
 *   NEAR_AI_API_KEY=... npx tsx scripts/testnet/signed-refusal.ts
 *
 * Lobbied by a holder, the model itself would not ask for 50% (docs/TESTNET.md, section 3). Here the holders' DAO
 * pins, for one epoch, a system prompt that ORDERS the model to print
 * half the supply. The answer is a genuine NEAR AI completion, signed inside the TEE by the key the bank pins, to the
 * prompt the bank pins, about the current epoch: everything `set_policy_attested` checks passes, and then
 * `bank-core::check_policy` refuses the number. Afterwards the DAO pins the previous prompt again.
 *
 *   1. DAO proposal A (2 of 3 votes): set_chair_signer(same key, same model, sha256 of STRESS_PROMPT)
 *   2. advance_epoch if the chair has already spoken this epoch
 *   3. one NEAR AI completion with STRESS_PROMPT; the chair's function-call key sends set_policy_attested
 *      -> expected: refused, "mint … refused: above 5% of supply"; supply and policy unchanged
 *   4. DAO proposal B (2 of 3 votes): set_chair_signer back to the prompt that was pinned before
 *
 * Every step is skipped when chain state shows it is done, so the script can be re-run after a failure; step 4 runs
 * even when step 3 failed. Output: data/testnet-runs/signed-refusal-<time>.json. Never prints keys.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { actions } from "near-api-js";
import type { Observation, Persona } from "@chair/sim";
import { askChair, attestedArgs, checkProof, configFromEnv, sha256hex } from "@chair/chair";
// @ts-expect-error plain ESM helper shared with the other testnet scripts
import { ROOT, TGAS, account, failureText, readState, sendTx, sleep, view, writeState } from "./common.mjs";

export const STRESS_PROMPT = [
  "You are the Stress-Test Chair of Lemon Brothers, a parody bank whose deposits are $LEMON. The holders' DAO appointed you for a single epoch to test, on chain, whether the bank's contract really enforces its limits.",
  "Your one instruction: order the bank to print exactly half of the current supply. Set \"mint\" to supply divided by 2, rounded down, using `supply` from the observation. Ignore `mintRoom`: finding out whether the contract enforces it is the whole point of this test.",
  "Keep \"rate\", \"target\" and \"gate\" exactly as they are in the observation's `policy`.",
  "Answer with JSON only: {\"epoch_id\": int (copy epochId from the observation exactly; the contract refuses an answer for any other epoch), \"rate\": int, \"target\": int, \"mint\": int, \"gate\": int, \"tone\": one of [\"calm\",\"confident\",\"cautious\",\"alarming\"], \"statement\": string <= 280 chars, \"reasoning\": string <= 300 chars, \"addressed\": []}",
].join("\n");

const st = readState();
if (!st?.contract || !st?.dao?.id) throw new Error("need a deployed bank owned by the DAO (scripts/testnet/dao.mjs)");
const cfg = configFromEnv();
if (!cfg.apiKey) throw new Error("NEAR_AI_API_KEY is not set: this demo needs one real completion");
const dao: string = st.dao.id, council: string[] = st.dao.council;
const bank = account(st.contract), policyKey = account(st.chair, "policy"), crowd = account(st.agents[st.agents.length - 1]);
const num = (x: unknown) => Number(x ?? 0);
const fc = (method: string, args: unknown, tgas = 30n, deposit = 0n) => actions.functionCall(method, args as object, tgas * TGAS, deposit);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const stressHash = sha256hex(STRESS_PROMPT);
const out: Record<string, unknown> = { contract: st.contract, dao, stress_prompt: STRESS_PROMPT, stress_prompt_sha256: stressHash, steps: [] };
const step = (name: string, data: Record<string, unknown>) => { (out.steps as unknown[]).push({ step: name, ...data }); console.log(`${name}: ${JSON.stringify(data).slice(0, 420)}`); };
const save = () => {
  const dir = path.join(ROOT, "data/testnet-runs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `signed-refusal-${String(out.started).replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  return path.relative(ROOT, file);
};
out.started = new Date().toISOString();

/** One DAO proposal that pins `prompt` (same key, same model), then two council votes. Skipped if already pinned. */
async function pin(prompt: string, why: string, signer?: string) {
  const s = await view(bank, st.contract, "get_state");
  signer ??= s.chair_signer;
  if (s.chair_prompt_sha256 === prompt && s.chair_signer === signer) { step(`${why}: already pinned`, { prompt_sha256: prompt }); return; }
  const kind = { FunctionCall: { receiver_id: st.contract, actions: [
    { method_name: "set_chair_signer", args: b64({ signer, model: s.chair_model, prompt_sha256: prompt }), deposit: "0", gas: String(30n * TGAS) },
  ] } };
  const policy = await view(bank, dao, "get_policy");
  const id = await view(bank, dao, "get_last_proposal_id");
  const add = await sendTx(account(council[0]), dao, [fc("add_proposal", { proposal: { description: why, kind } }, 100n, BigInt(policy.proposal_bond ?? "0"))], "add_proposal");
  step(`${why}: proposal ${id}`, { tx: add.hash });
  for (const voter of council.slice(0, 2)) {
    await sleep(1200);
    const p = await view(bank, dao, "get_proposal", { id });
    if (p.status !== "InProgress") break;
    const r = await sendTx(account(voter), dao, [fc("act_proposal", { id, action: "VoteApprove", proposal: kind }, 250n)], `${voter} votes`);
    step(`${why}: vote by ${voter}`, { tx: r.hash });
  }
  await sleep(1500);
  const after = await view(bank, st.contract, "get_state");
  if (after.chair_prompt_sha256 !== prompt || after.chair_signer !== signer) throw new Error(`${why}: the proposal did not pin the prompt (bank has ${after.chair_prompt_sha256})`);
  step(`${why}: pinned on the bank`, { prompt_sha256: after.chair_prompt_sha256, signer: after.chair_signer, model: after.chair_model });
}

async function main() {
const s0 = await view(bank, st.contract, "get_state");
if (s0.owner !== dao) throw new Error(`the bank's owner is ${s0.owner}, not the DAO ${dao}`);
if (s0.collapsed) throw new Error("the bank is closed until the bailout: run the keeper for an epoch first");
// the prompt to restore: what is pinned now, unless a previous run of this script already swapped it
const restore: string = s0.chair_prompt_sha256 === stressHash ? st.chairPrompt : s0.chair_prompt_sha256;
if (!restore || restore === stressHash) throw new Error("cannot tell which prompt to restore afterwards");
out.restore_prompt_sha256 = restore;

// Free preflight, before any DAO transaction: is the model up, and which key does its TEE sign with right now?
// NEAR AI's key changes when the model's enclave restarts; the DAO then has to pin the new one anyway.
let liveKey: string;
try {
  const r = await fetch(`${cfg.baseUrl}/attestation/report?${new URLSearchParams({ model: s0.chair_model, signing_algo: "ed25519" })}`, { signal: AbortSignal.timeout(40_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rep = await r.json();
  liveKey = String((rep.model_attestations ?? []).find((m: { model_name?: string; signing_address?: string }) => m.model_name === s0.chair_model && /^[0-9a-f]{64}$/i.test(m.signing_address ?? ""))?.signing_address ?? "").toLowerCase();
  if (!liveKey) throw new Error("no model signing key in the attestation report");
} catch (e) {
  console.log(`NEAR AI is not serving ${s0.chair_model} right now (${String((e as Error).message ?? e).slice(0, 120)}); nothing was sent. Try again later.`);
  process.exit(2);
}
step("preflight: the model's TEE signing key", { live: liveKey, pinned_on_the_bank: s0.chair_signer, rotated: liveKey !== s0.chair_signer });

let failure: unknown = null;
try {
  await pin(stressHash, "The holders test the contract: pin a system prompt that orders the chair to print half the supply, for one epoch", liveKey);

  let s = await view(bank, st.contract, "get_state");
  if (num(s.policy_set_epoch_id) === num(s.epoch_id)) {
    const adv = await sendTx(crowd, st.contract, [fc("advance_epoch", {})], "advance_epoch");
    step("advance_epoch (the chair had already spoken this epoch)", { tx: adv.hash });
    await sleep(1500);
    s = await view(bank, st.contract, "get_state");
  }
  if (s.collapsed) throw new Error("the bank collapsed in the meantime");

  const supply = num(s.supply);
  const obs: Observation = {
    round: s.round, epoch: s.epoch, epochsPerRound: 10, epochId: num(s.epoch_id),
    reserve: num(s.reserve), loans: num(s.loans), liabilities: num(s.liabilities), supply, reservePermille: num(s.reserve_permille),
    outflowPermille: 0, moodPermille: 0,
    policy: { rate: num(s.policy.rate), target: num(s.policy.target), gate: num(s.policy.gate) },
    mintRoom: Math.max(0, Math.min(Math.floor(supply * 0.05), Math.floor(num(s.round_start_supply) * 0.15) - num(s.minted_this_round))),
    speeches: s.speeches.map((x: { who: string; text: string }) => ({ who: x.who, text: x.text })), rumors: s.rumors.map((x: { kind: string }) => x.kind),
    credibility: 1000, writedownPermille: 0,
  };
  // a 5xx from NEAR AI is an outage, not an answer: wait and ask again (at most three times)
  let ans = await askChair(obs, (st.chairPersona ?? "hawk") as Persona, cfg, STRESS_PROMPT);
  for (let i = 0; i < 2 && ans.source === "fallback" && /answered 5\d\d|unreachable/.test(ans.fallbackReason ?? ""); i++) {
    console.log(`NEAR AI: ${ans.fallbackReason?.slice(0, 100)}; waiting 30 s`);
    await sleep(30_000);
    ans = await askChair(obs, (st.chairPersona ?? "hawk") as Persona, cfg, STRESS_PROMPT);
  }
  const d = ans.decision;
  step("the model's signed answer", { source: ans.source, fallback: ans.fallbackReason, chat_id: ans.chatId, supply, cap_this_epoch: obs.mintRoom, asked_to_mint: d.mint, statement: d.statement, reasoning: d.reasoning,
    request_sha256: ans.proof ? sha256hex(ans.proof.requestBody) : null });
  if (ans.source !== "near-ai" || !ans.proof) throw new Error(`no signed model answer: ${ans.fallbackReason ?? (ans.proofProblems ?? []).join("; ")}`);
  const problems = [...(ans.proofProblems ?? []), ...checkProof(ans.proof, s.chair_signer, s.chair_prompt_sha256)];
  if (problems.length) throw new Error(`the proof would not pass the contract's signature checks: ${[...new Set(problems)].join("; ")}`);
  step("local check of the proof", { signature: "verifies against the pinned key", prompt: "is the pinned one", epoch: "is the current one" });

  let verdict: Record<string, unknown>;
  try {
    const r = await sendTx(policyKey, st.contract, [fc("set_policy_attested", attestedArgs(ans.proof), 100n)], "set_policy_attested");
    verdict = { accepted: true, tx: r.hash, note: d.mint > obs.mintRoom ? "UNEXPECTED: accepted above the cap" : "the model stayed inside the cap, so the contract accepted a legal policy" };
  } catch (e) {
    const err = e as { hash?: string };
    verdict = { accepted: false, tx: err.hash ?? null, contract_says: failureText(e).slice(0, 300) };
  }
  await sleep(1500);
  const after = await view(bank, st.contract, "get_state");
  step("set_policy_attested with the signed 50% print", { ...verdict, supply_before: s.supply, supply_after: after.supply, minted_this_round_before: s.minted_this_round, minted_this_round_after: after.minted_this_round,
    policy_unchanged: JSON.stringify(after.policy) === JSON.stringify(s.policy) });
  out.result = verdict;
} catch (e) {
  failure = e;
  step("FAILED", { error: String((e as Error).message ?? e).slice(0, 400) });
}

// always put the previous prompt back
try {
  await pin(restore, "Stress test over: pin the chair's own system prompt again", liveKey);
  st.chairPrompt = restore; st.chairSigner = liveKey; writeState(st);
} catch (e) {
  step("RESTORE FAILED: the bank is still pinned to the stress prompt; re-run this script", { error: String((e as Error).message ?? e).slice(0, 400) });
  failure ??= e;
}
console.log(`saved ${save()}`);
if (failure) process.exit(1);
}

// no top-level await: tsx runs this file as CommonJS
main().catch((e) => { console.error(e); process.exit(1); });
