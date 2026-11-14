/**
 * One town: the bank, the depositor agents, the chair and the players. `stepEpoch` is the whole game tick:
 *
 *   1. players act (lobby, rumour, insure, deposit, withdraw)
 *   2. the chair reads the observation and sets policy; the bank's bounds may reject it
 *   3. agents update panic from what they saw and act in a seeded order
 *   4. the epoch advances (or, after a collapse, the bailout opens the next round)
 *
 * Same seed + same player actions + same chair answers = same world, so a round can be fast-forwarded, replayed and
 * compared with the contract.
 */
import type { MindMove } from "./minds";
import { Rng } from "./rng";
import { AGENT, BANK, type RumorKind } from "./rules";
import {
  acct, advanceEpoch, deposit, insure, insuredNow, liabilities, lobby, mintRoom as roomToCeiling, newBank, reserveRatio, rumor, setPolicy, valueOf, withdraw, withdrawAll,
  type Bank, type PolicyInput,
} from "./bank";
import { actOrder, coolDown, createAgents, decide, speechStance, updatePanic, type Agent, type HeardSpeech, type News } from "./agents";
import { fallbackChair, type ChairDecision, type Observation, type Persona } from "./chair";

export type PlayerAction =
  | { t: "deposit"; who: string; amount: number }
  | { t: "withdraw"; who: string; amount: number }
  | { t: "withdrawAll"; who: string }
  | { t: "lobby"; who: string; text: string }
  | { t: "rumor"; who: string; kind: RumorKind }
  | { t: "insure"; who: string; premium: number };

export interface Press {
  epochId: number; round: number; epoch: number;
  decision: ChairDecision;
  /** Contract verdict: null if accepted, otherwise why it was rejected (the policy did not change). */
  rejected: string | null;
  persona: Persona;
}

export interface Snapshot {
  epochId: number; round: number; epoch: number;
  reserve: number; loans: number; liabilities: number; supply: number;
  rate: number; target: number; gate: number;
  avgPanic: number; ran: number; deposited: number; collapsed: boolean;
}

export interface World {
  seed: number;
  rng: Rng;
  bank: Bank;
  agents: Agent[];
  persona: Persona;
  credibility: number;
  /** Last epoch's outflow, permille of liabilities, as the agents and the chair see it. */
  lastOutflowPermille: number;
  /** Loan write-off at the end of last epoch, permille of the loan book (news the town reads). */
  lastWritedownPermille: number;
  press: Press[];
  history: Snapshot[];
  /** Feedback lines for the UI: what each action did. */
  notes: string[];
}

export const CHAIR_ID = "chair";
export const DAO_ID = "holders-dao";

export function createWorld(seed: number, persona: Persona = "dove", players: string[] = []): World {
  const rng = new Rng(seed >>> 0 || 1);
  const agents = createAgents(rng);
  const genesis: Array<[string, bigint]> = agents.map((a) => [a.id, BigInt(500 + rng.int(4501))]);
  const bank = newBank(DAO_ID, CHAIR_ID, genesis);
  for (const p of players) acct(bank, p);
  const w: World = { seed, rng, bank, agents, persona, credibility: AGENT.credibilityStart, lastOutflowPermille: 0, lastWritedownPermille: 0, press: [], history: [], notes: [] };
  openRound(w);
  return w;
}

/** At the start of a round, calm agents put most of their wallet into the bank. */
function openRound(w: World) {
  for (const i of actOrder(w.rng, w.agents.length)) {
    const a = w.agents[i], acc = acct(w.bank, a.id);
    if (acc.wallet > 0n && a.panic < a.threshold) {
      const share = BigInt(600 + w.rng.int(400));
      deposit(w.bank, a.id, (acc.wallet * share) / 1000n);
    }
  }
}

export function observe(w: World): Observation {
  const b = w.bank, l = liabilities(b);
  const mood = w.agents.filter((a) => a.panic > a.threshold / 2).length;
  const supply = Number(b.supply);
  const ceiling = roomToCeiling(b);
  const mintRoom = Math.max(0, Math.min(Math.floor((supply * 50) / 1000), Math.floor((Number(b.roundStartSupply) * 150) / 1000) - Number(b.mintedThisRound), ceiling === null ? Infinity : Number(ceiling)));
  return {
    round: b.round, epoch: b.epoch, epochsPerRound: BANK.epochsPerRound, epochId: b.epochId,
    reserve: Number(b.reserve), loans: Number(b.loans), liabilities: Number(l), supply,
    reservePermille: Number(reserveRatio(b)), outflowPermille: w.lastOutflowPermille,
    moodPermille: Math.round((mood * 1000) / w.agents.length),
    policy: { rate: Number(b.policy.rate), target: Number(b.policy.target), gate: Number(b.policy.gate) },
    mintRoom,
    speeches: b.speeches.filter((s) => s.epochId === b.epochId).map((s) => ({ who: s.who, text: s.text })),
    rumors: b.rumors.filter((r) => r.epochId === b.epochId).map((r) => r.kind),
    credibility: w.credibility,
    writedownPermille: w.lastWritedownPermille,
  };
}

export function applyPlayer(w: World, a: PlayerAction): string | null {
  const b = w.bank;
  switch (a.t) {
    case "deposit": return deposit(b, a.who, BigInt(Math.floor(a.amount)));
    case "withdraw": return withdraw(b, a.who, BigInt(Math.floor(a.amount)));
    case "withdrawAll": return withdrawAll(b, a.who);
    case "lobby": return lobby(b, a.who, a.text);
    case "rumor": return rumor(b, a.who, a.kind);
    case "insure": return insure(b, a.who, BigInt(Math.floor(a.premium)));
  }
}

export const toPolicyInput = (d: ChairDecision, attestation = ""): PolicyInput => ({
  rate: BigInt(d.rate), target: BigInt(d.target), mint: BigInt(d.mint), gate: BigInt(d.gate), tone: d.tone,
  statement: d.statement, attestation,
});

/**
 * One epoch. `decision` lets a real model answer for the chair; without it the persona's fallback answers.
 * `news` is extra public news the town reads this epoch (used by the crisis mode: scripted events, broken promises).
 * Returns the press entry for this epoch (null after a collapse, when the epoch is the bailout).
 */
export function stepEpoch(w: World, actions: PlayerAction[] = [], decision?: ChairDecision, attestation = "", news: News[] = [], minds?: ReadonlyMap<string, MindMove>): Press | null {
  const b = w.bank;
  w.notes = [];
  if (b.collapsed) {
    advanceEpoch(b);
    // runs before the bailout are old news: they must not count as "friends ran" in the new round's first epoch
    coolDown(w.agents, AGENT.bailoutPanicKeepPermille);
    for (const a of w.agents) a.ranAt = -1;
    // the chair failed, but the bailout is a fresh promise backed by new money: the town listens again, a little
    w.credibility = Math.max(AGENT.bailoutCredibility, Math.max(AGENT.credibilityFloor, w.credibility - AGENT.credibilityLiePenalty));
    w.lastOutflowPermille = 0;
    openRound(w);
    record(w, 0, 0);
    return null;
  }

  for (const a of actions) { const err = applyPlayer(w, a); w.notes.push(err ? `${a.t}: ${err}` : `${a.t}: ok`); }

  // the chair speaks
  const before = { ...b.policy };
  const obs = observe(w);
  const d = decision ?? fallbackChair(obs, w.persona);
  const rejected = b.collapsed ? "bank collapsed before the chair spoke" : setPolicy(b, CHAIR_ID, toPolicyInput(d, attestation));
  const press: Press = { epochId: b.epochId, round: b.round, epoch: b.epoch, decision: d, rejected, persona: w.persona };
  w.press.push(press);

  // the town listens: a rejected decision still gets read out, but the policy did not move
  const pol = b.policy;
  updatePanic(w.agents, {
    epochId: b.epochId,
    tone: d.tone,
    credibility: w.credibility,
    rateChange: Number(pol.rate - before.rate),
    gateOn: pol.gate > 0n, gateJustOn: pol.gate > 0n && before.gate === 0n,
    minted: !rejected && d.mint > 0,
    targetRaised: pol.target > before.target,
    outflowPermille: w.lastOutflowPermille,
    reservePermille: Number(reserveRatio(b)),
    rumors: obs.rumors.length,
    writedownPermille: w.lastWritedownPermille,
    cashOnly: new Set(w.agents.flatMap((a, i) => ((b.accounts.get(a.id)?.shares ?? 0n) === 0n ? [i] : []))),
    speeches: heardSpeeches(w),
    news,
  }, w.rng);

  // every outside mind's answer is on record even if the bank falls before its turn comes
  if (minds) for (const a of w.agents) { const m = minds.get(a.id); if (m) a.mind = { ...m, epochId: b.epochId }; }

  let ran = 0, deposited = 0;
  for (const i of actOrder(w.rng, w.agents.length)) {
    if (b.collapsed) break;
    const a = w.agents[i], acc = acct(b, a.id);
    // an outside mind decides in place of the rule (minds.ts); the bank still judges whether the move is possible
    const m = minds?.get(a.id);
    let choice = m ? m.choice : decide(a, Number(pol.rate), acc.wallet > 0n, acc.shares > 0n);
    if (m) {
      // a move the depositor cannot make is a hold, and its record says what was wanted
      const cannot = choice === "run" && acc.shares === 0n ? "wanted to run, but has nothing left in the bank" : choice === "deposit" && acc.wallet === 0n ? "wanted to deposit, but the wallet is empty" : "";
      if (cannot) choice = "hold";
      a.mind = { ...m, choice, why: cannot ? `${m.why} (${cannot})` : m.why, epochId: b.epochId };
      a.log.push(`E${b.epochId}: ${m.source === "model" ? "AI" : "rule"} chose to ${choice}${m.why ? `: ${m.why}` : ""}`);
    }
    if (!m && choice !== "run" && acc.shares > 0n && w.rng.chance(AGENT.lifeEventPermille)) {
      // life happens: rent, a car, a wedding. Ordinary outflow that the town still sees.
      const share = BigInt(AGENT.lifeShareMin + w.rng.int(AGENT.lifeShareMax - AGENT.lifeShareMin + 1));
      const amt = (valueOf(b, a.id) * share) / 1000n;
      if (amt > 0n && !withdraw(b, a.id, amt)) a.log.push(`E${b.epochId}: took out ${amt} LEMON for life`);
      continue;
    }
    if (choice === "run") {
      const had = valueOf(b, a.id);
      if (!withdrawAll(b, a.id)) { a.ranAt = b.epochId; ran++; a.log.push(`E${b.epochId}: ran with ${had} LEMON`); }
    } else if (choice === "deposit") {
      if (!deposit(b, a.id, acc.wallet / 2n)) { deposited++; a.log.push(`E${b.epochId}: deposited at ${pol.rate} bps`); }
    }
  }

  // credibility: calm words followed by rising outflows are remembered as lies
  const liab = liabilities(b);
  const outflowPermille = liab + b.outflow === 0n ? 0 : Number((b.outflow * 1000n) / (liab + b.outflow));
  if ((d.tone === "calm" || d.tone === "confident") && outflowPermille > w.lastOutflowPermille && outflowPermille > AGENT.credibilityLieOutflowPermille) {
    w.credibility = Math.max(AGENT.credibilityFloor, w.credibility - AGENT.credibilityLiePenalty);
  } else w.credibility = Math.min(AGENT.credibilityStart, w.credibility + AGENT.credibilityRecover);
  w.lastOutflowPermille = outflowPermille;

  w.lastWritedownPermille = 0;
  if (!b.collapsed) {
    const shock = w.rng.chance(BANK.shockChancePermille) ? BANK.shockMin + w.rng.int(BANK.shockMax - BANK.shockMin + 1) : 0;
    const round = b.round;
    advanceEpoch(b, BigInt(shock));
    w.lastWritedownPermille = shock;
    // a round survived: the weekend passes, the town cools down, and calm savers bring their cash back on Monday
    if (b.round !== round) {
      coolDown(w.agents, AGENT.roundPanicKeepPermille);
      openRound(w);
    }
  }
  record(w, ran, deposited);
  return press;
}

/** This epoch's speeches as the town hears them: stance of the words, plus the speaker's deposit and insurance
 *  (both public contract state). One speech per speaker counts: the latest. */
export function heardSpeeches(w: World): HeardSpeech[] {
  const b = w.bank, agentIds = new Set(w.agents.map((a) => a.id)), seen = new Map<string, HeardSpeech>();
  for (const sp of b.speeches) {
    if (sp.epochId !== b.epochId || agentIds.has(sp.who)) continue;
    const stance = speechStance(sp.text);
    if (!stance) continue;
    seen.set(sp.who, { who: sp.who, stance, stake: Number(valueOf(b, sp.who)), insured: insuredNow(b, sp.who) > 0n });
  }
  return [...seen.values()];
}

function record(w: World, ran: number, deposited: number) {
  const b = w.bank;
  w.history.push({
    epochId: b.epochId, round: b.round, epoch: b.epoch,
    reserve: Number(b.reserve), loans: Number(b.loans), liabilities: Number(liabilities(b)), supply: Number(b.supply),
    rate: Number(b.policy.rate), target: Number(b.policy.target), gate: Number(b.policy.gate),
    avgPanic: Math.round(w.agents.reduce((s, a) => s + a.panic, 0) / w.agents.length), ran, deposited, collapsed: b.collapsed,
  });
}

/** Impeachment: the holders' DAO swaps the chair's persona (in the contract: `set_chair` to a new chair account). */
export function impeach(w: World, next: Persona) {
  w.persona = next;
  w.credibility = AGENT.credibilityStart;
}

/**
 * A holders' vote on impeaching the chair, weighted by LEMON held (wallet + deposit). Agents vote yes when they no
 * longer believe the chair or are close to running; players vote as they choose. Passes on a majority of the weight
 * that voted, with at least a third of all holdings voting. In the contract this is a Sputnik DAO proposal that calls
 * `set_chair`.
 */
export function impeachmentVote(w: World, next: Persona, playerVotes: Record<string, boolean> = {}): { yes: number; no: number; turnout: number; passed: boolean } {
  const b = w.bank;
  const weight = (id: string) => { const a = b.accounts.get(id); return a ? Number(a.wallet + valueOf(b, id)) : 0; };
  let yes = 0, no = 0, all = 0;
  for (const id of b.accounts.keys()) all += weight(id);
  for (const a of w.agents) {
    const wt = weight(a.id);
    if (w.credibility < 600 || a.panic > (a.threshold * 7) / 10) yes += wt; else no += wt;
  }
  for (const [id, v] of Object.entries(playerVotes)) { if (v) yes += weight(id); else no += weight(id); }
  const turnout = all ? (yes + no) / all : 0;
  const passed = yes > no && turnout >= 1 / 3;
  if (passed) impeach(w, next);
  return { yes, no, turnout, passed };
}

/** Play until the current round ends (survived or collapsed). Returns true if the bank survived. */
export function playRound(w: World, script: (w: World) => PlayerAction[] = () => []): boolean {
  const round = w.bank.round;
  if (w.bank.collapsed) stepEpoch(w);
  while (w.bank.round === round && !w.bank.collapsed) stepEpoch(w, script(w));
  return !w.bank.collapsed;
}
