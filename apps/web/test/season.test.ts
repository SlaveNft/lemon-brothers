import { describe, expect, it } from "vitest";
import { rankHolders, roundInfo, type DepositorRow } from "../src/chain/season";
import type { ChainState } from "../src/chain/rpc";

const BANK = "lemonbank-96b0974e.testnet";
const state = (over: Partial<ChainState>): ChainState => ({ epoch: 3, round: 1, collapsed: false, credibility: 850, ...over } as ChainState);

describe("the real bank's round", () => {
  it("counts rounds and days as people do", () => {
    expect(roundInfo(state({}))).toEqual({ round: 2, day: 4, left: 6, collapsed: false, trust: 850 });
    expect(roundInfo(state({ epoch: 9 })).left).toBe(0);
    expect(roundInfo(state({ epoch: 0, round: 0 })).round).toBe(1);
  });

  it("shows trust only when the contract reports it, within 0..1000", () => {
    expect(roundInfo(state({ credibility: undefined })).trust).toBeNull();
    expect(roundInfo(state({ credibility: 5000 })).trust).toBe(1000);
  });
});

describe("who holds the most $LEMON", () => {
  const rows: DepositorRow[] = [
    [`agent-01.${BANK}`, "100", "900", "0"],
    [`crowd.${BANK}`, "50000", "90000", "0"],
    [BANK, "5", "0", "0"],
    ["alice.testnet", "1000", "0", "0"],
    ["bob.testnet", "0", "0", "300"],
    ["empty.testnet", "0", "0", "0"],
    ["me.testnet", "10", "0", "0"],
  ];

  it("ranks by wallet + deposit + what a collapse owes, without the crowd omnibus and the contract", () => {
    const b = rankHolders(rows, BANK, "me.testnet");
    expect(b.top.map((h) => [h.id, h.total, h.kind])).toEqual([
      [`agent-01.${BANK}`, 1000n, "agent"],
      ["alice.testnet", 1000n, "player"],
      ["bob.testnet", 300n, "player"],
      ["me.testnet", 10n, "you"],
    ]);
    expect(b.you).toEqual({ rank: 4, holder: { id: "me.testnet", kind: "you", wallet: 10n, deposit: 0n, total: 10n } });
    expect(b.players).toBe(4);
  });

  it("finds the visitor below the top", () => {
    const b = rankHolders(rows, BANK, "me.testnet", 2);
    expect(b.top).toHaveLength(2);
    expect(b.you?.rank).toBe(4);
  });

  it("keeps a visitor with nothing yet, and ignores malformed rows", () => {
    const b = rankHolders([...rows, ["new.testnet", "0", "0", "0"], [42 as unknown as string, "1", "1", "1"]], BANK, "new.testnet");
    expect(b.you?.rank).toBe(5);
    expect(b.top.some((h) => h.id === "empty.testnet")).toBe(false);
    expect(rankHolders(rows, BANK, null).you).toBeNull();
  });
});
