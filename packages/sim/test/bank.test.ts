import { describe, expect, it } from "vitest";
import {
  BANK, SCALE, advanceEpoch, airdrop, checkPolicy, deposit, insure, liabilities, lobby, mintRoom, newBank, rumor, setChair, setPolicy,
  sumWallets, valueOf, withdraw, withdrawAll, type Bank, type PolicyInput,
} from "../src";

const conserved = (b: Bank) => expect(b.supply).toBe(sumWallets(b) + b.reserve + b.loans);
const pol = (over: Partial<PolicyInput> = {}): PolicyInput => ({ rate: 40n, target: 200n, mint: 0n, gate: 0n, tone: "calm", statement: "", attestation: "", ...over });

function bankWith(...deps: Array<[string, bigint]>): Bank {
  const b = newBank("dao", "chair", deps);
  for (const [who, amt] of deps) expect(deposit(b, who, amt)).toBeNull();
  return b;
}

describe("bank", () => {
  it("deposit and withdraw round-trip, supply conserved", () => {
    const b = bankWith(["a", 1000n], ["b", 3000n]);
    expect(liabilities(b)).toBe(4000n);
    expect(withdraw(b, "a", 400n)).toBeNull();
    expect(valueOf(b, "a")).toBe(600n);
    conserved(b);
  });

  it("an epoch lends the excess and pays interest", () => {
    const b = bankWith(["a", 10_000n]);
    advanceEpoch(b);
    expect(b.index).toBe(SCALE + (SCALE * 40n) / 10000n);
    expect(valueOf(b, "a")).toBe(10_040n);
    expect(b.reserve).toBe((liabilities(b) * 200n) / 1000n);
    conserved(b);
  });

  it("a withdrawal above the reserve fire-sells loans and burns the haircut", () => {
    const b = bankWith(["a", 5000n], ["b", 5000n]);
    advanceEpoch(b);
    const supply = b.supply;
    expect(withdrawAll(b, "a")).toBeNull();
    const ev = b.events.find((e) => e.t === "withdraw" && e.who === "a");
    expect(ev && ev.t === "withdraw" && ev.burned > 0n).toBe(true);
    expect(b.supply < supply).toBe(true);
    conserved(b);
  });

  it("a run that exhausts loans collapses the bank, settles everyone pro rata and pays insurance", () => {
    const b = bankWith(["a", 5000n], ["b", 5000n], ["c", 1000n]);
    b.accounts.get("c")!.wallet += 200n; b.supply += 200n;
    expect(insure(b, "c", 100n)).toBeNull();
    for (let i = 0; i < 3; i++) advanceEpoch(b);
    expect(withdrawAll(b, "a")).toBeNull();
    expect(b.collapsed).toBe(false);
    expect(withdrawAll(b, "b")).toBeNull();
    expect(b.collapsed).toBe(true);
    expect(b.totalShares).toBe(0n);
    expect(b.accounts.get("c")!.wallet >= 500n).toBe(true); // insurance 5 x 100
    conserved(b);
    advanceEpoch(b); // bailout
    expect(b.collapsed).toBe(false);
    expect(b.round).toBe(1);
    expect(b.reserve > 0n).toBe(true);
    conserved(b);
  });

  it("the gate caps withdrawals per epoch", () => {
    const b = bankWith(["a", 5000n]);
    b.policy.gate = 300n;
    expect(withdraw(b, "a", 1000n)).toBeNull();
    expect(b.accounts.get("a")!.wallet).toBe(300n);
    expect(withdraw(b, "a", 10n)).toMatch(/gate/);
    advanceEpoch(b);
    expect(withdraw(b, "a", 1000n)).toBeNull();
    expect(b.accounts.get("a")!.wallet).toBe(600n);
  });

  it("fees burn, airdrop once, insurance limits", () => {
    const b = newBank("dao", "chair");
    expect(airdrop(b, "p")).toBeNull();
    expect(airdrop(b, "p")).toMatch(/already/);
    expect(lobby(b, "p", "lower rates")).toBeNull();
    expect(rumor(b, "p", "vault_empty")).toBeNull();
    expect(b.supply).toBe(BANK.airdrop - BANK.lobbyFee - BANK.rumorFee);
    expect(insure(b, "p", 600n)).toMatch(/at most/);
    conserved(b);
  });
});

describe("limits per account", () => {
  const crowd = (n: number) => newBank("dao", "chair", Array.from({ length: n }, (_, i) => [`r${i}`, 1000n] as [string, bigint]));

  it("one account gets at most 2 speeches and 2 rumours per epoch; refused ones cost nothing", () => {
    const b = crowd(2), supply = b.supply;
    for (let i = 0; i < BANK.maxSpeechesPerAccount; i++) expect(lobby(b, "r0", "print more")).toBeNull();
    expect(lobby(b, "r0", "print more")).toBe("at most 2 speeches per account per epoch");
    for (let i = 0; i < BANK.maxRumorsPerAccount; i++) expect(rumor(b, "r0", "vault_empty")).toBeNull();
    expect(rumor(b, "r0", "bailout_coming")).toBe("at most 2 rumours per account per epoch");
    expect(b.supply).toBe(supply - 2n * BANK.lobbyFee - 2n * BANK.rumorFee);
    expect(lobby(b, "r1", "hold the line")).toBeNull();
    expect(rumor(b, "r1", "vault_empty")).toBeNull();
    advanceEpoch(b);
    expect(lobby(b, "r0", "print more")).toBeNull();
    expect(rumor(b, "r0", "vault_empty")).toBeNull();
    conserved(b);
  });

  it("the epoch's total caps still hold across accounts", () => {
    const n = BANK.maxRumorsPerEpoch / BANK.maxRumorsPerAccount;
    const b = crowd(n + 1);
    for (let i = 0; i < BANK.maxRumorsPerEpoch; i++) expect(rumor(b, `r${Math.floor(i / BANK.maxRumorsPerAccount)}`, "vault_empty")).toBeNull();
    expect(rumor(b, `r${n}`, "vault_empty")).toBe("the town has heard enough rumours this epoch");
    for (let i = 0; i < BANK.maxSpeechesPerEpoch; i++) expect(lobby(b, `r${Math.floor(i / BANK.maxSpeechesPerAccount)}`, "hi")).toBeNull();
    expect(lobby(b, `r${n}`, "hi")).toBe("the chair takes no more speeches this epoch");
  });

  it("insurance is capped per round, whatever the premium", () => {
    const b = crowd(1);
    expect(insure(b, "r0", 400n)).toBeNull();
    expect(insure(b, "r0", 2n ** 128n - 1n)).toBe("at most 500 LEMON of insurance per round");
    expect(insure(b, "r0", 101n)).toBe("at most 500 LEMON of insurance per round");
    expect(insure(b, "r0", 100n)).toBeNull();
    expect(b.accounts.get("r0")!.insured).toBe(500n);
    conserved(b);
  });
});

describe("the chair's capped key", () => {
  const b = () => bankWith(["a", 10_000n]);
  it("only the chair, once per epoch", () => {
    const x = b();
    expect(setPolicy(x, "mallory", pol())).toMatch(/only the chair/);
    expect(setPolicy(x, "chair", pol({ rate: 60n }))).toBeNull();
    expect(setPolicy(x, "chair", pol({ rate: 60n }))).toMatch(/already set/);
  });
  it("rejects every out-of-bounds field and changes nothing", () => {
    const x = b();
    const supply = x.supply;
    expect(checkPolicy(x, "chair", pol({ rate: 301n }))).toMatch(/outside/);
    expect(checkPolicy(x, "chair", pol({ rate: 200n }))).toMatch(/more than 75/);
    expect(checkPolicy(x, "chair", pol({ target: 50n }))).toMatch(/outside/);
    expect(checkPolicy(x, "chair", pol({ target: 400n }))).toMatch(/more than 150/);
    expect(checkPolicy(x, "chair", pol({ mint: supply / 2n }))).toMatch(/above 5%/);
    expect(checkPolicy(x, "chair", pol({ gate: 50n }))).toMatch(/gate/);
    expect(setPolicy(x, "chair", pol({ mint: supply / 2n }))).not.toBeNull();
    expect(x.supply).toBe(supply);
  });
  it("only the holders' DAO can replace the chair", () => {
    const x = b();
    expect(setChair(x, "chair", "me")).toMatch(/only the owner/);
    expect(setChair(x, "dao", "chair-2")).toBeNull();
    expect(x.chair).toBe("chair-2");
  });
});

describe("the ceiling: no mint of any kind lifts the supply above it", () => {
  const town = () => { const b = newBank("dao", "chair", [["a", 10_000n]]); deposit(b, "a", 10_000n); return b; };

  it("is a new bank's opening supply plus a quarter", () => {
    expect(town().maxSupply).toBe(12_500n);
    expect(mintRoom(town())).toBe(2_500n);
  });

  it("stops the loan yield, the chair's print and a newcomer's airdrop, and lets them back in after a burn", () => {
    const b = town();
    b.maxSupply = b.supply + 30n;
    for (let i = 0; i < 3; i++) advanceEpoch(b);
    expect(b.supply).toBe(b.maxSupply); // the yield filled the room and stopped
    expect(setPolicy(b, "chair", { rate: 40n, target: 200n, mint: 1n, gate: 0n, tone: "calm", statement: "", attestation: "" })).toMatch(/the bank's ceiling is/);
    expect(airdrop(b, "newcomer")).toMatch(/airdrop refused/);
    expect(b.accounts.has("newcomer")).toBe(false);
    advanceEpoch(b, 100n); // a tenth of the loans is written off: that burns
    const afterBurn = b.supply;
    expect(afterBurn).toBeLessThan(b.maxSupply);
    advanceEpoch(b);
    expect(b.supply).toBeGreaterThan(afterBurn);
    expect(b.supply).toBeLessThanOrEqual(b.maxSupply);
  });

  it("holds through a thousand random days, runs and rescues", () => {
    const b = newBank("dao", "chair", Array.from({ length: 20 }, (_, i) => [`d${i}`, 1000n] as [string, bigint]));
    for (let i = 0; i < 20; i++) deposit(b, `d${i}`, 1000n);
    let x = 12345;
    const rnd = (n: number) => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x % n; };
    for (let step = 0; step < 1000; step++) {
      const who = `d${rnd(20)}`;
      switch (rnd(6)) {
        case 0: withdrawAll(b, who); break;
        case 1: deposit(b, who, BigInt(1 + rnd(500))); break;
        case 2: airdrop(b, `n${step}`); break;
        case 3: setPolicy(b, "chair", { rate: 40n, target: 200n, mint: BigInt(rnd(600)), gate: 0n, tone: "calm", statement: "", attestation: "" }); break;
        default: advanceEpoch(b, rnd(7) === 0 ? BigInt(30 + rnd(120)) : 0n);
      }
      expect(b.supply).toBeLessThanOrEqual(b.maxSupply);
    }
  });

  it("leaves a bank without a ceiling exactly as it was", () => {
    const b = town();
    b.maxSupply = 0n;
    expect(mintRoom(b)).toBe(null);
    for (let i = 0; i < 40; i++) expect(airdrop(b, `n${i}`)).toBe(null);
    expect(b.supply).toBe(50_000n);
  });
});
