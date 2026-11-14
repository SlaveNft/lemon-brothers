import { describe, expect, it } from "vitest";
import { GUEST_KEY, callBank, createGuest, loadGuest, randomKey, type Guest, type GuestEnv, type GuestNet } from "../src/chain/guest";
import { PUBLIC_GUEST, isGuestId, isPublicGuest, storedGuestId } from "../src/chain/bankView";
import published from "../src/chain/publicGuest.json";

function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const SHARED: Guest = { accountId: "guest.lemonbank-96b0974e.testnet", secretKey: "ed25519:published-on-purpose" };
function env(createAccount: GuestNet["createAccount"], publicGuest: Guest | null, sent: Array<{ who: string; method: string }> = []): GuestEnv {
  return {
    net: { createAccount, accountExists: async () => true, call: async (g, method) => { sent.push({ who: g.accountId, method }); return { txHash: "HASH", status: { SuccessValue: "" } }; } },
    storage: memory(), newKey: randomKey, suffix: () => "abc00001", sleep: async () => {}, publicGuest,
  };
}

describe("the shared public guest: a fallback for when the faucet refuses", () => {
  it("is used when the faucet rate-limits, is down, or cannot be reached", async () => {
    for (const faucet of [
      async () => ({ status: 429, text: "Rate limit exceeded, retry in 2 hours." }),
      async () => ({ status: 503, text: "maintenance" }),
      async () => { throw new TypeError("Failed to fetch"); },
    ] as Array<GuestNet["createAccount"]>) {
      const e = env(faucet, SHARED);
      expect(await createGuest(e)).toEqual(SHARED);
      expect(JSON.parse(e.storage!.getItem(GUEST_KEY)!)).toEqual(SHARED); // kept, so the page does not ask the faucet again
    }
  });

  it("is not used while the faucet works: every visitor gets an account of their own", async () => {
    const g = await createGuest(env(async () => ({ status: 200, text: "" }), SHARED));
    expect(g.accountId).toBe("lemon-guest-abc00001.testnet");
  });

  it("without one configured, a faucet refusal is still the plain error", async () => {
    await expect(createGuest(env(async () => ({ status: 429, text: "" }), null))).rejects.toMatchObject({ code: "helper-busy" });
  });

  it("a call goes out under the shared account when the faucet refused", async () => {
    const sent: Array<{ who: string; method: string }> = [];
    const out = await callBank("deposit", { amount: "500" }, { env: env(async () => ({ status: 429, text: "" }), SHARED, sent) });
    expect(out).toMatchObject({ ok: true, accountId: SHARED.accountId });
    expect(sent).toEqual([{ who: SHARED.accountId, method: "deposit" }]);
  });

  it("the published file names a sub-account of the bank and only player methods; nothing else may be signed for", () => {
    expect(published.accountId).toBe(`guest.${published.contract}`);
    expect(published.secretKey.startsWith("ed25519:")).toBe(true);
    expect(published.note).toMatch(/PUBLIC ON PURPOSE/);
    expect([...published.methods].sort()).toEqual(["advance_epoch", "airdrop", "deposit", "insure", "lobby", "rumor", "settle", "submit_run", "withdraw", "withdraw_all"]);
    expect(PUBLIC_GUEST?.accountId).toBe(published.accountId);
    expect(isPublicGuest(published.accountId)).toBe(true);
    expect(isGuestId("lemon-guest-0123abcd.testnet")).toBe(true);
    // an arbitrary account written into storage is not accepted as a guest
    for (const bad of ["alice.testnet", `evil.${published.contract}`, published.contract]) {
      expect(isGuestId(bad)).toBe(false);
      const s = memory({ [GUEST_KEY]: JSON.stringify({ accountId: bad, secretKey: "ed25519:x" }) });
      expect(storedGuestId(s)).toBeNull();
      expect(loadGuest(s)).toBeNull();
    }
    const s = memory({ [GUEST_KEY]: JSON.stringify(PUBLIC_GUEST) });
    expect(storedGuestId(s)).toBe(published.accountId);
  });
});
