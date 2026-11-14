/**
 * A JSON-safe picture of the world for the UI (numbers instead of BigInt). The browser builds it from its own
 * simulation; the runner sends the same shape over HTTP.
 */
import { insuredNow, liabilities, reserveRatio, valueOf } from "./bank";
import { PERSONAS, type Persona } from "./chair";
import type { Press, Snapshot, World } from "./world";
import { AGENT, BANK } from "./rules";
import { speechStance } from "./agents";

export interface AgentView {
  id: string; name: string; panic: number; threshold: number; deposit: number; wallet: number;
  ranAt: number; why: Array<{ why: string; delta: number }>; friends: number[];
  /** present when an outside mind decides for this depositor: its latest move and reason */
  mind?: import("./minds").AgentMind;
}
export interface PlayerView { id: string; wallet: number; deposit: number; insured: number }
export interface WorldView {
  seed: number; round: number; epoch: number; epochId: number; epochsPerRound: number; collapsed: boolean;
  supply: number; reserve: number; loans: number; liabilities: number; reservePermille: number;
  policy: { rate: number; target: number; gate: number; tone: string; statement: string; attestation: string };
  persona: Persona; personaTitle: string; credibility: number;
  press: Array<Press & { decision: Press["decision"] }>;
  history: Snapshot[];
  agents: AgentView[];
  players: PlayerView[];
  /** This epoch's speeches; `stance` and `weight` (0..1, from the speaker's deposit) are how the town hears them. */
  speeches: Array<{ who: string; text: string; stance: "calm" | "alarm" | null; weight: number; insured: boolean }>;
  rumors: Array<{ who: string; kind: string }>;
  roundsSurvived: number; roundsFallen: number;
  /** Most recent bank events, newest last, as short strings. */
  feed: string[];
  chairMode: string;
  nextTickMs: number | null;
  /** Length of an epoch on the clock that drives this town (ms); null when it is paused or unknown. */
  epochMs: number | null;
}

const num = (x: bigint) => Number(x);

export function view(w: World, opts: { players?: string[]; chairMode?: string; nextTickMs?: number | null; epochMs?: number | null } = {}): WorldView {
  const b = w.bank;
  const agentIds = new Set(w.agents.map((a) => a.id));
  const players = (opts.players ?? [...b.accounts.keys()].filter((id) => !agentIds.has(id))).map((id) => {
    const a = b.accounts.get(id);
    return { id, wallet: a ? num(a.wallet) : 0, deposit: num(valueOf(b, id)), insured: num(insuredNow(b, id)) };
  });
  const ends = b.events.filter((e) => e.t === "round_end") as Array<{ t: "round_end"; survived: boolean }>;
  return {
    seed: w.seed, round: b.round, epoch: b.epoch, epochId: b.epochId, epochsPerRound: BANK.epochsPerRound, collapsed: b.collapsed,
    supply: num(b.supply), reserve: num(b.reserve), loans: num(b.loans), liabilities: num(liabilities(b)), reservePermille: num(reserveRatio(b)),
    policy: { rate: num(b.policy.rate), target: num(b.policy.target), gate: num(b.policy.gate), tone: b.policy.tone, statement: b.policy.statement, attestation: b.policy.attestation },
    persona: w.persona, personaTitle: PERSONAS[w.persona].title, credibility: w.credibility,
    press: w.press.slice(-30),
    history: w.history.slice(-120),
    agents: w.agents.map((a) => {
      const acc = b.accounts.get(a.id);
      return { id: a.id, name: a.name, panic: a.panic, threshold: a.threshold, deposit: num(valueOf(b, a.id)), wallet: acc ? num(acc.wallet) : 0, ranAt: a.ranAt, why: a.why.slice(0, 4), friends: a.friends, ...(a.mind ? { mind: a.mind } : {}) };
    }),
    players,
    speeches: b.speeches.filter((s) => s.epochId === b.epochId).map((s) => ({
      who: s.who, text: s.text, stance: speechStance(s.text),
      weight: Math.min(1, num(valueOf(b, s.who)) / AGENT.speechStakeFull), insured: insuredNow(b, s.who) > 0n,
    })),
    rumors: b.rumors.filter((r) => r.epochId === b.epochId).map((r) => ({ who: r.who, kind: r.kind })),
    roundsSurvived: ends.filter((e) => e.survived).length, roundsFallen: ends.filter((e) => !e.survived).length,
    feed: feedLines(b.events, agentIds),
    chairMode: opts.chairMode ?? "fallback",
    nextTickMs: opts.nextTickMs ?? null,
    epochMs: opts.epochMs ?? null,
  };
}

/** How many lines the feed keeps. */
export const FEED_MAX = 80;

/**
 * The feed: the last `FEED_MAX` events that have something to say. Events without a line (per-account settlements,
 * policy and epoch bookkeeping) are dropped before the cut, so they cannot push a round's outcome out of view. The
 * savers' deposits when a round opens (60 at once) become one summary line.
 */
export function feedLines(events: World["bank"]["events"], agentIds: ReadonlySet<string>, max: number = FEED_MAX): string[] {
  const out: string[] = [];
  // a round opens at the very start and right after an `epoch` event with epoch 0; the agents' deposits that follow
  // (before anything else happens) are the Monday crowd
  let opening = true, n = 0, sum = 0n;
  const flush = () => { if (n > 0) out.push(`Round opens: ${n} saver${n > 1 ? "s" : ""} deposited ${sum}`); n = 0; sum = 0n; };
  for (const e of events) {
    if (opening && e.t === "deposit" && agentIds.has(e.who)) { n++; sum += e.amount; continue; }
    flush();
    opening = e.t === "epoch" && e.epoch === 0;
    const line = describe(e);
    if (line) out.push(line);
  }
  flush();
  return out.slice(-max);
}

const OUTCOME = /^(Round over: the bank survived|COLLAPSE:)/;

/**
 * The newest `n` feed lines for a short list. If the latest round outcome ("Round over…" / "COLLAPSE…") is older than
 * that, it takes the oldest slot, so a fast-forward through a busy stretch still shows how the round ended.
 */
export function feedTail(feed: string[], n: number): string[] {
  const tail = feed.slice(-n);
  if (tail.some((l) => OUTCOME.test(l))) return tail;
  const last = [...feed].reverse().find((l) => OUTCOME.test(l));
  return last ? [last, ...tail.slice(1)] : tail;
}

function describe(e: World["bank"]["events"][number]): string | null {
  switch (e.t) {
    case "withdraw": return `${e.who} withdrew ${e.amount}${e.fireSold ? ` (fire sale, ${e.burned} lost)` : ""}`;
    case "deposit": return `${e.who} deposited ${e.amount}`;
    case "collapse": return `COLLAPSE: ${e.who}'s withdrawal broke the bank (assets ${e.assets} vs owed ${e.liabilities})`;
    case "insurance_payout": return `${e.who} cashed insurance: ${e.amount}`;
    case "lobby": return `${e.who} lobbied: "${e.text}"`;
    case "rumor": return `${e.who} spread a rumour: ${e.kind.replace(/_/g, " ")}`;
    case "insure": return `${e.who} insured against collapse: ${e.premium}`;
    case "writedown": return `Lemon Brothers wrote off ${(Number(e.permille) / 10).toFixed(1)}% of its loans (${e.amount})`;
    case "bailout": return `Bailout: ${e.minted} LEMON printed, the bank reopens`;
    case "round_end": return e.survived ? "Round over: the bank survived" : null;
    default: return null;
  }
}
