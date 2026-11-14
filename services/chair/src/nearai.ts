/**
 * The chair on NEAR AI Cloud (OpenAI-compatible API, private inference in a TEE).
 *
 *   NEAR_AI_API_KEY     required for the real model (never committed; read from the environment)
 *   NEAR_AI_MODEL       default Qwen/Qwen3.6-35B-A3B-FP8 (hosted by NEAR AI in a TEE, JSON mode)
 *   NEAR_AI_BASE_URL    default https://cloud-api.near.ai/v1
 *   NEAR_AI_MAX_CALLS   paid completions this process may make, default 30; past it the chair falls back
 *
 * Cost rules: one completion per decision and never a retry (a failed or unusable answer falls back to the
 * deterministic persona chair and says why); `max_tokens` is small; thinking is off. Only the signature lookup, which
 * is free, is retried.
 */
import { canonicalJson, chairPrompt, fallbackChair, parseDecision, type ChairDecision, type Observation, type Persona } from "@chair/sim";
import { checkProof, type ChairProof, type ResponseSignature } from "./proof";

export interface ChairConfig { apiKey?: string; model: string; baseUrl: string; timeoutMs: number; maxCalls: number }

/** A positive number from the environment, else the default (a typo must not lift the cap). */
const positive = (v: string | undefined, d: number) => { const x = Number(v); return v !== undefined && v !== "" && Number.isFinite(x) && x > 0 ? x : d; };

export function configFromEnv(env: Record<string, string | undefined> = process.env): ChairConfig {
  return {
    apiKey: env.NEAR_AI_API_KEY || undefined,
    model: env.NEAR_AI_MODEL || "Qwen/Qwen3.6-35B-A3B-FP8",
    baseUrl: (env.NEAR_AI_BASE_URL || "https://cloud-api.near.ai/v1").replace(/\/$/, ""),
    timeoutMs: positive(env.NEAR_AI_TIMEOUT_MS, 25_000),
    maxCalls: positive(env.NEAR_AI_MAX_CALLS, 30),
  };
}

export interface ChairAnswer {
  decision: ChairDecision;
  source: "near-ai" | "fallback";
  /** Why the model answer was not used (network, bad JSON...), when source is fallback after trying. */
  fallbackReason?: string;
  proof?: ChairProof;
  /** Problems found when checking the proof locally; empty = the contract will accept the signature. */
  proofProblems?: string[];
  chatId?: string;
}

/** Paid completions made by this process (all calls to askChair share it). */
let paidCalls = 0;
export const nearAiCallsMade = () => paidCalls;
/** Take one paid completion out of this process's budget (shared by the chair and the AI depositors); false = spent. */
export function spendCall(maxCalls: number): boolean { if (paidCalls >= maxCalls) return false; paidCalls++; return true; }

async function http(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    return { status: r.status, body: await r.text() };
  } finally { clearTimeout(t); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The exact request body for one decision: canonical JSON (sorted keys, no whitespace), because the contract
 *  re-hashes these bytes and accepts only this set of fields with these decoding settings. */
export function chairRequestBody(obs: Observation, persona: Persona, model: string, systemOverride?: string): string {
  const { system: personaSystem, user } = chairPrompt(obs, persona);
  // a DAO may pin any system prompt (the contract checks only its sha256); the observation stays the same
  const system = systemOverride ?? personaSystem;
  return canonicalJson({
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.4,
    // the JSON answer is ~150-250 tokens (statement <= 280 chars, reasoning <= 300)
    max_tokens: 450,
    response_format: { type: "json_object" },
    // Qwen3 thinks by default; reasoning eats max_tokens (empty answers) and adds seconds. Keep it off.
    chat_template_kwargs: { enable_thinking: false },
  });
}

export async function askChair(obs: Observation, persona: Persona, cfg = configFromEnv(), systemOverride?: string): Promise<ChairAnswer> {
  const fallback = (fallbackReason: string, chatId?: string): ChairAnswer => ({ decision: fallbackChair(obs, persona), source: "fallback", fallbackReason, chatId });
  if (!cfg.apiKey) return fallback("NEAR_AI_API_KEY not set");
  if (paidCalls >= cfg.maxCalls) return fallback(`NEAR_AI_MAX_CALLS (${cfg.maxCalls}) reached in this process`);
  const requestBody = chairRequestBody(obs, persona, cfg.model, systemOverride);
  const headers = { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" };
  paidCalls++;
  let res;
  try { res = await http(`${cfg.baseUrl}/chat/completions`, { method: "POST", headers, body: requestBody }, cfg.timeoutMs); }
  catch (e) { return fallback(`NEAR AI unreachable: ${(e as Error).message}`); }
  if (res.status !== 200) return fallback(`NEAR AI answered ${res.status}: ${res.body.slice(0, 200)}`);

  let chatId = "", content = "";
  try {
    const j = JSON.parse(res.body);
    chatId = typeof j.id === "string" ? j.id : ""; content = j.choices?.[0]?.message?.content ?? "";
  } catch { return fallback("NEAR AI response is not JSON"); }
  if (!chatId) return fallback("NEAR AI response has no completion id, so it cannot be signed");
  const parsed = parseDecision(content);
  if (typeof parsed === "string") return fallback(`model answer unusable: ${parsed}`, chatId);

  // the TEE signature over the exact request and response bytes: free to fetch, so a few tries (it can lag the answer)
  let proof: ChairProof | undefined;
  const proofProblems: string[] = [];
  const q = new URLSearchParams({ model: cfg.model, signing_algo: "ed25519" });
  for (let i = 1; i <= 3 && !proof; i++) {
    try {
      const s = await http(`${cfg.baseUrl}/signature/${encodeURIComponent(chatId)}?${q}`, { headers }, 8_000);
      if (s.status === 200) proof = { model: cfg.model, requestBody, responseBody: res.body, sig: JSON.parse(s.body) as ResponseSignature };
      else if (i === 3) proofProblems.push(`signature endpoint answered ${s.status}`);
    } catch (e) { if (i === 3) proofProblems.push(`signature fetch failed: ${(e as Error).message}`); }
    if (!proof && i < 3) await sleep(1000 * i);
  }
  if (proof) proofProblems.push(...checkProof(proof));
  if (parsed.epochId !== obs.epochId) proofProblems.push(`answer names epoch ${parsed.epochId ?? "none"}, the bank is in epoch ${obs.epochId}; the contract would refuse it`);

  return { decision: parsed, source: "near-ai", proof, proofProblems, chatId };
}
