import { describe, expect, it } from "vitest";
import { BANK, DEFAULT_POLICY, runCurve, runWhatIf } from "../src";

describe("what if N depositors run today (the page's slider)", () => {
  const curve = runCurve();
  const firstBurn = curve.findIndex((r) => r.burned > 0), fallAt = curve.findIndex((r) => r.fell);

  it("the vault pays the first runners in full and nothing burns", () => {
    const r0 = runWhatIf(0);
    expect(r0).toMatchObject({ burned: 0, printed: 0, fell: false, supplyAfter: r0.supplyBefore });
    // the reserve target decides how many the vault can pay: 20% of 60 depositors is 12
    expect(firstBurn - 1).toBe((60 * Number(DEFAULT_POLICY.target)) / 1000);
    for (let n = 0; n < firstBurn; n++) expect(curve[n].burned).toBe(0);
  });

  it("past the vault every runner is paid by dumping loans, and the haircut burns", () => {
    const a = curve[firstBurn], b = curve[firstBurn + 1];
    expect(a.burned).toBeGreaterThan(0);
    expect(b.burned - a.burned).toBe(a.burned); // the same loss for each extra runner
    // paying 1,004 from loans sold at 60% of their worth destroys the other 40%
    expect(a.burned).toBe(Math.ceil((a.owedEach * 1000) / (1000 - Number(BANK.haircutPermille))) - a.owedEach);
    for (let n = firstBurn; n < fallAt; n++) {
      expect(curve[n].supplyAfter).toBe(curve[n].supplyBefore - curve[n].burned);
      expect(curve[n].paidInFull).toBe(n);
      expect(curve[n].coverPermille).toBeLessThan(curve[n - 1].coverPermille);
    }
  });

  it("the bank falls, the late ones get almost nothing, and the rescue prints far less than what burned", () => {
    expect(fallAt).toBeGreaterThan(firstBurn);
    const f = curve[fallAt];
    expect(f.paidInFull).toBe(fallAt - 1);
    expect(f.lateGot).toBeLessThan(f.owedEach / 10);
    expect(f.printed).toBeGreaterThan(0);
    expect(f.burned).toBeGreaterThan(f.printed * 3);
    // the rescue is a fifth of what the bank still owed when it fell
    expect(f.printed).toBe(Math.floor(((60 - f.paidInFull) * f.owedEach * Number(BANK.bailoutPermille)) / 1000));
    expect(f.supplyAfter).toBe(f.supplyBefore - f.burned + f.printed);
    // more runners after the fall change nothing: the bank is already closed
    expect(curve[60]).toMatchObject({ burned: f.burned, printed: f.printed, supplyAfter: f.supplyAfter, paidInFull: f.paidInFull });
  });
});
