/**
 * Shape check of what `get_state` returned, before anything is rendered from it. `?contract=` and `?rpc=` let the
 * page read any account through any endpoint, so the answer is not trusted to look like the Lemon Brothers bank.
 */
import type { ChainState } from "./rpc";

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
/** An amount as the contract writes it: a string of digits (u128), or a plain non-negative number. */
const isAmount = (v: unknown) => (typeof v === "string" && /^\d{1,39}$/.test(v)) || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const isCount = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const optString = (v: unknown) => v === undefined || v === null || typeof v === "string";

/** Null if `v` is a bank state the panel can draw; otherwise what is wrong with it (first problem found). */
export function chainStateProblem(v: unknown): string | null {
  if (!isObj(v)) return "get_state did not return an object";
  for (const k of ["supply", "reserve", "loans", "liabilities", "reserve_permille", "minted_this_round", "round_start_supply", "outflow"]) {
    if (!isAmount(v[k])) return `field ${k} is not an amount`;
  }
  for (const k of ["epoch", "round", "epoch_id", "next_epoch_ms"]) if (!isCount(v[k])) return `field ${k} is not a number`;
  // -1 until the chair first speaks in some builds; any finite number is fine to show
  if (typeof v.policy_set_epoch_id !== "number" || !Number.isFinite(v.policy_set_epoch_id)) return "field policy_set_epoch_id is not a number";
  if (typeof v.collapsed !== "boolean") return "field collapsed is not true/false";
  for (const k of ["chair", "owner"]) if (typeof v[k] !== "string") return `field ${k} is not an account name`;
  if (!optString(v.chair_signer) || !optString(v.chair_model) || !optString(v.chair_prompt_sha256)) return "the chair's pinned key, model or prompt is not text";
  const p = v.policy;
  if (!isObj(p)) return "field policy is not an object";
  for (const k of ["rate", "target", "mint", "gate"]) if (!isAmount(p[k])) return `policy.${k} is not an amount`;
  for (const k of ["tone", "statement", "attestation"]) if (typeof p[k] !== "string") return `policy.${k} is not text`;
  if (!Array.isArray(v.speeches) || !v.speeches.every((x) => isObj(x) && typeof x.who === "string" && typeof x.text === "string")) return "field speeches is not a list of {who, text}";
  if (!Array.isArray(v.rumors) || !v.rumors.every((x) => isObj(x) && typeof x.who === "string" && typeof x.kind === "string")) return "field rumors is not a list of {who, kind}";
  return null;
}

/** `v` as a bank state, or throw with the reason. */
export function asChainState(v: unknown): ChainState {
  const problem = chainStateProblem(v);
  if (problem) throw new Error(`not a Lemon Brothers bank: ${problem}`);
  return v as ChainState;
}
