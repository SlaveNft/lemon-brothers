/**
 * Playing back a run that really happened. `npm run minds` saves, for each day, what every AI depositor chose and
 * said. Everything else in that run was deterministic (the seed, the rule-based chair, the other depositors), so
 * feeding the saved moves back through `stepEpoch` rebuilds the same town day by day: the page can show the run as it
 * went, and a test can check that the rebuilt days match the saved ones.
 */
import type { Persona } from "./chair";
import { fallbackChair } from "./chair";
import type { MindMove } from "./minds";
import { createWorld, observe, stepEpoch, type PlayerAction, type World } from "./world";

export interface RecordedDay {
  day: number; bailout?: boolean; ran?: number | null; fell?: boolean; vault?: number; owed?: number;
  moves?: Array<{ id: string; name: string } & MindMove>;
}
export interface RecordedRun { seed: number; persona: Persona; days: number; model: string | null; depositors: Array<{ id: string; name: string; character: string }>; log: RecordedDay[] }

export const recordedWorld = (run: RecordedRun): World => createWorld(run.seed, run.persona);

/** Apply one saved day to the town: the bailout day, or the chair's rule plus the saved moves and public sentences. */
export function playRecordedDay(w: World, d: RecordedDay): void {
  if (d.bailout || !d.moves) { stepEpoch(w); return; }
  const chair = fallbackChair(observe(w), w.persona);
  const minds = new Map<string, MindMove>(d.moves.map((m) => [m.id, { choice: m.choice, why: m.why, say: m.say, model: m.model, source: m.source }]));
  const says: PlayerAction[] = d.moves.filter((m) => m.source === "model" && m.say).map((m) => ({ t: "lobby", who: m.id, text: m.say }));
  stepEpoch(w, says, chair, "", [], minds);
}
