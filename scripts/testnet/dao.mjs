#!/usr/bin/env node
/**
 * The holders' DAO takes the bank and impeaches the chair, on NEAR testnet. Run only with the project owner's
 * go-ahead; it spends testnet NEAR from the `funders` accounts (scripts/testnet/fund.mjs). No NEAR AI call.
 * Each step is skipped when chain state shows it is done, so the script can be re-run after a failure.
 *
 *   PERSONA=hawk npx tsx scripts/testnet/dao.mjs
 *   LEMON_DEPLOY=deploy-v2.json DAO=lemon-brothers-587f5c93.sputnik-v2.testnet NEW_CHAIR=lemonhawk-24e23cdf.testnet \
 *     PERSONA=hawk npx tsx scripts/testnet/dao.mjs        an existing DAO takes a second bank; an existing chair is appointed
 *
 *   1. create a Sputnik DAO on sputnik-v2.testnet (5 NEAR for its storage), council = funders[0..2], 2 of 3 to pass
 *   2. the bank's owner (the contract account) calls set_owner(dao): from now on only proposals can impeach or pin
 *   3. a new chair account (helper-funded) with a keeper key limited to the chair's methods (open_question, set_policy, set_policy_attested) on the bank
 *   4. impeachment proposal: one FunctionCall proposal on the bank with set_chair(new chair) and
 *      set_chair_signer(NEAR AI key, model, sha256 of the PERSONA's system prompt)
 *   5. two council votes; the second one executes the proposal
 */
import { createHash } from "node:crypto";
import { KeyPair, actions } from "near-api-js";
import { chairSystemPrompt } from "@chair/sim";
import { CHAIR_METHODS, NEAR, TGAS, account, failureText, helperAccount, readState, saveKey, sendTx, sleep, view, writeState } from "./common.mjs";

const st = readState();
if (!st?.contract || (st.funders ?? []).length < 3) throw new Error("need a deployed bank and 3 funders (node scripts/testnet/fund.mjs 3)");
const FACTORY = "sputnik-v2.testnet";
const persona = process.env.PERSONA || "hawk";
const model = st.chairModel || "Qwen/Qwen3.6-35B-A3B-FP8";
const council = st.funders.slice(0, 3);
const bank = account(st.contract);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const fc = (method, args, tgas = 30n, deposit = 0n) => actions.functionCall(method, args, tgas * TGAS, deposit);
const log = (k, v) => { console.log(`${k}: ${v}`); };
st.dao ??= {};

async function exists(id) {
  try { await bank.provider.viewAccount({ accountId: id }); return true; } catch { return false; }
}

// 1. the DAO
const daoName = `lemon-brothers-${st.contract.split("-").pop().split(".")[0]}`;
const dao = st.dao.id ?? process.env.DAO ?? `${daoName}.${FACTORY}`;
if (!(await exists(dao))) {
  if (process.env.DAO) throw new Error(`DAO ${dao} does not exist`);
  const args = { config: { name: daoName, purpose: "Holders of Lemon Brothers ($LEMON): impeach the AI chair and pin what its signed answers must match (testnet demo)", metadata: "" }, policy: council };
  const r = await sendTx(account(council[0]), FACTORY, [fc("create", { name: daoName, args: b64(args) }, 150n, 5n * NEAR)], "create DAO");
  st.dao = { ...st.dao, id: dao, council, createTx: r.hash };
  writeState(st);
  await sleep(2000);
}
st.dao.id ??= dao;
st.dao.council ??= council;
writeState(st);
log("dao", dao);
const policy = await view(bank, dao, "get_policy");
const bond = BigInt(policy.proposal_bond ?? "0");

// 2. the bank's owner hands over
let s = await view(bank, st.contract, "get_state");
if (s.owner !== dao) {
  if (s.owner !== st.contract) throw new Error(`the bank's owner is ${s.owner}, not the contract account: cannot hand over from here`);
  const r = await sendTx(bank, st.contract, [fc("set_owner", { owner_id: dao })], "set_owner");
  st.dao.handoverTx = r.hash; st.owner = dao;
  writeState(st);
}
log("owner", dao);

// 3. the new chair: its own account and a keeper key that can only set policy on the bank
if (!st.dao.newChair) {
  st.dao.newChair = process.env.NEW_CHAIR ?? (await helperAccount("lemonhawk")).accountId;
  writeState(st);
}
const newChair = st.dao.newChair;
if (!st.dao.newChairKeyTx) {
  const kp = KeyPair.fromRandom("ed25519");
  saveKey(newChair, kp.toString(), kp.getPublicKey().toString(), st.policyLabel ?? "policy");
  const r = await sendTx(account(newChair), newChair, [actions.addFunctionCallAccessKey(kp.getPublicKey(), st.contract, CHAIR_METHODS, NEAR / 4n)], "new chair key");
  st.dao.newChairKeyTx = r.hash; writeState(st);
}
log("new chair", newChair);

// 4. the impeachment proposal
const signer = st.chairSigner;
const prompt = createHash("sha256").update(chairSystemPrompt(persona)).digest("hex");
const kind = { FunctionCall: { receiver_id: st.contract, actions: [
  { method_name: "set_chair", args: b64({ chair_id: newChair }), deposit: "0", gas: String(30n * TGAS) },
  { method_name: "set_chair_signer", args: b64({ signer, model, prompt_sha256: prompt }), deposit: "0", gas: String(30n * TGAS) },
] } };
if (st.dao.proposalId === undefined) {
  const before = await view(bank, dao, "get_last_proposal_id");
  const description = `Impeach the chair ${s.chair}: it called a collapsing bank "robust". Appoint ${newChair} (${persona}) and pin its system prompt ${prompt.slice(0, 12)}…`;
  const r = await sendTx(account(council[0]), dao, [fc("add_proposal", { proposal: { description, kind } }, 100n, bond)], "add_proposal");
  st.dao.proposalId = before; st.dao.proposalTx = r.hash; writeState(st);
}
const id = st.dao.proposalId;
log("proposal", id);

// 5. the votes
st.dao.votes ??= [];
for (const voter of council.slice(0, 2)) {
  const p = await view(bank, dao, "get_proposal", { id });
  if (p.status !== "InProgress") break;
  if (p.votes?.[voter]) continue;
  try {
    const r = await sendTx(account(voter), dao, [fc("act_proposal", { id, action: "VoteApprove", proposal: kind }, 250n)], `${voter} votes`);
    st.dao.votes.push({ voter, tx: r.hash }); writeState(st);
    log("vote", `${voter} ${r.hash}`);
  } catch (e) { throw new Error(`vote by ${voter} failed${e.hash ? ` (tx ${e.hash})` : ""}: ${failureText(e)}`); }
}
const p = await view(bank, dao, "get_proposal", { id });
s = await view(bank, st.contract, "get_state");
log("proposal status", p.status);
log("bank", `owner ${s.owner}, chair ${s.chair}, prompt ${s.chair_prompt_sha256}`);
if (s.chair === newChair && s.chair_prompt_sha256 === prompt) {
  st.oldChairs = [...new Set([...(st.oldChairs ?? []), st.chair])];
  st.chair = newChair; st.chairPrompt = prompt; st.chairPersona = persona;
  writeState(st);
  log("impeached", `the keeper now acts for ${newChair} (PERSONA=${persona})`);
}
