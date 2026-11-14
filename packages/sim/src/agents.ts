/**
 * Depositor agents. Each one has its own wallet in the bank, a panic level, a threshold, friends and traits, and logs
 * every panic change with its reason so the UI can answer "why did Mia run?". The model is in RULES.md (Agents).
 */
import { AGENT, type Tone } from "./rules";
import { Rng } from "./rng";

export interface Cause { why: string; delta: number }

export interface Agent {
  id: string;
  name: string;
  panic: number;
  /** Temperament: the panic this agent drifts back to between rounds (its starting panic). */
  base: number;
  threshold: number;
  friends: number[];
  trust: number;
  gullibility: number;
  hunger: number;
  /** Ran (withdrew everything) in the epoch with this id; -1 if not. */
  ranAt: number;
  /** Reasons for the latest panic update, newest epoch only. */
  why: Cause[];
  /** Short history of what the agent did, for tooltips. */
  log: string[];
  /** Set when an outside mind (a language model, somebody's agent) decided for this depositor: its latest move. */
  mind?: import("./minds").AgentMind;
}

const FIRST = ["Mia", "Theo", "Ava", "Noah", "Iris", "Leo", "Zoe", "Omar", "Nina", "Hugo", "Lena", "Ravi", "Maya", "Finn", "Sara", "Ezra", "Lola", "Ivan", "Aria", "Jude"];
const LAST = ["Park", "Okafor", "Silva", "Novak", "Brandt", "Haddad", "Moreau", "Kowal", "Reyes", "Sato", "Ferrar", "Lund"];

export function createAgents(rng: Rng, n: number = AGENT.count): Agent[] {
  const agents: Agent[] = [];
  const taken = new Set<string>();
  for (let i = 0; i < n; i++) {
    const id = `agent-${String(i + 1).padStart(2, "0")}`;
    // one draw per agent, as before (the stream decides everything after it); a full name already in town moves on
    // to the next free surname, so the list of who ran never shows the same person twice
    let pick = (i * 7 + rng.int(LAST.length)) % LAST.length;
    let name = `${FIRST[i % FIRST.length]} ${LAST[pick]}`;
    for (let k = 1; k < LAST.length && taken.has(name); k++) { pick = (pick + 1) % LAST.length; name = `${FIRST[i % FIRST.length]} ${LAST[pick]}`; }
    taken.add(name);
    const panic = AGENT.panicStartMin + rng.int(AGENT.panicStartSpan + 1);
    agents.push({
      id, name, panic, base: panic,
      threshold: AGENT.thresholdMin + rng.int(AGENT.thresholdSpan + 1),
      friends: [],
      trust: 200 + rng.int(801),
      gullibility: rng.int(1001),
      hunger: rng.int(1001),
      ranAt: -1, why: [], log: [],
    });
  }
  // a small-world friend graph: neighbours on a ring plus a few random links
  for (let i = 0; i < n; i++) {
    const want = 3 + rng.int(4);
    const set = new Set<number>([(i + 1) % n, (i + n - 1) % n]);
    while (set.size < want) { const j = rng.int(n); if (j !== i) set.add(j); }
    agents[i].friends = [...set];
  }
  return agents;
}

/** What the agents can observe at the moment they decide, after the chair has spoken. */
export interface Signals {
  epochId: number;
  tone: Tone;
  /** 0..1000: how much the town still believes the chair. */
  credibility: number;
  rateChange: number;
  gateOn: boolean;
  gateJustOn: boolean;
  minted: boolean;
  targetRaised: boolean;
  /** Last epoch's withdrawals as permille of liabilities. */
  outflowPermille: number;
  /** Reserve as permille of liabilities. */
  reservePermille: number;
  rumors: number;
  /** Permille of the loan book written off at the end of last epoch (0 if none). */
  writedownPermille: number;
  /** Agents whose money is all out of the bank (cash in hand); they calm down faster. Indexes into `agents`. */
  cashOnly?: Set<number>;
  /** Players' public speeches this epoch, with what the town can check on chain about each speaker. */
  speeches?: HeardSpeech[];
  /** Extra public news this epoch (a neighbouring bank closed, the chair broke a promise). `by` scales the effect by
   *  the agent's own trait (0..1000); without it every agent reacts the same. */
  news?: News[];
}

export interface News { why: string; delta: number; by?: "gullibility" | "trust" }

/** A public speech as the town hears it: the stance of the words and the speaker's stake, read from the contract. */
export interface HeardSpeech {
  who: string;
  stance: Stance;
  /** The speaker's deposit in the bank right now (LEMON). Words weigh as much as the money behind them. */
  stake: number;
  /** The speaker bought insurance against a collapse this round (public on chain). */
  insured: boolean;
}

export type Stance = "calm" | "alarm";

/** What a speech asks the town to do: stay ("calm"), get out ("alarm"), or neither (null). English and Russian. */
export function speechStance(text: string): Stance | null {
  const t = text.toLowerCase();
  if (/(don['’]?t|do not|no need to|no) panic|(don['’]?t|do not) run\b|no reason to withdraw|не паникуй|без паники|не снимайте|не бегите/.test(t)) return "calm";
  if (/panic|collapse|\brun\b|empty|insolvent|bankrupt|get out|withdraw|паник|крах|беги|пуст|банкрот|забирайте|снимайте/.test(t)) return "alarm";
  if (/calm|safe|fine|stay|trust|hold|solid|strong|спокойн|безопасн|останьт|оставайт|держ|доверя|надёжн|надежн/.test(t)) return "calm";
  return null;
}

/** Strength of one speech for one agent, before the per-epoch cap: negative calms, positive alarms. */
export function speechEffect(sp: HeardSpeech, a: Agent): { delta: number; why: string } {
  const weight = Math.min(1, sp.stake / AGENT.speechStakeFull);
  const stake = sp.stake > 0 ? `${sp.stake.toLocaleString("en-US")} LEMON in the bank` : "no money in the bank";
  if (sp.stance === "calm") {
    // insured against the bank and telling us to stay: the town reads the insurance, not the words
    if (sp.insured) return { delta: (AGENT.speechHypocrite * a.gullibility) / 1000 + AGENT.speechHypocrite / 2, why: `${sp.who} insured against the bank but says stay` };
    const listens = 500 + a.gullibility / 2;
    return { delta: -(AGENT.speechCalm * weight * listens) / 1000, why: `${sp.who} (${stake}) says stay calm` };
  }
  // an alarm from someone with money inside is believed more; from an outsider it still spreads like a rumour
  return { delta: (AGENT.speechAlarm * (0.5 + weight / 2) * a.gullibility) / 1000, why: `${sp.who} (${stake}) says get out` };
}

export function updatePanic(agents: Agent[], s: Signals, rng?: Rng): void {
  const ranIdx = new Set<number>();
  agents.forEach((a, i) => { if (a.ranAt >= 0 && a.ranAt === s.epochId - 1) ranIdx.add(i); });
  agents.forEach((a, idx) => {
    const why: Cause[] = [];
    const add = (reason: string, d: number) => { if (Math.round(d) !== 0) why.push({ why: reason, delta: Math.round(d) }); };
    add("time passes", AGENT.timeCalm);
    if (s.cashOnly?.has(idx)) add("my money is safe at home", AGENT.cashCalm);
    if (rng) add("the news and the neighbours", rng.int(2 * AGENT.noise + 1) - AGENT.noise);
    // scaled by how much this agent trusts the chair and how much the town still believes it
    add(`chair sounded ${s.tone}`, (AGENT.tone[s.tone] * a.trust * s.credibility) / 1_000_000);
    if (s.rateChange > AGENT.rateHikeThresholdBps) add("rate hiked: why so desperate?", AGENT.rateHikePanic);
    if (s.gateJustOn) add("withdrawal gate switched on", AGENT.gatePanic);
    else if (s.gateOn) add("withdrawal gate still on", AGENT.gatePanic / 3);
    if (s.minted) add(a.hunger > AGENT.mintWorryHunger ? "money printing: inflation" : "emergency cash in the vault", a.hunger > AGENT.mintWorryHunger ? AGENT.mintInflationWorry : AGENT.mintCalm);
    if (s.targetRaised) add("reserve target raised", AGENT.targetRaised);
    add("people withdrew last epoch", Math.min(AGENT.outflowCap, s.outflowPermille * AGENT.outflowPerPermille));
    const friendsRan = a.friends.filter((f) => ranIdx.has(f)).length;
    if (friendsRan) add(`${friendsRan} friend${friendsRan > 1 ? "s" : ""} ran`, Math.min(AGENT.friendRanCap, friendsRan * AGENT.friendRan));
    if (s.writedownPermille > 0) add(`Lemon Brothers wrote off ${(s.writedownPermille / 10).toFixed(1)}% of its loans`, s.writedownPermille * AGENT.writedownPerPermille);
    if (s.reservePermille < AGENT.lowReservePermille) add("vault below 10%", AGENT.lowReservePanic);
    for (let r = 0; r < s.rumors; r++) add(r === 0 ? "heard a rumour" : "another rumour", (AGENT.rumor * a.gullibility) / 1000 / (r === 0 ? 1 : 2));
    if (s.speeches?.length) {
      // the strongest calming and the strongest alarming speech count fully, the rest at half, each side capped
      const fx = s.speeches.map((sp) => speechEffect(sp, a)).filter((e) => Math.round(e.delta) !== 0);
      for (const side of [fx.filter((e) => e.delta < 0).sort((x, y) => x.delta - y.delta), fx.filter((e) => e.delta > 0).sort((x, y) => y.delta - x.delta)]) {
        let sum = 0;
        side.forEach((e, i) => {
          const d = i === 0 ? e.delta : e.delta / 2;
          const room = AGENT.speechCap - Math.abs(sum);
          if (room <= 0) return;
          const take = Math.sign(d) * Math.min(Math.abs(d), room);
          sum += take; add(e.why, take);
        });
      }
    }
    for (const n of s.news ?? []) add(n.why, n.by ? (n.delta * a[n.by]) / 1000 : n.delta);
    const total = why.reduce((x, c) => x + c.delta, 0);
    a.panic = Math.max(0, Math.min(1000, a.panic + total));
    a.why = why.filter((c) => c.delta !== 0).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  });
}

/** Between rounds panic drifts back toward the agent's temperament; `keepPermille` of the excess stays. */
export function coolDown(agents: Agent[], keepPermille: number): void {
  for (const a of agents) a.panic = Math.max(0, Math.min(1000, a.base + Math.round(((a.panic - a.base) * keepPermille) / 1000)));
}

/** Decision after the panic update: run, add money, or hold. */
export type Choice = "run" | "deposit" | "hold";
export function decide(a: Agent, rateBps: number, hasWallet: boolean, hasDeposit: boolean): Choice {
  if (hasDeposit && a.panic >= a.threshold) return "run";
  if (hasWallet && a.panic < a.threshold / 2 && rateBps >= AGENT.depositRateMinBps) return "deposit";
  return "hold";
}

/** Order in which agents act this epoch (seeded shuffle). */
export function actOrder(rng: Rng, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}
