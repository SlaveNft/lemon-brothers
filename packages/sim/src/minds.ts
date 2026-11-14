/**
 * Depositors with a mind of their own. By default every depositor is a small program (`decide` in agents.ts): that
 * keeps a crisis a pure function of its seed, which the replay-checked leaderboard needs. In a live town some of
 * them can instead be driven from outside: a language model, or anybody's own agent. The outside mind is shown what
 * a depositor can see (`depositorPrompt`) and answers with one move (`parseMindMove`); `stepEpoch` applies it in
 * place of the rule, through the same bank functions as everyone else, so a mind can do nothing a depositor cannot.
 */
import type { Agent, Choice } from "./agents";
import { decide } from "./agents";
import { reserveRatio, valueOf } from "./bank";
import type { ChairDecision } from "./chair";
import { BANK } from "./rules";
import type { World } from "./world";

/** One depositor's move for one epoch, decided outside the simulation. */
export interface MindMove {
  choice: Choice;
  /** the depositor's own reason, one sentence */
  why: string;
  /** one public sentence to the town (costs the speech fee), or empty */
  say: string;
  /** what decided: a model id, or the name of somebody's agent */
  model: string;
  /** "model": the outside mind answered; "rule": it did not, and the depositor's own rule decided */
  source: "model" | "rule";
}
/** The latest move of an outside mind, kept on the agent for the page. */
export interface AgentMind extends MindMove { epochId: number }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pct = (permille: number) => `${(permille / 10).toFixed(1)}%`;

/** A depositor's temperament in words, from the same traits the rule uses. */
export function character(a: Agent): string {
  const nerve = a.threshold < 450 ? "nervous by nature" : a.threshold > 650 ? "hard to scare" : "neither brave nor timid";
  const trust = a.trust > 750 ? "you tend to believe the bank's chair" : a.trust < 450 ? "you do not trust what officials say" : "you take the chair's words with some doubt";
  const herd = a.gullibility > 650 ? "rumours and what your neighbours do sway you easily" : a.gullibility < 300 ? "you make up your own mind whatever the neighbours do" : "you keep an eye on what your neighbours do";
  return `${nerve}; ${trust}; ${herd}`;
}

/**
 * What depositor `i` sees before deciding, after the chair has announced `chair` for this epoch. Only things a
 * depositor could know: its own money, the chair's public words and policy, the vault, yesterday's outflow, which
 * friends ran, today's rumours and speeches.
 */
export function depositorPrompt(w: World, i: number, chair: ChairDecision): { system: string; user: string } {
  const b = w.bank, a = w.agents[i], acc = b.accounts.get(a.id);
  const friendsRan = a.friends.filter((f) => w.agents[f].ranAt >= 0 && w.agents[f].ranAt >= b.epochId - 1).map((f) => w.agents[f].name);
  const speeches = b.speeches.filter((s) => s.epochId === b.epochId).slice(-3).map((s) => `${s.who}: "${clip(s.text, 140)}"`);
  const rumors = b.rumors.filter((r) => r.epochId === b.epochId).map((r) => r.kind.replace(/_/g, " "));
  const system = [
    `You are ${a.name}, one of sixty depositors of Lemon Brothers, a parody bank in a game played with test tokens.`,
    `Your character: ${character(a)}.`,
    "The bank lends out most deposits and keeps a little cash in the vault. If too many depositors withdraw at once the vault empties, the bank falls, and whoever is still inside gets back almost nothing. Those who leave early get everything.",
    `Each day you choose one move: "hold" (leave your deposit where it is), "run" (withdraw everything now) or "deposit" (put half of your wallet into the bank to earn the deposit rate).`,
    `You may also say one short public sentence to the town; it costs ${BANK.lobbyFee} LEMON from your wallet, so stay silent unless it matters.`,
    `Decide as this person would, for your own money. Answer with JSON only: {"choice":"hold"|"run"|"deposit","why":"one short sentence with your real reason","say":"one public sentence, or empty"}`,
  ].join("\n");
  const user = [
    `Round ${b.round + 1}, day ${b.epoch + 1} of ${BANK.epochsPerRound}.`,
    `Your deposit: ${valueOf(b, a.id)} LEMON. Your wallet: ${acc?.wallet ?? 0n} LEMON.`,
    `The chair said today (tone: ${chair.tone}): "${clip(chair.statement, 280)}"`,
    `Announced policy: deposit rate ${(chair.rate / 100).toFixed(2)}% a day; ${chair.gate > 0 ? `withdrawals limited to ${chair.gate} LEMON a day each` : "no limit on withdrawals"}; ${chair.mint > 0 ? `the chair wants to print ${chair.mint} LEMON` : "no printing"}.`,
    `Cash in the vault: ${pct(Number(reserveRatio(b)))} of all deposits.`,
    `Yesterday ${pct(w.lastOutflowPermille)} of deposits left the bank.${w.lastWritedownPermille > 0 ? ` The bank just wrote off ${pct(w.lastWritedownPermille)} of its loans.` : ""}`,
    friendsRan.length ? `Friends of yours who took their money out since yesterday: ${friendsRan.join(", ")}.` : `None of your ${a.friends.length} friends has run since yesterday.`,
    rumors.length ? `Rumours today: ${rumors.join("; ")}.` : "No rumours today.",
    speeches.length ? `Said in public today:\n${speeches.join("\n")}` : "Nobody has spoken in public today.",
  ].join("\n");
  return { system, user };
}

/** The mind's answer as a move, or why it cannot be used. Shape only: whether the move is possible is the bank's job. */
export function parseMindMove(text: string): Pick<MindMove, "choice" | "why" | "say"> | string {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return "no JSON object in the answer";
  let j: unknown;
  try { j = JSON.parse(text.slice(a, b + 1)); } catch { return "answer is not valid JSON"; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return "answer is not a JSON object";
  const o = j as Record<string, unknown>;
  if (o.choice !== "hold" && o.choice !== "run" && o.choice !== "deposit") return `choice ${JSON.stringify(o.choice)} is not hold, run or deposit`;
  const line = (v: unknown, max: number) => (typeof v === "string" ? clip(v.replace(/\s+/g, " ").trim(), max) : "");
  return { choice: o.choice, why: line(o.why, 200), say: line(o.say, 200) };
}

/** What the depositor's own rule would do right now: the move used when an outside mind does not answer. */
export function ruleMove(w: World, i: number, model: string, reason: string): MindMove {
  const a = w.agents[i], acc = w.bank.accounts.get(a.id);
  const choice = decide(a, Number(w.bank.policy.rate), (acc?.wallet ?? 0n) > 0n, (acc?.shares ?? 0n) > 0n);
  return { choice, why: clip(reason, 200), say: "", model, source: "rule" };
}
