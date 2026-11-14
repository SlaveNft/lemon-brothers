/**
 * The bank and the $LEMON token as a pure state machine. BigInt integer math, identical to
 * contracts/bank-core (parity vectors from scripts/vectors.ts are replayed by the Rust tests).
 *
 * Invariant after every call: supply == sum(wallets) + reserve + loans.
 * Functions mutate the state they are given and return an error string instead of throwing, the way the
 * contract rejects a call: on error nothing has changed.
 */
import { BANK, DEFAULT_POLICY, POLICY_BOUNDS, RUMORS, SCALE, TONES, type RumorKind, type Tone } from "./rules";

export interface Policy { rate: bigint; target: bigint; mint: bigint; gate: bigint; tone: Tone; statement: string; attestation: string }

export interface Account {
  wallet: bigint;
  shares: bigint;
  /** LEMON withdrawn in epoch `withdrawnEpochId` (for the gate). */
  withdrawn: bigint;
  withdrawnEpochId: number;
  /** Insurance premium bought in round `insuredRound`. */
  insured: bigint;
  insuredRound: number;
  airdropped: boolean;
}

export type BankEvent =
  | { t: "deposit"; who: string; amount: bigint }
  | { t: "withdraw"; who: string; amount: bigint; fireSold: bigint; burned: bigint }
  | { t: "collapse"; who: string; assets: bigint; liabilities: bigint }
  | { t: "settle"; who: string; amount: bigint }
  | { t: "insurance_payout"; who: string; amount: bigint }
  | { t: "policy"; policy: Policy }
  | { t: "lobby"; who: string; text: string }
  | { t: "rumor"; who: string; kind: RumorKind }
  | { t: "insure"; who: string; premium: bigint }
  | { t: "epoch"; epochId: number; round: number; epoch: number }
  | { t: "round_end"; round: number; survived: boolean }
  | { t: "bailout"; round: number; minted: bigint }
  | { t: "writedown"; permille: bigint; amount: bigint };

export interface Bank {
  /**
   * The most LEMON this bank may ever have in existence (0n = no ceiling set). Loan yield, the chair's print, a
   * bailout, an insurance payout and a newcomer's airdrop all stop at it: past it, new LEMON can only replace LEMON
   * that burned.
   */
  maxSupply: bigint;
  supply: bigint;
  reserve: bigint;
  loans: bigint;
  totalShares: bigint;
  index: bigint;
  collapsed: boolean;
  /** Epoch within the round, 0..epochsPerRound-1. */
  epoch: number;
  round: number;
  /** Global epoch counter, never resets. */
  epochId: number;
  policy: Policy;
  policySetEpochId: number;
  mintedThisRound: bigint;
  roundStartSupply: bigint;
  liabilitiesAtCollapse: bigint;
  /** LEMON withdrawn during the current epoch (public; agents read last epoch's value). */
  outflow: bigint;
  speeches: Array<{ who: string; text: string; epochId: number }>;
  rumors: Array<{ who: string; kind: RumorKind; epochId: number }>;
  /** Accounts in registration order (the contract keeps the same order). */
  accounts: Map<string, Account>;
  chair: string;
  owner: string;
  events: BankEvent[];
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const min = (a: bigint, b: bigint) => (a < b ? a : b);

export function newBank(owner: string, chair: string, genesis: Array<[string, bigint]> = []): Bank {
  const b: Bank = {
    maxSupply: 0n, supply: 0n, reserve: 0n, loans: 0n, totalShares: 0n, index: SCALE, collapsed: false,
    epoch: 0, round: 0, epochId: 0,
    policy: { ...DEFAULT_POLICY, tone: "calm", statement: "", attestation: "" }, policySetEpochId: -1,
    mintedThisRound: 0n, roundStartSupply: 0n, liabilitiesAtCollapse: 0n, outflow: 0n,
    speeches: [], rumors: [], accounts: new Map(), chair, owner, events: [],
  };
  for (const [who, amount] of genesis) { acct(b, who).wallet += amount; b.supply += amount; }
  b.roundStartSupply = b.supply;
  b.maxSupply = (b.supply * BANK.maxSupplyPermille) / 1000n;
  return b;
}

/** Get or register an account. Registration order matters (a collapse settles accounts in this order), so only
 *  successful state changes register: the contract does the same. */
export function acct(b: Bank, who: string): Account {
  let a = b.accounts.get(who);
  if (!a) {
    a = { wallet: 0n, shares: 0n, withdrawn: 0n, withdrawnEpochId: -1, insured: 0n, insuredRound: -1, airdropped: false };
    b.accounts.set(who, a);
  }
  return a;
}

export const liabilities = (b: Bank) => (b.totalShares * b.index) / SCALE;
export const valueOf = (b: Bank, who: string) => { const a = b.accounts.get(who); return a ? (a.shares * b.index) / SCALE : 0n; };
export const equity = (b: Bank) => b.reserve + b.loans - liabilities(b);
/** Reserve as permille of liabilities (1000 when there are no deposits). */
export const reserveRatio = (b: Bank) => { const l = liabilities(b); return l === 0n ? 1000n : (b.reserve * 1000n) / l; };
export const insuredNow = (b: Bank, who: string) => { const a = b.accounts.get(who); return a && a.insuredRound === b.round ? a.insured : 0n; };

export function sumWallets(b: Bank): bigint { let s = 0n; for (const a of b.accounts.values()) s += a.wallet; return s; }

// ------------------------------------------------------------------ player actions

/** How many LEMON can still be printed before the bank's ceiling; null = no ceiling set. */
export const mintRoom = (b: Bank): bigint | null => (b.maxSupply === 0n ? null : b.maxSupply > b.supply ? b.maxSupply - b.supply : 0n);
/** `x` cut down to what the ceiling still allows. */
const capped = (b: Bank, x: bigint): bigint => { const room = mintRoom(b); return room === null ? x : min(x, room); };

export function airdrop(b: Bank, who: string): string | null {
  if (b.accounts.get(who)?.airdropped) return "airdrop already claimed";
  if (capped(b, BANK.airdrop) < BANK.airdrop) return `airdrop refused: the bank's ceiling of ${b.maxSupply} LEMON is reached; newcomers get coins again once some have burned`;
  const a = acct(b, who);
  a.airdropped = true; a.wallet += BANK.airdrop; b.supply += BANK.airdrop;
  return null;
}

export function deposit(b: Bank, who: string, amount: bigint): string | null {
  if (b.collapsed) return "bank is closed until the bailout";
  if (amount <= 0n) return "amount must be positive";
  if ((b.accounts.get(who)?.wallet ?? 0n) < amount) return "not enough LEMON in wallet";
  const shares = (amount * SCALE) / b.index;
  if (shares === 0n) return "amount too small";
  const a = acct(b, who);
  a.wallet -= amount; a.shares += shares; b.totalShares += shares; b.reserve += amount;
  b.events.push({ t: "deposit", who, amount });
  return null;
}

/** Withdraw up to `amount` (capped by the deposit value and the gate). Can trigger a fire sale or the collapse. */
export function withdraw(b: Bank, who: string, amount: bigint): string | null {
  if (b.collapsed) return "bank is closed until the bailout";
  const a = b.accounts.get(who);
  if (!a || a.shares === 0n) return "no deposit";
  const value = (a.shares * b.index) / SCALE;
  let want = min(amount, value);
  if (b.policy.gate > 0n) {
    const used = a.withdrawnEpochId === b.epochId ? a.withdrawn : 0n;
    want = min(want, b.policy.gate > used ? b.policy.gate - used : 0n);
  }
  if (want <= 0n) return b.policy.gate > 0n ? "gate: withdrawal limit for this epoch reached" : "nothing to withdraw";

  let fireSold = 0n, burned = 0n;
  if (b.reserve < want) {
    const need = want - b.reserve;
    const sell = ceilDiv(need * 1000n, 1000n - BANK.haircutPermille);
    if (sell > b.loans) { collapse(b, who); return null; }
    const proceeds = (sell * (1000n - BANK.haircutPermille)) / 1000n;
    b.loans -= sell; b.reserve += proceeds; burned = sell - proceeds; b.supply -= burned; fireSold = sell;
  }
  const burnShares = want === value ? a.shares : min(a.shares, ceilDiv(want * SCALE, b.index));
  a.shares -= burnShares; b.totalShares -= burnShares;
  b.reserve -= want; a.wallet += want; b.outflow += want;
  if (a.withdrawnEpochId !== b.epochId) { a.withdrawnEpochId = b.epochId; a.withdrawn = 0n; }
  a.withdrawn += want;
  b.events.push({ t: "withdraw", who, amount: want, fireSold, burned });
  return null;
}

export const withdrawAll = (b: Bank, who: string) => withdraw(b, who, valueOf(b, who));

/** Every loan is sold at the haircut, the assets are split pro rata over all shares, insurance pays out. */
function collapse(b: Bank, who: string) {
  const liab = liabilities(b);
  const proceeds = (b.loans * (1000n - BANK.haircutPermille)) / 1000n;
  b.supply -= b.loans - proceeds; b.reserve += proceeds; b.loans = 0n;
  const assets = b.reserve, total = b.totalShares;
  b.events.push({ t: "collapse", who, assets, liabilities: liab });
  for (const [id, a] of b.accounts) {
    if (a.shares === 0n) continue;
    const pay = total === 0n ? 0n : (assets * a.shares) / total;
    a.wallet += pay; b.reserve -= pay; a.shares = 0n;
    b.events.push({ t: "settle", who: id, amount: pay });
  }
  for (const [id, a] of b.accounts) {
    if (a.insuredRound !== b.round || a.insured === 0n) continue;
    // a payout is new LEMON, so it stops at the bank's ceiling like every other mint
    const pay = capped(b, a.insured * BANK.insurePayout);
    a.wallet += pay; b.supply += pay; a.insured = 0n;
    b.events.push({ t: "insurance_payout", who: id, amount: pay });
  }
  b.totalShares = 0n; b.index = SCALE; b.liabilitiesAtCollapse = liab; b.collapsed = true;
  b.events.push({ t: "round_end", round: b.round, survived: false });
}

export function lobby(b: Bank, who: string, text: string): string | null {
  if (bytes(text) === 0 || bytes(text) > BANK.maxTextBytes) return `speech must be 1..${BANK.maxTextBytes} bytes`;
  if (b.speeches.filter((s) => s.epochId === b.epochId).length >= BANK.maxSpeechesPerEpoch) return "the chair takes no more speeches this epoch";
  if (b.speeches.filter((s) => s.epochId === b.epochId && s.who === who).length >= BANK.maxSpeechesPerAccount) return `at most ${BANK.maxSpeechesPerAccount} speeches per account per epoch`;
  if ((b.accounts.get(who)?.wallet ?? 0n) < BANK.lobbyFee) return "not enough LEMON for the lobbying fee";
  const a = acct(b, who);
  a.wallet -= BANK.lobbyFee; b.supply -= BANK.lobbyFee;
  b.speeches.push({ who, text, epochId: b.epochId });
  b.events.push({ t: "lobby", who, text });
  return null;
}

export function rumor(b: Bank, who: string, kind: RumorKind): string | null {
  if (!RUMORS.includes(kind)) return "unknown rumour";
  if (b.rumors.filter((r) => r.epochId === b.epochId).length >= BANK.maxRumorsPerEpoch) return "the town has heard enough rumours this epoch";
  if (b.rumors.filter((r) => r.epochId === b.epochId && r.who === who).length >= BANK.maxRumorsPerAccount) return `at most ${BANK.maxRumorsPerAccount} rumours per account per epoch`;
  if ((b.accounts.get(who)?.wallet ?? 0n) < BANK.rumorFee) return "not enough LEMON for the rumour";
  const a = acct(b, who);
  a.wallet -= BANK.rumorFee; b.supply -= BANK.rumorFee;
  b.rumors.push({ who, kind, epochId: b.epochId });
  b.events.push({ t: "rumor", who, kind });
  return null;
}

export function insure(b: Bank, who: string, premium: bigint): string | null {
  if (b.collapsed) return "bank is closed until the bailout";
  if (b.epoch > BANK.insureLastEpoch) return "too late in the round to insure";
  if (premium < BANK.insureMin) return `premium must be at least ${BANK.insureMin}`;
  const prev = b.accounts.get(who);
  const have = prev && prev.insuredRound === b.round ? prev.insured : 0n;
  // Same comparison as the contract, which must not overflow u128 on a huge premium (`have <= insureMax` always).
  if (premium > BANK.insureMax - have) return `at most ${BANK.insureMax} LEMON of insurance per round`;
  if ((prev?.wallet ?? 0n) < premium) return "not enough LEMON in wallet";
  const a = acct(b, who);
  a.wallet -= premium; b.reserve += premium;
  a.insured = have + premium; a.insuredRound = b.round;
  b.events.push({ t: "insure", who, premium });
  return null;
}

// ------------------------------------------------------------------ the chair

export interface PolicyInput { rate: bigint; target: bigint; mint: bigint; gate: bigint; tone: Tone; statement: string; attestation: string }

/** Why a policy would be rejected, or null if the contract would accept it. Pure check, no state change. */
export function checkPolicy(b: Bank, caller: string, p: PolicyInput): string | null {
  if (caller !== b.chair) return "only the chair can set policy";
  if (b.collapsed) return "bank is closed until the bailout";
  if (b.policySetEpochId === b.epochId) return "policy already set this epoch";
  const B = POLICY_BOUNDS, cur = b.policy;
  if (p.rate < 0n || p.rate > B.rateMax) return `rate ${p.rate} outside 0..${B.rateMax} bps`;
  if ((p.rate > cur.rate ? p.rate - cur.rate : cur.rate - p.rate) > B.rateStep) return `rate moves ${cur.rate} -> ${p.rate}, more than ${B.rateStep} bps in one epoch`;
  if (p.target < B.targetMin || p.target > B.targetMax) return `reserve target ${p.target} outside ${B.targetMin}..${B.targetMax} permille`;
  if ((p.target > cur.target ? p.target - cur.target : cur.target - p.target) > B.targetStep) return `reserve target moves more than ${B.targetStep} permille in one epoch`;
  if (p.mint < 0n) return "mint cannot be negative";
  const epochCap = (b.supply * B.mintEpochPermille) / 1000n;
  if (p.mint > epochCap) return `mint ${p.mint} LEMON refused: above ${B.mintEpochPermille / 10n}% of supply, at most ${epochCap} this epoch`;
  const roundCap = (b.roundStartSupply * B.mintRoundPermille) / 1000n;
  if (b.mintedThisRound + p.mint > roundCap) {
    const left = roundCap > b.mintedThisRound ? roundCap - b.mintedThisRound : 0n;
    return `mint ${p.mint} LEMON refused: would exceed ${B.mintRoundPermille / 10n}% of the round's starting supply, ${left} left this round`;
  }
  const room = mintRoom(b);
  if (room !== null && p.mint > room) return `mint ${p.mint} LEMON refused: the bank's ceiling is ${b.maxSupply} LEMON, at most ${room} can still be printed`;
  if (p.gate !== 0n && p.gate < B.gateMin) return `gate must be 0 (off) or at least ${B.gateMin}`;
  if (!TONES.includes(p.tone)) return "unknown tone";
  if (bytes(p.statement) > BANK.maxTextBytes) return `statement longer than ${BANK.maxTextBytes} bytes`;
  if (bytes(p.attestation) > BANK.maxAttestationBytes) return `attestation longer than ${BANK.maxAttestationBytes} bytes`;
  return null;
}

export function setPolicy(b: Bank, caller: string, p: PolicyInput): string | null {
  const err = checkPolicy(b, caller, p);
  if (err) return err;
  b.policy = { ...p };
  b.policySetEpochId = b.epochId;
  b.reserve += p.mint; b.supply += p.mint; b.mintedThisRound += p.mint;
  b.events.push({ t: "policy", policy: { ...p } });
  return null;
}

/** DAO-owned: impeach the chair by naming a new chair account. */
export function setChair(b: Bank, caller: string, chair: string): string | null {
  if (caller !== b.owner) return "only the owner (the holders' DAO) can replace the chair";
  b.chair = chair;
  return null;
}

// ------------------------------------------------------------------ time

/**
 * One epoch passes. `shockPermille` is the share of the loan book written off this epoch (0 most epochs); the contract
 * draws it from the block's random seed, the simulation from its RNG, so parity tests pass it in explicitly.
 * After a collapse it runs the bailout and opens the next round instead.
 */
export function advanceEpoch(b: Bank, shockPermille = 0n): void {
  if (b.collapsed) {
    const minted = capped(b, (b.liabilitiesAtCollapse * BANK.bailoutPermille) / 1000n);
    b.reserve += minted; b.supply += minted;
    b.collapsed = false; b.round += 1; b.epoch = 0; b.epochId += 1;
    b.policy = { ...DEFAULT_POLICY, tone: "calm", statement: "", attestation: "" };
    b.mintedThisRound = 0n; b.roundStartSupply = b.supply; b.outflow = 0n;
    b.events.push({ t: "bailout", round: b.round, minted });
    return;
  }
  if (shockPermille > 0n) {
    const lost = (b.loans * shockPermille) / 1000n;
    b.loans -= lost; b.supply -= lost;
    b.events.push({ t: "writedown", permille: shockPermille, amount: lost });
  }
  const yieldAmt = capped(b, (b.loans * BANK.loanYieldBps) / 10000n);
  b.loans += yieldAmt; b.supply += yieldAmt;
  b.index += (b.index * b.policy.rate) / 10000n;
  const repaid = (b.loans * BANK.repayBps) / 10000n;
  b.loans -= repaid; b.reserve += repaid;
  const tgt = (liabilities(b) * b.policy.target) / 1000n;
  if (b.reserve > tgt) { const lend = b.reserve - tgt; b.reserve -= lend; b.loans += lend; }
  b.epochId += 1; b.epoch += 1; b.outflow = 0n;
  if (b.epoch >= BANK.epochsPerRound) {
    b.events.push({ t: "round_end", round: b.round, survived: true });
    b.round += 1; b.epoch = 0; b.mintedThisRound = 0n; b.roundStartSupply = b.supply;
  }
  b.events.push({ t: "epoch", epochId: b.epochId, round: b.round, epoch: b.epoch });
}
