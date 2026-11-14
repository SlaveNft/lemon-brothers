/**
 * Where the town lives. `RemoteDriver` talks to the local runner (live chair, shared town); `LocalDriver` runs the same
 * simulation in the browser with the deterministic chair, so the page works with no server at all.
 */
import {
  airdrop, applyPlayer, createWorld, impeachmentVote, playRecordedDay, recordedWorld, stepEpoch, view,
  type Persona, type PlayerAction, type RecordedRun, type World, type WorldView,
} from "@chair/sim";
import savedRun from "../../../data/minds-runs/minds-2026-11-14T10-47-00-465Z.json";
import { tr } from "./lang";

/** A player action without the player (distributes over the union). */
export type Act = PlayerAction extends infer T ? (T extends unknown ? Omit<T, "who"> : never) : never;
export type Vote = { passed: boolean; yes: number; no: number; turnout: number };

export interface Driver {
  mode: "live" | "local";
  /** Throws when the town cannot be read (the runner is down or answers garbage). */
  state(): Promise<WorldView & { lastChair?: unknown }>;
  /** These never throw: an error comes back as a message for the player, null means done. */
  join(who: string): Promise<string | null>;
  act(who: string, a: Act): Promise<string | null>;
  impeach(who: string, persona: Persona): Promise<Vote | string>;
  ff(epochs: number): Promise<string | null>;
  setEpochSeconds?(s: number): void;
  /** Set when the town is a saved run being played back: where it is, and how to start it again. */
  replay?: { day(): number; days: number; run: RecordedRun; restart(): void };
  /** Stop timers. A disposed driver is not used again. */
  dispose(): void;
}

export class LocalDriver implements Driver {
  mode = "local" as const;
  w: World;
  players = new Set<string>();
  epochMs = 15_000;
  next = Date.now() + this.epochMs;
  private timer: ReturnType<typeof setInterval> | null;
  constructor(seed = Math.floor(Math.random() * 1e9)) {
    // ?chair=hawk|populist starts with another chair; ?seed=N replays a town
    const q = new URLSearchParams(location.search);
    const persona = (["dove", "hawk", "populist"].includes(q.get("chair") ?? "") ? q.get("chair") : "dove") as Persona;
    this.w = createWorld(Number(q.get("seed")) || seed, persona);
    this.timer = setInterval(() => { if (this.epochMs > 0 && Date.now() >= this.next) { stepEpoch(this.w); this.next = Date.now() + this.epochMs; } }, 200);
  }
  dispose() { if (this.timer !== null) clearInterval(this.timer); this.timer = null; }
  setEpochSeconds(s: number) { this.epochMs = s * 1000; this.next = Date.now() + this.epochMs; }
  async state() {
    const running = this.epochMs > 0;
    return view(this.w, { players: [...this.players], chairMode: "browser simulation, deterministic chair", nextTickMs: running ? this.next - Date.now() : null, epochMs: running ? this.epochMs : null });
  }
  async join(who: string) { if (this.players.has(who)) return null; const e = airdrop(this.w.bank, who); if (!e) this.players.add(who); return e; }
  async act(who: string, a: Act) { return applyPlayer(this.w, { ...a, who } as PlayerAction); }
  async impeach(who: string, persona: Persona) { return impeachmentVote(this.w, persona, { [who]: true }); }
  async ff(epochs: number) { for (let i = 0; i < epochs; i++) stepEpoch(this.w); this.next = Date.now() + this.epochMs; return null; }
}

/**
 * A run that really happened, played back: the saved choices and words of the AI depositors are fed to the same
 * simulation, one saved day every few seconds, and it rebuilds the town as it was (packages/sim/src/recorded.ts; a
 * test checks every rebuilt day against the saved one). Nothing can be changed in it.
 */
export class ReplayDriver implements Driver {
  mode = "local" as const;
  private run = savedRun as unknown as RecordedRun;
  private w: World = recordedWorld(this.run);
  private at = 0;
  private epochMs = 4000;
  private next = Date.now() + 2500;
  private timer: ReturnType<typeof setInterval> | null;
  constructor() { this.timer = setInterval(() => { if (this.epochMs > 0 && Date.now() >= this.next) this.step(); }, 200); }
  private step() { if (this.at < this.run.log.length) { playRecordedDay(this.w, this.run.log[this.at]); this.at++; } this.next = Date.now() + this.epochMs; }
  private notHere = tr("This is a recording of a run that already happened; nothing can be changed in it.", "Это запись прогона, который уже состоялся: изменить в нём ничего нельзя.");
  replay = { day: () => this.at, days: this.run.log.length, run: this.run, restart: () => { this.w = recordedWorld(this.run); this.at = 0; this.next = Date.now() + 1500; } };
  dispose() { if (this.timer !== null) clearInterval(this.timer); this.timer = null; }
  setEpochSeconds(s: number) { this.epochMs = s * 1000; this.next = Date.now() + this.epochMs; }
  async state() {
    const going = this.epochMs > 0 && this.at < this.run.log.length;
    return view(this.w, { players: [], chairMode: `recorded run: seed ${this.run.seed}, rule-based ${this.run.persona} chair, ${this.run.depositors.length} AI depositors (${this.run.model ?? "no model"})`, nextTickMs: going ? this.next - Date.now() : null, epochMs: going ? this.epochMs : null });
  }
  async join() { return null; }
  async act() { return this.notHere; }
  async impeach() { return this.notHere; }
  async ff(epochs: number) { for (let i = 0; i < epochs; i++) this.step(); return null; }
}

type Reply = Record<string, unknown> & { error?: string };

export class RemoteDriver implements Driver {
  mode = "live" as const;
  dispose() { /* nothing to stop: the town lives in the runner */ }

  /** POST and read the answer. Never throws: a dead runner or a non-JSON answer becomes `{ error }`. */
  private async post(path: string, body: unknown): Promise<Reply> {
    let r: Response;
    try {
      r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    } catch {
      return { error: tr("the runner is not answering", "раннер не отвечает") };
    }
    let j: unknown = null;
    try { j = JSON.parse(await r.text()); } catch { /* not JSON: a proxy error page, an empty body */ }
    if (j === null || typeof j !== "object" || Array.isArray(j)) return { error: tr(`the runner answered ${r.status} without JSON`, `раннер ответил ${r.status} без JSON`) };
    const o = j as Reply;
    if (typeof o.error === "string" && o.error) return o;
    if (!r.ok) return { ...o, error: tr(`the runner answered ${r.status}`, `раннер ответил ${r.status}`) };
    return { ...o, error: undefined };
  }

  /** A runner that restarted has forgotten its players ("join first"): join again and repeat the request once. */
  private async asPlayer(who: string, path: string, body: unknown): Promise<Reply> {
    const j = await this.post(path, body);
    if (j.error !== "join first") return j;
    const joined = await this.join(who);
    return joined ? { error: joined } : this.post(path, body);
  }

  async state() {
    const r = await fetch("/api/state", { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    if (!j || typeof j !== "object" || !Array.isArray(j.agents) || !Array.isArray(j.players)) throw new Error("not a town state");
    return j as WorldView & { lastChair?: unknown };
  }
  async join(who: string) { return (await this.post("/api/join", { who })).error ?? null; }
  async act(who: string, a: Act) { return (await this.asPlayer(who, "/api/act", { ...a, who })).error ?? null; }
  async impeach(who: string, persona: Persona) {
    const j = await this.asPlayer(who, "/api/impeach", { who, persona });
    if (j.error) return j.error;
    return typeof j.passed === "boolean" ? { passed: j.passed, yes: Number(j.yes) || 0, no: Number(j.no) || 0, turnout: Number(j.turnout) || 0 } : tr("the runner sent no vote result", "раннер не прислал итог голосования");
  }
  async ff(epochs: number) { return (await this.post("/api/ff", { epochs })).error ?? null; }
}

/** Live if the runner answers, local otherwise. `?local` forces the browser simulation. */
export async function pickDriver(): Promise<Driver> {
  if (new URLSearchParams(location.search).get("replay") === "minds") return new ReplayDriver();
  if (!new URLSearchParams(location.search).has("local")) {
    try {
      const r = await fetch("/api/state", { signal: AbortSignal.timeout(1500) });
      if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) return new RemoteDriver();
    } catch { /* no runner: play in the browser */ }
  }
  return new LocalDriver();
}
