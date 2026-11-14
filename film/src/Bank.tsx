/**
 * The bank, drawn for the film with the page's own cast (apps/web/src/town/critters.tsx) in the page's own room
 * (apps/web/src/town/Town2D.tsx). On the page the picture moves with CSS; a film is rendered frame by frame, so
 * here every position is a function of the frame: who is walking to the door, how full the vault is, what the
 * stamp looks like a third of a second after it lands.
 */
import type { ReactNode } from "react";
import { Chairman, Critter, type Feeling } from "../../apps/web/src/town/critters";
import { clamp01, FONT, INK } from "./theme";

export const BW = 1000, BH = 610;
const COLS = 15, DOOR = { x: 925, y: 372 }, N = 60;
/** Where depositor `i` stands: four rows in front of the desk, every other row shifted half a step (as on the page). */
const seat = (i: number) => { const row = Math.floor(i / COLS), col = i % COLS; return { x: 62 + col * 54 + (row % 2 ? 27 : 0), y: 408 + row * 62 }; };
/** The order depositors leave in, spread over the room (the page's `leaveOrder`). */
const LEAVE = Array.from({ length: N }, (_, k) => (k * 37 + 11) % N);
const TURN = LEAVE.reduce<number[]>((t, i, k) => { t[i] = k; return t; }, []);

export interface BankProps {
  /** Seconds since the scene began: breathing and shaking. */
  t: number;
  /** How many have run so far; fractions are someone on the way to the door. */
  runners?: number;
  /** Cash in the vault, 0..1 of the gauge; `low` paints it red. */
  cash?: number; low?: boolean;
  /** The bank has fallen: the vault reads EMPTY, everyone left panics. */
  collapsed?: boolean;
  /** How the chair looks: calm, cautious (worried) or alarming (panic). */
  tone?: "calm" | "confident" | "cautious" | "alarming";
  bubble?: { who: string; say: string; tone?: string } | null;
  /** A stamp and how long ago it landed, in seconds (negative: not yet). */
  stamp?: { kind: "closed" | "rejected"; age: number } | null;
  /** A number floating over the vault: what burned or was printed. */
  float?: { text: string; kind: "burn" | "mint"; age: number } | null;
  vaultLabel?: string;
  /** How nervous those who stay are: 0 calm, 1 worried, 2 panic. */
  mood?: number;
  plate?: string;
  children?: ReactNode;
}

export function Bank({ t, runners = 0, cash = 0.4, low = false, collapsed = false, tone = "calm", bubble, stamp, float, vaultLabel, mood = 0, plate = "THE CHAIR", children }: BankProps) {
  const pop = (age: number) => { const p = clamp01(age / 0.3); return { opacity: p, scale: 1.8 - 0.8 * (1 - Math.pow(1 - p, 3)) }; };
  return (
    <svg viewBox={`0 0 ${BW} ${BH}`} style={{ display: "block", width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="t-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8f7fc4" /><stop offset="0.55" stopColor="#f3a06f" /><stop offset="1" stopColor="#ffd38f" /></linearGradient>
        <linearGradient id="t-steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#dfe3ea" /><stop offset="1" stopColor="#9aa1ad" /></linearGradient>
        <clipPath id="t-win"><rect x="320" y="24" width="360" height="236" rx="18" /></clipPath>
      </defs>
      {/* the room */}
      <rect width={BW} height={BH} fill="#f6e9d3" />
      <rect y="318" width={BW} height={BH - 318} fill="#ead4b2" />
      <rect y="312" width={BW} height="10" fill="#b98a5e" />
      <ellipse cx="455" cy="500" rx="455" ry="118" fill="#c9785a" opacity="0.2" />
      {/* the window behind the chair */}
      <g clipPath="url(#t-win)">
        <rect x="320" y="24" width="360" height="236" fill="url(#t-sky)" />
        <circle cx="600" cy="196" r="34" fill="#ffe9b0" opacity="0.9" />
        <path d="M320 260 V190 h26 v-34 h22 v54 h18 v-88 h14 v-22 h12 v22 h14 v70 h22 v-44 h26 v62 h16 v-112 h10 v-26 h8 v26 h10 v96 h24 v-52 h28 v40 h18 v-70 h22 v84 h20 v-36 h30 V260 Z" fill="#4f4374" opacity="0.72" />
      </g>
      <rect x="320" y="24" width="360" height="236" rx="18" fill="none" stroke="#8a5a36" strokeWidth="10" />
      <path d="M500 24 V260 M320 132 H680" stroke="#8a5a36" strokeWidth="6" />
      {/* the vault and its gauge */}
      <g>
        <rect x="44" y="52" width="232" height="246" rx="16" fill="url(#t-steel)" stroke={INK} strokeWidth="3" />
        <circle cx="150" cy="176" r="86" fill={collapsed ? "#2e2622" : "#c9ced8"} stroke={low ? "#d9363b" : INK} strokeWidth="4" />
        {collapsed
          ? <text x="150" y="184" textAnchor="middle" style={{ font: `800 24px ${FONT.body}`, letterSpacing: "0.08em", fill: "#ff6b6b" }}>EMPTY</text>
          : <g transform={`rotate(${low ? 60 : 0} 150 176)`}><circle cx="150" cy="176" r="58" fill="none" stroke="#6d7482" strokeWidth="7" />{[0, 1, 2, 3, 4, 5].map((k) => <line key={k} x1="150" y1="176" x2={150 + Math.cos((k * Math.PI) / 3) * 58} y2={176 + Math.sin((k * Math.PI) / 3) * 58} stroke="#6d7482" strokeWidth="7" strokeLinecap="round" />)}<circle cx="150" cy="176" r="15" fill="#f2b83a" stroke={INK} strokeWidth="3" /></g>}
        <rect x="246" y="74" width="16" height="204" rx="8" fill="#fffdf8" stroke={INK} strokeWidth="2.5" />
        <rect x="248.5" y={76.5 + 199 * (1 - cash)} width="11" height={Math.max(0, 199 * cash)} rx="5.5" fill={low ? "#d9363b" : "#f2b83a"} />
        <text x="150" y="42" textAnchor="middle" style={{ font: `700 15px ${FONT.body}`, letterSpacing: "0.08em", fill: INK }}>{vaultLabel ?? "VAULT"}</text>
      </g>
      {/* the door people run through */}
      <g>
        <rect x="868" y="150" width="112" height="230" rx="8" fill="#5a3a26" stroke={INK} strokeWidth="3" />
        <rect x="880" y="164" width="88" height="216" rx="4" fill="#241a17" />
        <rect x="892" y="118" width="64" height="26" rx="6" fill="#3f9a5f" stroke={INK} strokeWidth="2.5" />
        <text x="924" y="136.5" textAnchor="middle" style={{ font: `800 14px ${FONT.body}`, letterSpacing: "0.1em", fill: "#fff" }}>EXIT</text>
      </g>
      {/* the chair and what he just said */}
      <g transform="translate(364 34) scale(1.14)"><Chairman tone={tone} closed={collapsed} plate={plate} /></g>
      {bubble && (
        <foreignObject x="634" y="28" width="226" height="250">
          <div style={{ boxSizing: "border-box", background: "#fffdf8", border: `2.5px solid ${bubble.tone === "alarming" ? "#9f2f2d" : bubble.tone === "cautious" ? "#956400" : INK}`, borderRadius: 16, padding: "10px 13px", display: "flex", flexDirection: "column", gap: 4, fontFamily: FONT.body, color: "#201914", boxShadow: "0 4px 0 rgba(59,43,37,.18)" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#7a6d63" }}>{bubble.who}</span>
            <span style={{ fontFamily: FONT.display, fontSize: 15.5, lineHeight: 1.28 }}>“{bubble.say}”</span>
          </div>
        </foreignObject>
      )}
      {float && float.age >= 0 && (
        <text x="150" y={288 + 14 * (1 - clamp01(float.age / 0.4))} textAnchor="middle" opacity={clamp01(float.age / 0.25)}
          style={{ font: `800 19px ${FONT.body}`, paintOrder: "stroke", stroke: "#fffdf8", strokeWidth: 6, strokeLinejoin: "round", fill: float.kind === "burn" ? "#b0282c" : "#2f6b3a" }}>{float.text}</text>
      )}
      {/* the town: back rows first, so the front row overlaps them */}
      {Array.from({ length: N }, (_, i) => {
        const home = seat(i), k = TURN[i];
        // someone starts for the door a little before their number comes up and is through it a little after
        const walk = clamp01((runners - k + 1.5) / 4), eased = walk * walk * (3 - 2 * walk);
        if (walk >= 1) return null;
        const near = k - runners; // how soon this one's turn is
        const feeling: Feeling = walk > 0 || collapsed || mood >= 2 ? "panic" : mood >= 1 || near < 7 && runners > 0.5 ? "worried" : "calm";
        const phase = ((i * 37) % 100) / 30;
        const dy = feeling === "calm" ? Math.sin(((t + phase) / 3.2) * Math.PI * 2) * -2 - 2 : feeling === "worried" ? Math.sin(((t + phase) / 1.3) * Math.PI * 2) * -2 - 2 : -1.5;
        const dx = feeling === "panic" ? Math.sin(((t + phase) / 0.42) * Math.PI * 2) * 3 : 0;
        const x = home.x + (DOOR.x - home.x) * eased, y = home.y + (DOOR.y - home.y) * eased, sc = 0.64 - 0.3 * eased;
        const hop = walk > 0 ? Math.abs(Math.sin(walk * Math.PI * 5)) * -9 : 0;
        return (
          <g key={i} transform={`translate(${x} ${y + hop}) scale(${sc})`} opacity={walk > 0.82 ? clamp01((1 - walk) / 0.18) : 1}>
            <g transform={`translate(${dx} ${dy})`}><g transform="translate(-50 -130)"><Critter index={i} feeling={feeling} /></g></g>
          </g>
        );
      })}
      {stamp && stamp.age >= 0 && (stamp.kind === "closed"
        ? <g transform={`translate(500 330) rotate(-4) scale(${pop(stamp.age).scale})`} opacity={pop(stamp.age).opacity}>
            <rect x="-150" y="-30" width="300" height="60" rx="8" fill="rgba(255,253,248,.9)" stroke="#d9363b" strokeWidth="5" />
            <text y="10" textAnchor="middle" style={{ font: `800 30px ${FONT.body}`, letterSpacing: "0.06em", fill: "#d9363b" }}>BANK CLOSED</text>
          </g>
        : <g transform={`translate(747 170) rotate(-9) scale(${pop(stamp.age).scale})`} opacity={pop(stamp.age).opacity}>
            <rect x="-108" y="-34" width="216" height="68" rx="8" fill="rgba(255,253,248,.9)" stroke="#d9363b" strokeWidth="5" />
            <text y="-6" textAnchor="middle" style={{ font: `800 24px ${FONT.body}`, letterSpacing: "0.06em", fill: "#d9363b" }}>REJECTED</text>
            <text y="19" textAnchor="middle" style={{ font: `800 14px ${FONT.body}`, letterSpacing: "0.12em", fill: "#d9363b" }}>BY THE CONTRACT</text>
          </g>)}
      {children}
    </svg>
  );
}
