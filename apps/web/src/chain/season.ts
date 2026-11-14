/**
 * The real bank's round as a season: which round and day it is, and who holds the most $LEMON in it, read from the
 * contract (`get_state`, `get_depositors`). Pure functions; the card that shows them is Round.tsx.
 */
import type { ChainState } from "./rpc";

/** Bank days in a round (bank-core `EPOCHS_PER_ROUND`). */
export const DAYS_PER_ROUND = 10;

export interface RoundInfo {
  /** Round number as people count, from 1. */
  round: number;
  /** Day of the round, 1..10. */
  day: number;
  /** Bank days left after today in this round. */
  left: number;
  collapsed: boolean;
  /** The chair's credibility, 0..1000, as the contract keeps it; null on a bank that does not report it. */
  trust: number | null;
}

export function roundInfo(s: ChainState): RoundInfo {
  const day = Math.min(DAYS_PER_ROUND, s.epoch + 1);
  const trust = typeof s.credibility === "number" && Number.isFinite(s.credibility) ? Math.max(0, Math.min(1000, s.credibility)) : null;
  return { round: s.round + 1, day, left: DAYS_PER_ROUND - day, collapsed: s.collapsed, trust };
}

/** One row of `get_depositors`: account, wallet, deposit value, what a past collapse still owes it. */
export type DepositorRow = [string, string, string, string];

export type HolderKind = "you" | "agent" | "player";
export interface Holder { id: string; kind: HolderKind; wallet: bigint; deposit: bigint; total: bigint }
export interface Board { top: Holder[]; you: { rank: number; holder: Holder } | null; players: number }

const amount = (x: unknown): bigint => (typeof x === "string" && /^\d{1,39}$/.test(x) ? BigInt(x) : 0n);

/**
 * Everyone who holds LEMON at the bank, ranked by what they hold (wallet + deposit + what a collapse still owes them),
 * the larger first, ties by name. Left out: the contract's own account and the crowd omnibus (`crowd.<bank>`, the
 * simulated rest of the town, not a player). The bank's agents (`agent-NN.<bank>`) play too and are marked.
 */
export function rankHolders(rows: readonly DepositorRow[], contract: string, you: string | null, topN = 10): Board {
  const holders: Holder[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || typeof r[0] !== "string") continue;
    const id = r[0];
    if (id === contract || id === `crowd.${contract}`) continue;
    const wallet = amount(r[1]) + amount(r[3]), deposit = amount(r[2]);
    const total = wallet + deposit;
    if (total === 0n && id !== you) continue;
    const kind: HolderKind = id === you ? "you" : id.endsWith(`.${contract}`) && /^agent-\d+\./.test(id) ? "agent" : "player";
    holders.push({ id, kind, wallet, deposit, total });
  }
  holders.sort((a, b) => (a.total === b.total ? (a.id < b.id ? -1 : 1) : a.total > b.total ? -1 : 1));
  const at = you === null ? -1 : holders.findIndex((h) => h.id === you);
  return { top: holders.slice(0, topN), you: at < 0 ? null : { rank: at + 1, holder: holders[at] }, players: holders.length };
}
