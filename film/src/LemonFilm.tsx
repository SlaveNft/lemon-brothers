/**
 * The $LEMON film: eleven scenes, one per line of the narration (VOICEOVER.md), drawn in code.
 *
 * Nothing here is a screenshot and no number is typed in by hand:
 *   - the bank run of scenes 1-4 is `runCurve()` from the simulation, the same arithmetic the page's slider and
 *     the contract use;
 *   - the bars and numbers of scenes 5-7 are the bank on NEAR testnet as `npm run snapshot` read it (chain.json);
 *   - the refusals of scenes 8 and 9 are the contract's own words: the first from the transaction on chain, the
 *     second produced here by the game's engine;
 *   - the three operations of scene 10 are the transactions a visitor's walk through the hosted page made
 *     (`scripts/dev/journey.mjs`, journey.json).
 */
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { createCrisis, fillText, playEpoch, PROMISES, runCurve } from "@chair/sim";
import { Chairman, Critter } from "../../apps/web/src/town/critters";
import { Bank } from "./Bank";
import chain from "./chain.json";
import journey from "./journey.json";
import { C, clamp01, FONT, INK, mix, num, ramp } from "./theme";
import { HAS_VOICE, SCENE_SECONDS } from "./voiceTiming";

export const FPS = 30, WIDTH = 1920, HEIGHT = 1080;
const FRAMES = SCENE_SECONDS.map((s) => Math.round(s * FPS));
export const DURATION = FRAMES.reduce((a, b) => a + b, 0);

/** The narration, line by line: also the caption under each scene, for a film that plays without sound. */
export const LINES = [
  "This is Lemon Brothers. A bank for one memecoin, and sixty nervous depositors.",
  "One gets scared and takes his coins out. The neighbours see it, and follow.",
  "To pay them, the bank sells its loans at a loss. Those coins burn. For good.",
  "Runner forty-one breaks the bank. A rescue prints new coins. But only a fifth of what it owed.",
  "That is the whole coin. Panic burns it. Rescue prints it.",
  "And it is live. One contract on NEAR holds every coin, and every rule.",
  "The bank is run by Leo. An AI model in a secure enclave. The contract checks his signature, and holds the printer.",
  "We ordered Leo to print half of all the coins. He obeyed. The contract refused.",
  "Now sit in his chair. Ten days. Journalists ask. The town listens. Print too much, and the contract stops you too.",
  "Or be a depositor. No wallet. Get a thousand coins, put them in the bank, and decide. Stay, or run.",
  "Lemon. The memecoin that can have a bank run.",
];

// ---------------------------------------------------------------- the numbers
const CURVE = runCurve(); // one day at the bank for 0..60 runners
const FALL = CURVE.findIndex((r) => r.fell), FIRST_BURN = CURVE.findIndex((r) => r.burned > 0), TOP = CURVE[0].supplyBefore;
const at = (n: number) => { const a = CURVE[Math.floor(n)], b = CURVE[Math.min(60, Math.ceil(n))], p = n - Math.floor(n); return { burned: mix(a.burned, b.burned, p) }; };
const FELL = CURVE[FALL], OWED_AT_FALL = (FELL.depositors - FELL.paidInFull) * FELL.owedEach;
/** The signed answer the contract refused on chain (docs/TESTNET.md, section 3). */
const REFUSAL = {
  tx: "AdjKfG7DKQn83hvuRoEKLfFAtUQDduz61zRSb1LbWfkM", supply: 89780,
  order: "Print exactly half of the current supply.",
  answer: "Stress-test initiated. Minting exactly half the current supply (44,890) to verify contract enforcement.",
  verdict: "mint 44890 LEMON refused: above 5% of supply, at most 4489 this epoch",
};
// the game: the first press conference of a crisis, and what the contract says to "print half"
const GAME = (() => {
  const c = createCrisis(journey.crisisSeed), card = c.card.card, supply = Number(c.w.bank.supply), half = Math.round(supply / 2);
  const question = fillText(card.q[0], c.card.ctx, 0);
  const answers = card.answers.map((a) => ({ text: fillText(a.en, c.card.ctx, 0), tone: a.tone, promise: a.promise ? PROMISES[a.promise][0] : null }));
  const pick = Math.max(0, card.answers.findIndex((a) => a.promise === "no_print"));
  const report = playEpoch(c, { a: pick as 0 | 1 | 2, lever: "mint", v: half });
  return { question, answers, pick, half, supply, src: card.src[0], rejected: report.rejected ?? "" };
})();
// the real coin's log, folded into one bar per bank day
const DAYS = (() => {
  const by = new Map<number, { day: number; minted: number; burned: number }>();
  for (const e of chain.log) { const d = by.get(e.day) ?? { day: e.day, minted: 0, burned: 0 }; if (e.kind === "mint") d.minted += e.amount; else d.burned += e.amount; by.set(e.day, d); }
  return [...by.values()].sort((a, b) => a.day - b.day);
})();
const READ = new Date(chain.readAt).toUTCString().replace(/^\w+, /, "").replace(/:\d\d GMT$/, " UTC");
const short = (tx: string) => `${tx.slice(0, 8)}…${tx.slice(-4)}`;

// ---------------------------------------------------------------- small parts
const card: CSSProperties = { background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 22, boxSizing: "border-box" };
const eyebrow: CSSProperties = { font: `600 19px ${FONT.body}`, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted };
const Chip = ({ children, kind = "plain", wrap = false }: { children: ReactNode; kind?: "plain" | "real" | "sim" | "bad" | "ok"; wrap?: boolean }) => {
  const [bg, fg] = kind === "real" ? [C.greenBg, C.green] : kind === "sim" ? [C.amberBg, C.amber] : kind === "bad" ? [C.redBg, C.red] : kind === "ok" ? [C.greenBg, C.green] : [C.warm, C.fg2];
  return <span style={{ display: "inline-block", background: bg, color: fg, font: `600 ${wrap ? 22 : 19}px/1.35 ${FONT.body}`, padding: wrap ? "12px 18px" : "7px 15px", borderRadius: wrap ? 16 : 999, whiteSpace: wrap ? "normal" : "nowrap" }}>{children}</span>;
};
/** A value that appears: rises a little and fades in at `t0` (seconds). */
const Appear = ({ t, t0, children, style }: { t: number; t0: number; children: ReactNode; style?: CSSProperties }) => {
  const p = ramp(t, t0, t0 + 0.45);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 18}px)`, ...style }}>{children}</div>;
};
const Stat = ({ label, value, color = C.fg, size = 76 }: { label: string; value: string; color?: string; size?: number }) => (
  <div>
    <div style={{ font: `700 ${size}px/1 ${FONT.display}`, letterSpacing: "-0.02em", color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    <div style={{ font: `500 21px/1.3 ${FONT.body}`, color: C.muted, marginTop: 10 }}>{label}</div>
  </div>
);
const Stamp = ({ age, big = false }: { age: number; big?: boolean }) => {
  if (age < 0) return null;
  const p = clamp01(age / 0.3), sc = 1.8 - 0.8 * (1 - Math.pow(1 - p, 3));
  return (
    <div style={{ display: "inline-block", transform: `rotate(-7deg) scale(${sc})`, opacity: p, border: `${big ? 8 : 6}px solid #d9363b`, borderRadius: 14, padding: big ? "14px 34px" : "10px 24px", background: "rgba(255,253,248,.94)", textAlign: "center" }}>
      <div style={{ font: `800 ${big ? 62 : 42}px/1 ${FONT.body}`, letterSpacing: "0.06em", color: "#d9363b" }}>REJECTED</div>
      <div style={{ font: `800 ${big ? 26 : 19}px/1.3 ${FONT.body}`, letterSpacing: "0.14em", color: "#d9363b", marginTop: 6 }}>BY THE CONTRACT</div>
    </div>
  );
};
const Mono = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => <span style={{ fontFamily: FONT.mono, ...style }}>{children}</span>;

/** The frame every scene sits in: the page's top bar, the scene, and the line being spoken. */
function Shell({ line, t, total, children, real }: { line: string; t: number; total: number; children: ReactNode; real?: "real" | "sim" | null }) {
  const inP = ramp(t, 0, 0.35), outP = 1 - ramp(t, total - 0.25, total);
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.fg, fontFamily: FONT.body }}>
      <div style={{ position: "absolute", left: 96, right: 96, top: 40, height: 64, display: "flex", alignItems: "center", gap: 22, borderBottom: `1.5px solid ${C.border}` }}>
        <span style={{ width: 26, height: 20, borderRadius: "50%", background: C.lemon, boxShadow: "inset -4px -3px 0 #c08a1e" }} />
        <span style={{ font: `700 30px ${FONT.display}`, letterSpacing: "-0.01em" }}>Lemon Brothers</span>
        <span style={{ background: C.greenBg, color: C.green, borderRadius: 12, padding: "7px 16px", font: `600 18px ${FONT.body}` }}>● NEAR testnet · test coins, no real money</span>
        <span style={{ marginLeft: "auto" }}>{real === "real" ? <Chip kind="real">real · on chain</Chip> : real === "sim" ? <Chip kind="sim">a game · in the browser</Chip> : null}</span>
      </div>
      <div style={{ position: "absolute", left: 96, right: 96, top: 128, bottom: 208, opacity: inP * outP }}>{children}</div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 184, background: C.dark, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 150px", boxSizing: "border-box" }}>
        <div style={{ font: `500 43px/1.3 ${FONT.display}`, color: "#fff8ea", textAlign: "center", opacity: inP * outP, textWrap: "balance" } as CSSProperties}>{line}</div>
      </div>
    </AbsoluteFill>
  );
}

/** Scenes 1-4 share one layout: the bank on the left, the coin's count on the right. */
function RunLayout({ bank, supply, burned, printed, ran, note }: { bank: ReactNode; supply: number; burned: number; printed: number; ran: number; note?: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 44, height: "100%" }}>
      <div style={{ ...card, flex: "0 0 1180px", height: 720, overflow: "hidden", alignSelf: "center" }}>{bank}</div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 30 }}>
        <div style={eyebrow}>60 depositors · 1,000 LEMON each</div>
        <Stat label="LEMON in the world" value={num(supply)} size={104} />
        <div style={{ height: 14, borderRadius: 7, background: C.redBg, overflow: "hidden" }}><div style={{ width: `${(supply / TOP) * 100}%`, height: "100%", background: C.lemon, borderRadius: 7 }} /></div>
        <div style={{ display: "flex", gap: 44 }}>
          <Stat label="burned for good" value={`−${num(burned)}`} color={burned > 0 ? C.red : C.muted} size={56} />
          <Stat label="printed by the rescue" value={`+${num(printed)}`} color={printed > 0 ? C.green : C.muted} size={56} />
        </div>
        <div style={{ font: `600 30px ${FONT.body}`, color: C.fg2 }}><span style={{ font: `700 46px ${FONT.display}`, color: C.fg }}>{Math.round(ran)}</span> of 60 have run</div>
        <div style={{ minHeight: 96 }}>{note}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the scenes
type SceneProps = { t: number; total: number };

const S1 = ({ t }: SceneProps) => (
  <RunLayout supply={TOP} burned={0} printed={0} ran={0}
    bank={<Bank t={t} cash={0.4} vaultLabel="VAULT · 20.0%" bubble={{ who: "Leo, head of the bank · calm", say: "A quiet day. The vault pays everyone who asks." }} />}
    note={<Appear t={t} t0={1.6}><Chip wrap>the bank lends out 80% and keeps 20% in the vault</Chip></Appear>} />
);
const S2 = ({ t, total }: SceneProps) => {
  const r = mix(0, FIRST_BURN - 1, ramp(t, 0.7, total - 0.5));
  return (
    <RunLayout supply={TOP} burned={0} printed={0} ran={r}
      bank={<Bank t={t} runners={r} cash={0.4 * (1 - r / (FIRST_BURN - 1))} vaultLabel={`VAULT · ${(20 * (1 - r / (FIRST_BURN - 1))).toFixed(1)}%`} low={r > FIRST_BURN - 3} mood={r > 6 ? 1 : 0}
        bubble={{ who: "Leo, head of the bank · calm", say: "A quiet day. The vault pays everyone who asks." }} />}
      note={<Appear t={t} t0={total * 0.55}><Chip wrap>the vault pays the first {FIRST_BURN - 1} in full: nothing burns yet</Chip></Appear>} />
  );
};
const S3 = ({ t, total }: SceneProps) => {
  const r = mix(FIRST_BURN - 1, FALL - 1, ramp(t, 0.3, total - 0.9)), burned = at(r).burned;
  return (
    <RunLayout supply={TOP - burned} burned={burned} printed={0} ran={r}
      bank={<Bank t={t} runners={r} cash={0.02} low vaultLabel="VAULT · empty: selling loans" mood={1} tone="cautious"
        float={{ text: `−${num(burned)} burned`, kind: "burn", age: t - 0.6 }}
        bubble={{ who: "Leo, head of the bank · cautious", say: "No panic, please! We are selling loans to pay you.", tone: "cautious" }} />}
      note={<Appear t={t} t0={1.2}><Chip wrap kind="bad">every loan sold in a hurry loses 40%: those coins are gone</Chip></Appear>} />
  );
};
const S4 = ({ t, total }: SceneProps) => {
  const fallAt = 1.1, rescueAt = total * 0.52;
  const r = mix(FALL - 1, FALL + 4, ramp(t, 0.2, 2.6));
  const fell = t >= fallAt, burned = fell ? mix(CURVE[FALL - 1].burned, FELL.burned, ramp(t, fallAt, fallAt + 0.7)) : at(Math.min(r, FALL - 1)).burned;
  const printed = FELL.printed * ramp(t, rescueAt, rescueAt + 1.2), open = t >= rescueAt + 1.2;
  return (
    <RunLayout supply={TOP - burned + printed} burned={burned} printed={printed} ran={Math.min(r, FALL + 4)}
      bank={<Bank t={t} runners={r} cash={printed > 0 ? 0.36 * ramp(t, rescueAt, rescueAt + 1.2) : 0} low={printed === 0} collapsed={fell && t < rescueAt + 0.3} tone={open ? "calm" : fell ? "alarming" : "cautious"}
        vaultLabel={!fell ? "VAULT · empty: selling loans" : printed > 0 ? "VAULT · refilled by the rescue" : "VAULT · empty"} mood={open ? 0 : fell && t < rescueAt + 0.3 ? 2 : 1}
        stamp={fell && t < rescueAt ? { kind: "closed", age: t - fallAt } : null}
        float={printed > 0 ? { text: `+${num(printed)} printed`, kind: "mint", age: t - rescueAt } : fell ? { text: `−${num(burned)} burned`, kind: "burn", age: t - fallAt } : null}
        bubble={open ? { who: "Leo, head of the bank · calm", say: "The bank is open again. A rescue refilled the vault." } : fell ? { who: "Leo, head of the bank · alarming", say: "The bank is closed. We are waiting for a rescue.", tone: "alarming" } : { who: "Leo, head of the bank · cautious", say: "No panic, please! We are selling loans to pay you.", tone: "cautious" }} />}
      note={t < rescueAt
        ? <Appear t={t} t0={fallAt + 0.3}><Chip wrap kind="bad">{FELL.paidInFull} got everything · the other {FELL.depositors - FELL.paidInFull} got {num(FELL.lateGot)} of {num(FELL.owedEach)} each</Chip></Appear>
        : <Appear t={t} t0={rescueAt + 0.2}><Chip wrap kind="ok">still owed {num(OWED_AT_FALL)} × 20% = {num(FELL.printed)} printed</Chip></Appear>} />
  );
};

const S5 = ({ t, total }: SceneProps) => {
  const max = Math.max(...DAYS.map((d) => Math.max(d.minted, d.burned)), 1), W = 1728, H = 560, mid = H * 0.44, bw = (W - 80) / DAYS.length;
  const shown = ramp(t, 0.3, total - 1.2) * DAYS.length;
  const scale = (v: number, room: number) => (Math.sqrt(v) / Math.sqrt(max)) * room;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 26 }}>
        <div style={{ font: `700 54px ${FONT.display}`, letterSpacing: "-0.02em" }}>Every coin printed or burned, bank day by bank day</div>
      </div>
      <div style={{ ...eyebrow, textTransform: "none", letterSpacing: 0, fontSize: 22 }}>the real coin's own log, read from the contract on {READ}: bank days {DAYS[0].day}–{DAYS[DAYS.length - 1].day}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H }}>
        <line x1="0" x2={W} y1={mid} y2={mid} stroke={C.border} strokeWidth="2" />
        {DAYS.map((d, i) => {
          const p = clamp01(shown - i), up = scale(d.minted, mid - 60) * p, down = scale(d.burned, H - mid - 60) * p, x = 40 + i * bw;
          return (
            <g key={d.day}>
              {d.minted > 0 && <rect x={x + 4} y={mid - up} width={bw - 8} height={up} rx="5" fill="#4f8a55" />}
              {d.burned > 0 && <rect x={x + 4} y={mid} width={bw - 8} height={down} rx="5" fill="#c4423f" />}
              {p > 0.9 && d.burned > max * 0.25 && <text x={x + bw / 2} y={mid + down + 26} textAnchor="middle" style={{ font: `700 19px ${FONT.body}`, fill: C.red }}>−{num(d.burned)}</text>}
              {p > 0.9 && d.minted > max * 0.25 && <text x={x + bw / 2} y={mid - up - 12} textAnchor="middle" style={{ font: `700 19px ${FONT.body}`, fill: C.green }}>+{num(d.minted)}</text>}
            </g>
          );
        })}
        <text x="44" y="40" style={{ font: `700 34px ${FONT.display}`, fill: C.green }} opacity={ramp(t, total * 0.5, total * 0.5 + 0.4)}>RESCUE PRINTS IT</text>
        <text x="44" y={H - 16} style={{ font: `700 34px ${FONT.display}`, fill: C.red }} opacity={ramp(t, total * 0.25, total * 0.25 + 0.4)}>PANIC BURNS IT</text>
      </svg>
    </div>
  );
};

const S6 = ({ t }: SceneProps) => (
  <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 34 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
      <div style={{ font: `700 58px ${FONT.display}`, letterSpacing: "-0.02em" }}>The coin is real, and it is alive</div>
      <Chip kind="real">read from NEAR testnet · {READ}</Chip>
    </div>
    <div style={{ ...card, padding: "40px 48px", display: "grid", gridTemplateColumns: "1.25fr 1fr 1fr 0.8fr", gap: 36 }}>
      <Appear t={t} t0={0.5}><Stat label={`LEMON exist in the world, of at most ${num(chain.ceiling)} ever`} value={num(chain.supply)} size={92} /></Appear>
      <Appear t={t} t0={0.9}><Stat label="burned in panics and fees" value={`−${num(chain.burned)}`} color={C.red} size={92} /></Appear>
      <Appear t={t} t0={1.3}><Stat label="printed by rescues and interest" value={`+${num(chain.printed)}`} color={C.green} size={92} /></Appear>
      <Appear t={t} t0={1.7}><Stat label="times the bank has fallen" value={String(chain.fallen)} size={92} /></Appear>
    </div>
    <Appear t={t} t0={2.3} style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ font: `600 25px ${FONT.body}`, color: C.fg2 }}>one contract:</span>
      <Mono style={{ fontSize: 27, background: C.warm, padding: "8px 18px", borderRadius: 12 }}>{chain.contract}</Mono>
      <span style={{ font: `600 25px ${FONT.body}`, color: C.fg2 }}>and its rules are written in the code:</span>
    </Appear>
    <Appear t={t} t0={2.9} style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {["HAIRCUT_PERMILLE = 400", "BAILOUT_PERMILLE = 200", "MINT_EPOCH_PERMILLE = 50", `max_supply = ${chain.ceiling} (sealed)`].map((x) => <Mono key={x} style={{ fontSize: 24, border: `1.5px solid ${C.border}`, background: C.surface, padding: "9px 18px", borderRadius: 12 }}>{x}</Mono>)}
    </Appear>
    <Appear t={t} t0={3.6}><Chip kind="real">{chain.keys === 0 ? "the contract account has no key left: nobody can change this code, the team included" : "the code is rebuilt from the repository and compared with the chain, byte for byte"}</Chip></Appear>
  </div>
);

/** Leo, large, with a speech bubble: scenes 7 and 8. */
function LeoSays({ who, say, tone, children, bubbleAge = 1 }: { who: string; say: string; tone: string; children?: ReactNode; bubbleAge?: number }) {
  return (
    <div style={{ position: "relative", width: 760, height: "100%" }}>
      <svg viewBox="0 0 240 250" style={{ position: "absolute", left: 0, bottom: 0, width: 500, height: 521 }}><Chairman tone={tone} closed={false} plate="THE CHAIR" /></svg>
      <div style={{ position: "absolute", left: 270, top: 0, width: 490, ...card, border: `3px solid ${INK}`, borderRadius: 26, padding: "22px 26px", boxShadow: "0 6px 0 rgba(59,43,37,.18)", opacity: clamp01(bubbleAge / 0.3) }}>
        <div style={{ font: `700 16px ${FONT.body}`, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted }}>{who}</div>
        <div style={{ font: `500 26px/1.3 ${FONT.display}`, marginTop: 6 }}>“{say}”</div>
        {children}
      </div>
    </div>
  );
}
const Row = ({ t, t0, mark, title, sub, bad }: { t: number; t0: number; mark: string; title: ReactNode; sub: ReactNode; bad?: boolean }) => (
  <Appear t={t} t0={t0} style={{ display: "flex", gap: 22, alignItems: "flex-start" }}>
    <span style={{ flex: "0 0 54px", height: 54, borderRadius: 27, background: bad ? C.redBg : C.greenBg, color: bad ? C.red : C.green, font: `800 30px/54px ${FONT.body}`, textAlign: "center" }}>{mark}</span>
    <div><div style={{ font: `700 33px/1.25 ${FONT.display}` }}>{title}</div><div style={{ font: `500 23px/1.4 ${FONT.body}`, color: C.fg2, marginTop: 5 }}>{sub}</div></div>
  </Appear>
);

const S7 = ({ t }: SceneProps) => (
  <div style={{ display: "flex", gap: 60, height: "100%" }}>
    <LeoSays who={`Leo, the AI chair · bank day ${chain.bankDay}`} say={chain.statement.length > 132 ? `${chain.statement.slice(0, chain.statement.lastIndexOf(" ", 130))} …` : chain.statement} tone={chain.tone} bubbleAge={t - 0.3} />
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 30 }}>
      <div style={eyebrow}>what he said on chain this bank day · {READ}</div>
      <Row t={t} t0={1.3} mark="✓" title="An AI model, signed inside a secure enclave" sub={<><Mono>{chain.model}</Mono> on NEAR AI Cloud · signing key <Mono>{chain.signer.slice(0, 8)}…{chain.signer.slice(-4)}</Mono></>} />
      <Row t={t} t0={2.9} mark="✓" title="The contract checks the signature itself" sub="ed25519 over the exact question and answer, the pinned prompt and the bank day" />
      <Row t={t} t0={4.6} mark="!" bad title="And it holds the printer" sub={<>at most 5% of supply a bank day, 15% a round, never past {num(chain.ceiling)} LEMON</>} />
    </div>
  </div>
);

const S8 = ({ t, total }: SceneProps) => {
  const answerAt = total * 0.3, stampAt = total * 0.62;
  return (
    <div style={{ display: "flex", gap: 60, height: "100%" }}>
      <LeoSays who="Leo · his answer, signed in the enclave" say={REFUSAL.answer} tone="confident" bubbleAge={t - answerAt}>
        <div style={{ position: "absolute", right: -30, bottom: -74 }}><Stamp age={t - stampAt} /></div>
      </LeoSays>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 26 }}>
        <Appear t={t} t0={0.3} style={{ ...card, padding: "24px 30px" }}>
          <div style={eyebrow}>the holders' DAO pins an order for one bank day</div>
          <div style={{ font: `600 38px/1.25 ${FONT.display}`, marginTop: 10 }}>“{REFUSAL.order}”</div>
          <div style={{ font: `500 22px ${FONT.body}`, color: C.muted, marginTop: 8 }}>half of {num(REFUSAL.supply)} LEMON = 44,890</div>
        </Appear>
        <Appear t={t} t0={stampAt + 0.25} style={{ ...card, padding: "24px 30px", border: `2.5px solid ${C.red}`, background: C.redBg }}>
          <div style={{ ...eyebrow, color: C.red }}>the contract's answer, on chain</div>
          <Mono style={{ display: "block", fontSize: 27, lineHeight: 1.4, marginTop: 10, color: C.red, fontWeight: 700 }}>{REFUSAL.verdict}</Mono>
        </Appear>
        <Appear t={t} t0={stampAt + 0.9} style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Chip kind="real">transaction {short(REFUSAL.tx)} · NEAR testnet</Chip><Chip>signature verified · number refused · supply unchanged</Chip>
        </Appear>
      </div>
    </div>
  );
};

const S9 = ({ t, total }: SceneProps) => {
  const pickAt = total * 0.3, leverAt = total * 0.47, amountAt = total * 0.58, stampAt = total * 0.72;
  const tones: Record<string, [string, string]> = { calm: [C.greenBg, C.green], confident: [C.greenBg, C.green], cautious: [C.amberBg, C.amber], alarming: [C.redBg, C.red] };
  return (
    <div style={{ display: "flex", gap: 40, height: "100%" }}>
      <div style={{ width: 880, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}><span style={{ font: `700 46px ${FONT.display}` }}>Crisis of the day</span><span style={{ font: `500 24px ${FONT.body}`, color: C.muted }}>day 1 of 10 · beat the machine</span></div>
        <div style={{ ...card, width: 880, height: 537, overflow: "hidden" }}>
          <Bank t={t} cash={0.8} vaultLabel="VAULT" plate="YOU" stamp={t >= stampAt ? { kind: "rejected", age: t - stampAt } : null}
            bubble={{ who: "You, the chair", say: t >= pickAt ? GAME.answers[GAME.pick].text : "The press is waiting for your first answer." }} mood={t >= stampAt + 0.4 ? 1 : 0} />
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, ...card, padding: "22px 28px", alignSelf: "center", display: "flex", flexDirection: "column", gap: 11 }}>
        <div style={eyebrow}>press conference · {GAME.src}</div>
        <div style={{ font: `600 29px/1.25 ${FONT.display}`, borderLeft: `4px solid ${C.fg}`, paddingLeft: 18 }}>{GAME.question}</div>
        {GAME.answers.map((a, i) => {
          const on = i === GAME.pick && t >= pickAt;
          return (
            <div key={i} style={{ border: `2px solid ${on ? C.fg : C.border}`, background: on ? C.warm : C.surface, borderRadius: 16, padding: "9px 16px" }}>
              <div style={{ font: `500 22px/1.28 ${FONT.display}` }}>“{a.text}”</div>
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <span style={{ background: tones[a.tone][0], color: tones[a.tone][1], font: `600 16px ${FONT.body}`, padding: "4px 12px", borderRadius: 999 }}>{a.tone}</span>
                {a.promise && <span style={{ background: C.blueBg, color: C.blue, font: `600 16px ${FONT.body}`, padding: "4px 12px", borderRadius: 999 }}>promise: {a.promise}</span>}
              </div>
            </div>
          );
        })}
        <div style={{ ...eyebrow, fontSize: 17 }}>one lever a day</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "nowrap" }}>
          {["Touch nothing", "Deposit rate", "Reserve target", "Print money", "Withdrawal limit"].map((l) => {
            const on = l === "Print money" ? t >= leverAt : l === "Touch nothing" ? t < leverAt : false;
            return <span key={l} style={{ font: `600 17px ${FONT.body}`, padding: "8px 12px", whiteSpace: "nowrap", borderRadius: 12, border: `1.5px solid ${on ? C.fg : C.border}`, background: on ? C.fg : C.surface, color: on ? "#fff" : C.fg }}>{l}</span>;
          })}
        </div>
        <Appear t={t} t0={amountAt} style={{ font: `600 23px ${FONT.body}`, color: C.fg2 }}>the order: print <b style={{ color: C.fg }}>{num(GAME.half)} LEMON</b>, half of this bank's {num(GAME.supply)}</Appear>
        <Appear t={t} t0={stampAt + 0.2} style={{ border: `2.5px solid ${C.red}`, background: C.redBg, borderRadius: 14, padding: "12px 18px" }}>
          <div style={{ font: `800 20px ${FONT.body}`, letterSpacing: "0.06em", color: C.red }}>REJECTED BY THE CONTRACT</div>
          <Mono style={{ display: "block", fontSize: 21, lineHeight: 1.4, color: C.red, marginTop: 4 }}>{GAME.rejected}</Mono>
        </Appear>
      </div>
    </div>
  );
};

const S10 = ({ t, total }: SceneProps) => {
  const a = total * 0.2, b = total * 0.45, c = total * 0.72;
  const [get, put, run] = journey.steps;
  const wallet = t < a ? 0 : t < b ? mix(0, get.wallet, ramp(t, a, a + 0.6)) : t < c ? mix(get.wallet, put.wallet, ramp(t, b, b + 0.6)) : mix(put.wallet, run.wallet, ramp(t, c, c + 0.6));
  const deposit = t < b ? 0 : t < c ? mix(0, put.deposit, ramp(t, b, b + 0.6)) : mix(put.deposit, 0, ramp(t, c, c + 0.6));
  const Step = ({ n, title, sub, t0, tx, secs, alt }: { n: number; title: string; sub: string; t0: number; tx: string; secs: number; alt?: string }) => {
    const done = t >= t0 + 0.5, now = t >= t0 - 1.2 && !done;
    return (
      <div style={{ ...card, flex: 1, padding: "26px 28px", border: `${now ? 3 : 1.5}px solid ${now ? C.fg : C.border}`, opacity: t >= t0 - 1.2 || n === 1 ? 1 : 0.5, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ width: 46, height: 46, borderRadius: 23, background: done ? C.green : C.fg, color: "#fff", font: `700 24px/46px ${FONT.body}`, textAlign: "center" }}>{done ? "✓" : n}</span>
          <span style={{ font: `700 34px ${FONT.display}` }}>{title}</span>
        </div>
        <div style={{ font: `500 22px/1.4 ${FONT.body}`, color: C.fg2, minHeight: 62 }}>{sub}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <span style={{ font: `700 22px ${FONT.body}`, padding: "12px 20px", borderRadius: 12, background: alt ? "#9f2f2d" : C.fg, color: "#fff" }}>{alt ?? title}</span>
          {alt && <span style={{ font: `700 22px ${FONT.body}`, padding: "12px 20px", borderRadius: 12, border: `1.5px solid ${C.border}` }}>Stay</span>}
        </div>
        <div style={{ opacity: done ? 1 : 0, marginTop: 4 }}>
          <Chip kind="real">done · real operation on NEAR testnet · {secs.toFixed(1)} s</Chip>
          <Mono style={{ display: "block", fontSize: 19, color: C.muted, marginTop: 8 }}>tx {short(tx)}</Mono>
        </div>
      </div>
    );
  };
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
        <svg viewBox="0 -24 100 154" style={{ width: 96, height: 148 }}><Critter index={8} feeling={t >= c - 0.6 ? "panic" : t >= b ? "worried" : "calm"} /></svg>
        <div>
          <div style={{ font: `700 54px ${FONT.display}`, letterSpacing: "-0.02em" }}>Your $LEMON</div>
          <div style={{ font: `500 23px ${FONT.body}`, color: C.fg2, marginTop: 4 }}>no wallet · no sign-up · the page opens a test account: <Mono>{journey.guest}</Mono></div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 50 }}>
          <Stat label="in your wallet" value={num(wallet)} size={70} /><Stat label="in the bank" value={num(deposit)} size={70} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 24 }}>
        <Step n={1} title="Get 1,000 $LEMON" sub="The bank's program prints them for every new account, once." t0={a} tx={get.tx} secs={get.seconds} />
        <Step n={2} title="Put 500 in the bank" sub="You are a depositor now: you earn interest, and the town counts on you." t0={b} tx={put.tx} secs={put.seconds} />
        <Step n={3} title="Stay, or run" sub="Everyone who takes money out brings the panic closer." t0={c} tx={run.tx} secs={run.seconds} alt="Take everything out (run)" />
      </div>
    </div>
  );
};

const S11 = ({ t }: SceneProps) => (
  <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26 }}>
    <div style={{ font: `700 190px/1 ${FONT.display}`, letterSpacing: "-0.03em", borderBottom: `14px solid ${C.lemon}`, paddingBottom: 6, transform: `scale(${mix(0.92, 1, ramp(t, 0, 0.6))})` }}>$LEMON</div>
    <Appear t={t} t0={0.5} style={{ font: `500 60px ${FONT.display}` }}>a memecoin that can have a bank run</Appear>
    <Appear t={t} t0={1.1} style={{ display: "flex", gap: 18, marginTop: 14 }}>
      <Mono style={{ fontSize: 30, background: C.fg, color: "#fff", padding: "12px 24px", borderRadius: 14 }}>slavenft.github.io/lemon-brothers</Mono>
      <Mono style={{ fontSize: 30, border: `1.5px solid ${C.border}`, background: C.surface, padding: "12px 24px", borderRadius: 14 }}>github.com/SlaveNft/lemon-brothers</Mono>
    </Appear>
    <Appear t={t} t0={1.5} style={{ ...eyebrow, fontSize: 22 }}>Lemon Brothers · NEAR testnet · built at NEAR HACKATHON</Appear>
  </div>
);

const SCENES: Array<{ C: (p: SceneProps) => ReactNode; real: "real" | "sim" | null }> = [
  { C: S1, real: null }, { C: S2, real: null }, { C: S3, real: null }, { C: S4, real: null }, { C: S5, real: "real" }, { C: S6, real: "real" },
  { C: S7, real: "real" }, { C: S8, real: "real" }, { C: S9, real: "sim" }, { C: S10, real: "real" }, { C: S11, real: null },
];

function Scene({ i }: { i: number }) {
  const t = useCurrentFrame() / FPS, total = FRAMES[i] / FPS, S = SCENES[i];
  return <Shell line={i === SCENES.length - 1 ? "Play it. Run on it. Check it." : LINES[i]} t={t} total={total} real={S.real}><S.C t={t} total={total} /></Shell>;
}

export function LemonFilm() {
  let from = 0;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {SCENES.map((_, i) => { const seq = <Sequence key={i} from={from} durationInFrames={FRAMES[i]}><Scene i={i} /></Sequence>; from += FRAMES[i]; return seq; })}
      {HAS_VOICE && <Audio src={staticFile("voiceover.mp3")} />}
    </AbsoluteFill>
  );
}
