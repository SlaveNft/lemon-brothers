import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { playRecordedDay, recordedWorld, type RecordedRun } from "../src";

const dir = new URL("../../../data/minds-runs/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("a saved run with AI depositors plays back to the same days", () => {
  it("has at least one saved run in the repository", () => { expect(files.length).toBeGreaterThan(0); });

  for (const f of files) it(`${f}: every rebuilt day has the saved number of runners and the saved fall`, () => {
    const run = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as RecordedRun;
    const w = recordedWorld(run);
    let fell = 0;
    for (const d of run.log) {
      const vault = Number(w.bank.reserve);
      playRecordedDay(w, d);
      if (d.bailout) continue;
      const snap = w.history[w.history.length - 1];
      expect(vault).toBe(d.vault);
      expect(snap.ran).toBe(d.ran);
      expect(w.bank.collapsed).toBe(!!d.fell);
      if (d.fell) fell++;
      for (const m of d.moves ?? []) expect(w.agents.find((a) => a.id === m.id)?.mind?.model).toBe(m.model);
    }
    expect(fell).toBe(run.log.filter((d) => d.fell).length);
  });
});
