/**
 * "What if N of them run today?" One day at the bank by its real rules (bank.ts, mirrored by the contract), for the
 * page's explanation: a town of equal depositors, a bank that has lent out everything above its reserve target, and
 * `runners` of them coming for their coins one after another. No agents, no chance: the same N always gives the
 * same numbers, so a reader can move the slider and predict the next step.
 */
import { advanceEpoch, deposit, liabilities, newBank, valueOf, withdrawAll, type Bank } from "./bank";

export interface RunWhatIf {
  depositors: number; runners: number;
  supplyBefore: number; burned: number; printed: number; supplyAfter: number;
  /** the vault and the loan book before anyone ran */
  vaultBefore: number; loansBefore: number; owedEach: number;
  fell: boolean;
  /** runners who walked away with everything they were owed */
  paidInFull: number;
  /** what one depositor who was not paid in full got back (0 if the bank did not fall) */
  lateGot: number;
  /** if the bank stood: its assets as a share of what it still owes, in permille (1000 = fully covered) */
  coverPermille: number;
}

const who = (i: number) => `d${String(i).padStart(2, "0")}`;

function town(depositors: number, each: bigint): Bank {
  const b = newBank("owner", "chair", Array.from({ length: depositors }, (_, i) => [who(i), each] as [string, bigint]));
  for (let i = 0; i < depositors; i++) deposit(b, who(i), each);
  advanceEpoch(b); // the bank lends out everything above its reserve target
  return b;
}

export function runWhatIf(runners: number, depositors = 60, each = 1000n): RunWhatIf {
  const n = Math.max(0, Math.min(depositors, Math.floor(runners)));
  const b = town(depositors, each);
  const supplyBefore = b.supply, owedEach = valueOf(b, who(0)), vaultBefore = b.reserve, loansBefore = b.loans;
  let paidInFull = 0;
  for (let i = 0; i < n && !b.collapsed; i++) { withdrawAll(b, who(i)); if (!b.collapsed) paidInFull++; }
  const fell = b.collapsed;
  const burned = supplyBefore - b.supply;
  let lateGot = 0n, coverPermille = 1000n;
  if (fell) {
    const settle = b.events.find((e) => e.t === "settle");
    lateGot = settle && settle.t === "settle" ? settle.amount : 0n;
  } else {
    const owed = liabilities(b);
    coverPermille = owed === 0n ? 1000n : ((b.reserve + b.loans) * 1000n) / owed;
  }
  const beforeRescue = b.supply;
  if (fell) advanceEpoch(b); // the rescue: new coins into a fresh vault
  return {
    depositors, runners: n, supplyBefore: Number(supplyBefore), burned: Number(burned), printed: Number(b.supply - beforeRescue), supplyAfter: Number(b.supply),
    vaultBefore: Number(vaultBefore), loansBefore: Number(loansBefore), owedEach: Number(owedEach), fell, paidInFull, lateGot: Number(lateGot), coverPermille: Number(coverPermille),
  };
}

/** Every answer from "nobody runs" to "everybody runs": the whole curve the page draws. */
export const runCurve = (depositors = 60, each = 1000n): RunWhatIf[] => Array.from({ length: depositors + 1 }, (_, n) => runWhatIf(n, depositors, each));
