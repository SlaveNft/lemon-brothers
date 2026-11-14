/**
 * AI depositors on NEAR AI Cloud: in a live town a few of the sixty depositors are driven by a language model
 * instead of their rule. Each gets what a depositor can see (`depositorPrompt` in @chair/sim), answers with one
 * move and a reason, and the simulation applies it through the same bank functions as everybody else.
 *
 * Cost rules, as for the chair: one small completion per depositor per epoch, never a retry, and the same
 * NEAR_AI_MAX_CALLS budget for the whole process. A depositor whose model does not answer (no key, budget spent,
 * network, unusable JSON) acts by its own rule that epoch, and its record says so: nothing is invented.
 */
import { canonicalJson, depositorPrompt, parseMindMove, ruleMove, type ChairDecision, type MindMove, type World } from "@chair/sim";
import { configFromEnv, spendCall, type ChairConfig } from "./nearai";

export function depositorRequestBody(system: string, user: string, model: string): string {
  return canonicalJson({
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.7,
    max_tokens: 160,
    response_format: { type: "json_object" },
    chat_template_kwargs: { enable_thinking: false },
  });
}

/** One depositor's move for this epoch, from the model or (when it cannot answer) from the depositor's rule. */
export async function askDepositor(w: World, i: number, chair: ChairDecision, cfg: ChairConfig = configFromEnv()): Promise<MindMove> {
  const rule = (reason: string) => ruleMove(w, i, cfg.model, reason);
  if (!cfg.apiKey) return rule("no NEAR_AI_API_KEY: the depositor's own rule decided");
  if (!spendCall(cfg.maxCalls)) return rule(`NEAR_AI_MAX_CALLS (${cfg.maxCalls}) reached: the depositor's own rule decided`);
  const { system, user } = depositorPrompt(w, i, chair);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: depositorRequestBody(system, user, cfg.model), signal: ctl.signal,
    });
    const body = await r.text();
    if (r.status !== 200) return rule(`NEAR AI answered ${r.status}: the depositor's own rule decided`);
    let content = "";
    try { content = JSON.parse(body).choices?.[0]?.message?.content ?? ""; } catch { return rule("NEAR AI response is not JSON: the depositor's own rule decided"); }
    const move = parseMindMove(content);
    if (typeof move === "string") return rule(`model answer unusable (${move}): the depositor's own rule decided`);
    return { ...move, model: cfg.model, source: "model" };
  } catch (e) {
    return rule(`NEAR AI unreachable (${(e as Error).message}): the depositor's own rule decided`);
  } finally { clearTimeout(t); }
}

/** The moves of the AI depositors `who` (indexes into the town), asked in parallel; keyed by agent id for `stepEpoch`. */
export async function askDepositors(w: World, who: number[], chair: ChairDecision, cfg: ChairConfig = configFromEnv()): Promise<Map<string, MindMove>> {
  const moves = await Promise.all(who.map((i) => askDepositor(w, i, chair, cfg)));
  return new Map(who.map((i, k) => [w.agents[i].id, moves[k]]));
}

/** Which depositors get a mind: `n` of them spread over the town, so they are neither neighbours nor namesakes. */
export function pickDepositors(n: number, town: number): number[] {
  const k = Math.max(0, Math.min(Math.floor(n), town)), out: number[] = [];
  for (let j = 0; j < k; j++) { let i = (Math.floor(((j + 0.5) * town) / k) + j * 7) % town; while (out.includes(i)) i = (i + 1) % town; out.push(i); }
  return out;
}
