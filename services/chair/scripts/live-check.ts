/**
 * One live chair decision on NEAR AI: the answer, its TEE signature checked like the contract does, and whether the
 * signed answer names the current epoch (so it cannot be replayed later).
 *   NEAR_AI_API_KEY=... npx tsx services/chair/scripts/live-check.ts
 */
import { createWorld, observe, stepEpoch } from "@chair/sim";
import { askChair, configFromEnv } from "../src/nearai";
import { checkProof } from "../src/proof";

const w = createWorld(7, "dove");
stepEpoch(w); stepEpoch(w); // move off epoch 0 so the epoch check means something
const obs = observe(w);
const ans = await askChair(obs, "dove", configFromEnv());
console.log(`source ${ans.source}${ans.fallbackReason ? ` (${ans.fallbackReason})` : ""}`);
console.log(`decision rate=${ans.decision.rate} target=${ans.decision.target} mint=${ans.decision.mint} tone=${ans.decision.tone}`);
console.log(`statement: ${ans.decision.statement}`);
if (ans.proof) {
  const content = JSON.parse(ans.proof.responseBody).choices[0].message.content as string;
  const named = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).epoch_id;
  console.log(`signed answer names epoch_id ${named}; bank is at ${obs.epochId} -> ${named === obs.epochId ? "bound" : "NOT bound"}`);
  const problems = checkProof(ans.proof, "89fb781a9530473a6d3bddd6bb0a0536c8d155058798edae88b19153bd8f4350");
  console.log(problems.length ? `proof problems: ${problems.join("; ")}` : "proof: PASS (pinned model key, exact request/response hashes)");
}
