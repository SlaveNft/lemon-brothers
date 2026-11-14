/**
 * Pure checks for the runner: what a POST body may carry, how the environment is read, which origins may call the
 * API, and when a chair answer earns its `ed25519:…` attestation. No I/O here, so all of it is unit-tested.
 */
import { RUMORS, type Persona, type PlayerAction, type RumorKind } from "@chair/sim";
import type { ChairAnswer } from "@chair/chair";

export const PERSONA_IDS = ["dove", "hawk", "populist"] as const satisfies readonly Persona[];
/** The page's dev origins (vite on 5190); nothing else gets CORS headers. */
export const ALLOWED_ORIGINS: readonly string[] = ["http://127.0.0.1:5190", "http://localhost:5190"];
/** Far above anything a player can hold, far below where a Number stops being exact. */
export const MAX_AMOUNT = 1_000_000_000_000;
export const MAX_FF = 100;
export const MAX_TEXT_CHARS = 280;
const ID = /^[a-z0-9_-]{2,32}$/;
const RESERVED = (who: string) => who.startsWith("agent-") || who === "chair" || who === "holders-dao";
const ACTS = ["deposit", "withdraw", "withdrawAll", "lobby", "rumor", "insure"] as const;

export type ApiRequest =
  | { route: "join"; who: string }
  | { route: "act"; action: PlayerAction }
  | { route: "impeach"; who: string; persona: Persona; vote: boolean }
  | { route: "ff"; epochs: number };
export type Checked = { ok: ApiRequest } | { status: 400 | 404; error: string };

const bad = (error: string, status: 400 | 404 = 400): Checked => ({ status, error });
const isAmount = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 1 && x <= MAX_AMOUNT;
const amountError = (field: string) => `${field}: a whole number from 1 to ${MAX_AMOUNT}`;

/** Check a POST: the route, then every field the route reads. Unknown fields are dropped, never passed on. */
export function checkRequest(path: string, body: unknown): Checked {
  if (!["/api/join", "/api/act", "/api/impeach", "/api/ff"].includes(path)) return bad("not found", 404);
  if (body === null || typeof body !== "object" || Array.isArray(body)) return bad("body must be a JSON object");
  const b = body as Record<string, unknown>;

  if (path === "/api/ff") {
    if (b.epochs === undefined) return { ok: { route: "ff", epochs: 10 } };
    if (typeof b.epochs !== "number" || !Number.isInteger(b.epochs) || b.epochs < 1 || b.epochs > MAX_FF) return bad(`epochs: a whole number from 1 to ${MAX_FF}`);
    return { ok: { route: "ff", epochs: b.epochs } };
  }

  if (typeof b.who !== "string") return bad("who: the player's name (a string)");
  const who = b.who.toLowerCase();
  if (!ID.test(who)) return bad("name: 2-32 letters, digits, - or _");
  if (RESERVED(who)) return bad("that name is taken");

  if (path === "/api/join") return { ok: { route: "join", who } };

  if (path === "/api/impeach") {
    if (typeof b.persona !== "string" || !(PERSONA_IDS as readonly string[]).includes(b.persona)) return bad(`persona: one of ${PERSONA_IDS.join(", ")}`);
    if (b.vote !== undefined && typeof b.vote !== "boolean") return bad("vote: true or false");
    return { ok: { route: "impeach", who, persona: b.persona as Persona, vote: b.vote !== false } };
  }

  // /api/act
  const t = b.t;
  if (typeof t !== "string" || !(ACTS as readonly string[]).includes(t)) return bad(`unknown action ${JSON.stringify(t) ?? "(none)"}: t must be one of ${ACTS.join(", ")}`);
  switch (t as (typeof ACTS)[number]) {
    case "deposit": return isAmount(b.amount) ? { ok: { route: "act", action: { t: "deposit", who, amount: b.amount } } } : bad(amountError("amount"));
    case "withdraw": return isAmount(b.amount) ? { ok: { route: "act", action: { t: "withdraw", who, amount: b.amount } } } : bad(amountError("amount"));
    case "insure": return isAmount(b.premium) ? { ok: { route: "act", action: { t: "insure", who, premium: b.premium } } } : bad(amountError("premium"));
    case "withdrawAll": return { ok: { route: "act", action: { t: "withdrawAll", who } } };
    case "lobby": {
      if (typeof b.text !== "string") return bad("text: the speech (a string)");
      const text = b.text.trim();
      if (!text || text.length > MAX_TEXT_CHARS) return bad(`text: 1 to ${MAX_TEXT_CHARS} characters`);
      return { ok: { route: "act", action: { t: "lobby", who, text } } };
    }
    case "rumor":
      if (typeof b.kind !== "string" || !(RUMORS as readonly string[]).includes(b.kind)) return bad(`kind: one of ${RUMORS.join(", ")}`);
      return { ok: { route: "act", action: { t: "rumor", who, kind: b.kind as RumorKind } } };
  }
}

/** `application/json`, with or without parameters. */
export const isJsonContentType = (h: string | string[] | undefined): boolean =>
  typeof h === "string" && h.split(";")[0].trim().toLowerCase() === "application/json";

/** CORS headers for this request: only for the dev origins; any other origin gets none (the browser then blocks it). */
export function corsHeaders(origin: string | string[] | undefined): Record<string, string> {
  if (typeof origin !== "string" || !ALLOWED_ORIGINS.includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" };
}

export interface RunnerEnv { port: number; epochMs: number; seed: number; persona: Persona; warnings: string[] }

/** PORT, EPOCH_SECONDS, SEED and PERSONA; an invalid value falls back to the default and says so. */
export function readEnv(env: Record<string, string | undefined>, randomSeed: () => number = () => Math.floor(Math.random() * 1e9)): RunnerEnv {
  const warnings: string[] = [];
  const number = (name: string, d: number, ok: (x: number) => boolean, rule: string): number => {
    const raw = env[name];
    if (raw === undefined || raw === "") return d;
    const x = Number(raw);
    if (Number.isFinite(x) && ok(x)) return x;
    warnings.push(`${name}=${JSON.stringify(raw)} is not ${rule}; using ${d}`);
    return d;
  };
  const port = number("PORT", 8797, (x) => Number.isInteger(x) && x >= 1 && x <= 65535, "a port number");
  const seconds = number("EPOCH_SECONDS", 30, (x) => x >= 1 && x <= 3600, "a number of seconds from 1 to 3600");
  const seed = number("SEED", randomSeed(), (x) => Number.isInteger(x) && x >= 1 && x <= 0xffffffff, "a whole number from 1 to 4294967295");
  let persona: Persona = "dove";
  const p = env.PERSONA;
  if (p !== undefined && p !== "") {
    if ((PERSONA_IDS as readonly string[]).includes(p)) persona = p as Persona;
    else warnings.push(`PERSONA=${JSON.stringify(p)} is not one of ${PERSONA_IDS.join(", ")}; using dove`);
  }
  return { port, epochMs: seconds * 1000, seed, persona, warnings };
}

/**
 * The attestation a policy may carry. A model answer gets `ed25519:<first 64 hex of the signature>` (the form the
 * contract writes) only if its signature was fetched, every local check passed, and the answer names the epoch being
 * decided. Anything else is applied unsigned, with the reasons, so the UI can say "signature not verified".
 */
export function attestationFor(ans: Pick<ChairAnswer, "source" | "decision" | "proof" | "proofProblems"> | null, epochId: number): { attestation: string; unverified: string[] } {
  if (!ans || ans.source !== "near-ai") return { attestation: "", unverified: [] };
  const problems = [...(ans.proofProblems ?? [])];
  const sig = ans.proof?.sig?.signature;
  const hex = typeof sig === "string" ? sig.replace(/^0x/i, "").toLowerCase() : "";
  if (!ans.proof) { if (!problems.length) problems.push("no signature was returned for this answer"); }
  else if (!/^[0-9a-f]{128}$/.test(hex)) problems.push("signature is not 64 bytes of hex");
  if (ans.decision.epochId !== epochId && !problems.some((p) => p.startsWith("answer names epoch"))) {
    problems.push(`answer names epoch ${ans.decision.epochId ?? "none"}, the bank is in epoch ${epochId}`);
  }
  return problems.length ? { attestation: "", unverified: [...new Set(problems)] } : { attestation: `ed25519:${hex.slice(0, 64)}`, unverified: [] };
}

/** The line the UI shows about who is in the chair. */
export function chairModeText(o: { hasKey: boolean; model: string; fellBack?: string | null; unverified?: string[]; tickError?: string | null }): string {
  let s = o.hasKey ? `near-ai:${o.model}` : "fallback (no NEAR_AI_API_KEY)";
  if (o.hasKey && o.fellBack) s += ` (fell back: ${o.fellBack})`;
  else if (o.unverified?.length) s += ` · signature not verified: ${o.unverified.join("; ")}`;
  if (o.tickError) s += ` · last epoch failed: ${o.tickError}`;
  return s;
}
