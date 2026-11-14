/**
 * The picture of the bank for "how many of the sixty run today?": the drawn town (town/Town2D) fed with one day
 * of the bank's real arithmetic (`runWhatIf` in @chair/sim). The reader moves a slider; this turns the number into
 * who has left through the door, how full the vault is, whether the bank is closed, and what the chair says.
 * Pure: the same number always gives the same picture.
 */
import { createCrisis, view, type RunWhatIf, type WorldView } from "@chair/sim";

export type Zone = "vault" | "sale" | "fall";
export const zoneOf = (r: RunWhatIf): Zone => (r.fell ? "fall" : r.burned > 0 ? "sale" : "vault");

/** The order depositors leave in: spread over the room, not row by row (37 and 60 share no divisor). */
export const leaveOrder = (count: number): number[] => Array.from({ length: count }, (_, k) => (k * 37 + 11) % count);

let base: WorldView | null = null;
/** A town of sixty at rest, built once: the same depositors the game has. */
const town = (): WorldView => (base ??= view(createCrisis(7).w, { players: [], chairMode: "" }));

/** What the chair says in each zone: [English, Russian]. */
export const SAYS: Record<Zone, [string, string]> = {
  vault: ["A quiet day. The vault pays everyone who asks.", "Спокойный день. Сейф платит всем, кто просит."],
  sale: ["No panic, please! We are selling loans to pay you.", "Без паники! Продаём кредиты, чтобы с вами расплатиться."],
  fall: ["The bank is closed. We are waiting for a rescue.", "Банк закрыт. Ждём спасения."],
};

export function runView(r: RunWhatIf, lang: 0 | 1, chairTitle: string): WorldView {
  const b = town(), zone = zoneOf(r), n = r.runners, total = b.agents.length;
  const gone = new Set(leaveOrder(total).slice(0, n));
  // how those who stayed feel: calm while the vault pays, worried while loans burn, panicking once the bank is shut
  const panic = zone === "vault" ? 150 : zone === "sale" ? 650 : 980;
  // the vault's gauge: what is left of the cash against what is still owed (the gauge is full at 50%)
  const owedLeft = Math.max(1, (total - n) * r.owedEach);
  const reservePermille = zone === "vault" ? Math.round(((r.vaultBefore - n * r.owedEach) * 1000) / owedLeft) : zone === "sale" ? 20 : 0;
  const tone = zone === "vault" ? "calm" : zone === "sale" ? "cautious" : "alarming";
  const snap = b.history[b.history.length - 1] ?? ({} as WorldView["history"][number]);
  return {
    ...b,
    epochId: n, // a new key per position, so the "burned" label over the vault plays again
    collapsed: r.fell, reservePermille: Math.max(0, reservePermille), supply: r.supplyAfter,
    personaTitle: chairTitle,
    agents: b.agents.map((a, i) => ({ ...a, mind: undefined, threshold: 1000, panic: gone.has(i) ? 1000 : panic, deposit: gone.has(i) ? 0 : r.owedEach })),
    // the label over the vault is what burned that day, the same number as under the picture (the rescue's print is shown apart)
    history: [{ ...snap, supply: r.supplyBefore }, { ...snap, supply: r.supplyBefore - r.burned }],
    press: [{ epochId: n, decision: { rate: 0, target: 0, mint: 0, gate: 0, tone, statement: SAYS[zone][lang], reasoning: "" }, rejected: null } as unknown as WorldView["press"][number]],
  };
}
