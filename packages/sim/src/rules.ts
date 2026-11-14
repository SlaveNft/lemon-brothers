/**
 * Every number of the game in one place. RULES.md explains each one; contracts/bank-core/src/lib.rs has the same
 * constants (the parity test fails if they drift).
 */
export const SCALE = 10n ** 12n;

export const BANK = {
  loanYieldBps: 60n,          // loans earn 0.60% per epoch, minted
  repayBps: 500n,             // 5% of loans flow back to the reserve each epoch
  haircutPermille: 400n,      // fire sales lose 40% to the vulture fund (burned)
  epochsPerRound: 10,
  bailoutPermille: 200n,      // after a collapse, 20% of the old liabilities is minted into a fresh reserve
  /** Loan defaults: each epoch, with this chance, a share of the loan book is written off (burned) and it is news. */
  shockChancePermille: 150, shockMin: 30, shockMax: 150,
  airdrop: 1000n,
  lobbyFee: 10n,
  rumorFee: 25n,
  maxSpeechesPerEpoch: 20,
  maxSpeechesPerAccount: 2,   // per epoch: one account cannot fill the chair's reading list alone
  maxRumorsPerAccount: 2,     // per epoch
  maxRumorsPerEpoch: 20,      // the chair reads every rumour of the epoch: keep its prompt (and the state) bounded
  maxTextBytes: 280,
  maxAttestationBytes: 200,
  insureMin: 10n,
  insureMax: 500n,            // per account per round
  insureLastEpoch: 6,         // insurance can be bought in epochs 0..6
  insurePayout: 3n,           // a collapse pays 3 x premium, minted
  maxSupplyPermille: 1250n,   // a new bank's ceiling: its opening supply plus a quarter; no mint of any kind goes past it
} as const;

export const POLICY_BOUNDS = {
  rateMax: 300n, rateStep: 75n,
  targetMin: 100n, targetMax: 800n, targetStep: 150n,
  mintEpochPermille: 50n,     // per epoch, of current supply
  mintRoundPermille: 150n,    // per round, of the round's starting supply
  gateMin: 100n,              // a gate is 0 (off) or at least this many LEMON per account per epoch
} as const;

export const DEFAULT_POLICY = { rate: 40n, target: 200n, mint: 0n, gate: 0n } as const;

export const TONES = ["calm", "confident", "cautious", "alarming"] as const;
export type Tone = (typeof TONES)[number];

export const RUMORS = ["vault_empty", "chair_resigning", "bailout_coming"] as const;
export type RumorKind = (typeof RUMORS)[number];

/** Agent panic model (off chain). Values are panic points on a 0..1000 scale. */
export const AGENT = {
  count: 60,
  panicStartMin: 50, panicStartSpan: 200,
  thresholdMin: 350, thresholdSpan: 550,
  timeCalm: -20,
  /** Extra calm for an agent whose money is all out of the bank: nothing left to lose there. */
  cashCalm: -30,
  tone: { calm: -40, confident: -30, cautious: 20, alarming: 120 } as Record<Tone, number>,
  credibilityStart: 1000, credibilityLiePenalty: 200, credibilityFloor: 200, credibilityRecover: 50,
  /** Calm words count as a lie only when outflow rises above this (permille of deposits); life events alone stay below. */
  credibilityLieOutflowPermille: 60,
  rateHikeThresholdBps: 50, rateHikePanic: 60,
  gatePanic: 150,
  mintCalm: -40, mintInflationWorry: 20, mintWorryHunger: 600,
  targetRaised: -30,
  outflowPerPermille: 1, outflowCap: 250,
  friendRan: 90, friendRanCap: 300,
  lowReservePermille: 100, lowReservePanic: 100,
  rumor: 150,
  /** Players' public speeches, as the town hears them (the chair hears them separately). */
  speechStakeFull: 1000,      // a speaker with this much LEMON deposited speaks with full weight; nothing deposited, no weight
  speechCalm: 60, // "stay calm" at full weight, scaled by how much the agent listens (0.5..1.0)
  speechAlarm: 80, // "get out", scaled by gullibility; an outsider's alarm counts half
  speechHypocrite: 40, // "stay calm" from someone insured against the bank this round: panic goes up
  speechCap: 90, // per agent per epoch, per side (calming / alarming)
  /** Panic per permille of the loan book written off, as the agents read it in the news. */
  writedownPerPermille: 3,
  /** Each epoch an agent may need cash for life (rent, a car): it withdraws part of its deposit. */
  lifeEventPermille: 30, lifeShareMin: 300, lifeShareMax: 700,
  /** Daily mood noise: news, weather, the neighbour's new car. */
  noise: 40,
  depositRateMinBps: 60,
  /** Panic kept above each agent's temperament after a bailout (the town is scarred, but the new money calms it). */
  bailoutPanicKeepPermille: 650,
  /** After a bailout the chair's credibility is at least this (fresh money behind a fresh promise). */
  bailoutCredibility: 500,
  /** Panic kept when a round ends with the bank standing (the weekend calms the town). */
  roundPanicKeepPermille: 400,
} as const;
