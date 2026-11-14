/**
 * The cast of the 2D town: original cartoon animals drawn in SVG, in the soft manner of an animated film: big heads,
 * large eyes with a highlight, small dressed bodies, feelings you can read from across the room. A depositor is
 * drawn in a 100 x 130 box with its feet on the bottom edge; the chair (a lion, because his name is Leo) in a
 * 240 x 250 box behind his desk. Nothing here is taken from an existing film or character.
 */
import { memo, type ReactNode } from "react";

export type Species = "cat" | "dog" | "bear" | "pig" | "sheep" | "mouse";
export type Feeling = "calm" | "worried" | "panic";
export const SPECIES: Species[] = ["cat", "dog", "bear", "pig", "sheep", "mouse"];

const INK = "#3b2b25";
const FUR: Record<Species, Array<[string, string, string]>> = {
  // [fur, lighter muzzle, darker ears and feet]
  cat: [["#f0a55a", "#fde3c2", "#c9772f"], ["#8f8f9c", "#e7e7ee", "#63636f"], ["#4a4038", "#d9c8b6", "#2e2722"]],
  dog: [["#d9a273", "#f8e6d2", "#8a5a36"], ["#f3e9da", "#fffaf2", "#a98b6c"], ["#7a5a48", "#e9d5c2", "#4b3529"]],
  bear: [["#9a6a48", "#e8cfb4", "#6b452c"], ["#5c4a44", "#cdb9a8", "#3a2e2a"], ["#e9dccb", "#fffaf2", "#b9a48c"]],
  pig: [["#f6b6bd", "#fbd6da", "#e08c97"], ["#f3c3b0", "#fde0d2", "#d9967e"]],
  sheep: [["#5b4a45", "#8a756c", "#3a2f2c"], ["#e6c8ad", "#f6e4d2", "#b99676"]],
  mouse: [["#b9b3ad", "#efeae4", "#8d8680"], ["#d8b48f", "#f7e6d3", "#a47f5b"]],
};
const SHIRTS = ["#5b8def", "#e2725b", "#57a773", "#b07cc6", "#e6b23a", "#3fa7a3", "#d96a9a", "#7b8794"];
const st = { stroke: INK, strokeWidth: 2.4, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function Eyes({ feeling, y = 43, dx = 14, iris = "#5a3a22" }: { feeling: Feeling; y?: number; dx?: number; iris?: string }) {
  const eye = (cx: number) => {
    const ry = feeling === "panic" ? 12.5 : feeling === "worried" ? 11 : 10.5, r = feeling === "panic" ? 3.4 : feeling === "worried" ? 5 : 6.4;
    const py = feeling === "worried" ? y + 1.5 : y + 0.5;
    return (
      <g key={cx}>
        <ellipse cx={cx} cy={y} rx={9} ry={ry} fill="#fffdf8" stroke={INK} strokeWidth={1.8} />
        <circle cx={cx} cy={py} r={r} fill={iris} />
        <circle cx={cx} cy={py} r={r * 0.55} fill="#1c1410" />
        <circle cx={cx - r * 0.35} cy={py - r * 0.4} r={Math.max(1.3, r * 0.3)} fill="#fff" />
        {feeling === "calm" && <path d={`M ${cx - 9} ${y - 5} Q ${cx} ${y - 12.5} ${cx + 9} ${y - 5}`} fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />}
      </g>
    );
  };
  const brow = (cx: number, side: 1 | -1) => feeling === "calm" ? null
    : <path key={`b${cx}`} d={`M ${cx - side * 9} ${y - 15 - (feeling === "panic" ? 4 : 0)} L ${cx + side * 8} ${y - 19 - (feeling === "panic" ? 3 : 0)}`} fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />;
  return <>{eye(50 - dx)}{eye(50 + dx)}{brow(50 - dx, -1)}{brow(50 + dx, 1)}</>;
}

function Mouth({ feeling, y = 63 }: { feeling: Feeling; y?: number }) {
  if (feeling === "calm") return <path d={`M 43 ${y} Q 50 ${y + 7} 57 ${y}`} fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />;
  if (feeling === "worried") return <ellipse cx={50} cy={y + 2} rx={3.4} ry={3} fill="#7a2e3a" stroke={INK} strokeWidth={1.6} />;
  return <><ellipse cx={50} cy={y + 3} rx={6.5} ry={7} fill="#7a2e3a" stroke={INK} strokeWidth={1.8} /><ellipse cx={50} cy={y + 6.5} rx={3.6} ry={2.6} fill="#f08a8a" /></>;
}

/** Ears and other things behind the head, then the face details in front of it. */
function parts(sp: Species, fur: string, light: string, dark: string): { behind: ReactNode; face: ReactNode; headRx: number; eyeY: number; mouthY: number } {
  const pink = "#f7a8b8";
  switch (sp) {
    case "cat": return { headRx: 35, eyeY: 44, mouthY: 63,
      behind: <><path d="M 20 30 L 22 2 L 44 20 Z" fill={fur} {...st} /><path d="M 80 30 L 78 2 L 56 20 Z" fill={fur} {...st} /><path d="M 26 22 L 27 10 L 37 19 Z" fill={pink} /><path d="M 74 22 L 73 10 L 63 19 Z" fill={pink} /></>,
      face: <><ellipse cx="50" cy="61" rx="15" ry="10" fill={light} /><path d="M 46.5 55.5 L 53.5 55.5 L 50 59.5 Z" fill={pink} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" /><g stroke={INK} strokeWidth={1.2} strokeLinecap="round" opacity={0.6}><line x1="30" y1="58" x2="18" y2="55" /><line x1="30" y1="62" x2="18" y2="64" /><line x1="70" y1="58" x2="82" y2="55" /><line x1="70" y1="62" x2="82" y2="64" /></g></> };
    case "dog": return { headRx: 34, eyeY: 42, mouthY: 66,
      behind: <><path d="M 20 26 Q 4 34 10 62 Q 22 62 26 40 Z" fill={dark} {...st} /><path d="M 80 26 Q 96 34 90 62 Q 78 62 74 40 Z" fill={dark} {...st} /></>,
      face: <><ellipse cx="50" cy="62" rx="17" ry="13" fill={light} /><ellipse cx="50" cy="55" rx="6" ry="4.4" fill="#2a1f1b" /><path d="M 50 59 L 50 63" stroke={INK} strokeWidth={1.6} strokeLinecap="round" /></> };
    case "bear": return { headRx: 36, eyeY: 43, mouthY: 65,
      behind: <><circle cx="24" cy="18" r="12" fill={fur} {...st} /><circle cx="76" cy="18" r="12" fill={fur} {...st} /><circle cx="24" cy="18" r="5.5" fill={light} /><circle cx="76" cy="18" r="5.5" fill={light} /></>,
      face: <><ellipse cx="50" cy="61" rx="16" ry="12" fill={light} /><ellipse cx="50" cy="55.5" rx="6.5" ry="4.6" fill="#2a1f1b" /></> };
    case "pig": return { headRx: 35, eyeY: 41, mouthY: 68,
      behind: <><path d="M 22 28 L 16 8 L 40 16 Z" fill={dark} {...st} /><path d="M 78 28 L 84 8 L 60 16 Z" fill={dark} {...st} /></>,
      face: <><ellipse cx="50" cy="58" rx="13" ry="9" fill={dark} stroke={INK} strokeWidth={1.8} /><ellipse cx="45.5" cy="58" rx="2" ry="3.2" fill="#8c4a56" /><ellipse cx="54.5" cy="58" rx="2" ry="3.2" fill="#8c4a56" /></> };
    case "sheep": return { headRx: 30, eyeY: 44, mouthY: 64,
      behind: <>{[[50, 12, 16], [30, 18, 14], [70, 18, 14], [18, 34, 13], [82, 34, 13], [22, 52, 11], [78, 52, 11]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#fffaf2" {...st} />)}<path d="M 16 44 Q 4 46 8 58 Q 18 58 22 50 Z" fill={dark} {...st} /><path d="M 84 44 Q 96 46 92 58 Q 82 58 78 50 Z" fill={dark} {...st} /></>,
      face: <><circle cx="38" cy="20" r="9" fill="#fffaf2" /><circle cx="52" cy="16" r="10" fill="#fffaf2" /><circle cx="64" cy="21" r="8" fill="#fffaf2" /><path d="M 46.5 56 L 53.5 56 L 50 60 Z" fill="#2a1f1b" /></> };
    default: return { headRx: 33, eyeY: 45, mouthY: 64,
      behind: <><circle cx="20" cy="20" r="17" fill={fur} {...st} /><circle cx="80" cy="20" r="17" fill={fur} {...st} /><circle cx="20" cy="20" r="10" fill={pink} /><circle cx="80" cy="20" r="10" fill={pink} /></>,
      face: <><ellipse cx="50" cy="61" rx="13" ry="9" fill={light} /><ellipse cx="50" cy="56" rx="4" ry="3" fill={pink} stroke={INK} strokeWidth={1.3} /></> };
  }
}

/** One depositor. `index` picks the species, the fur and the shirt, so the same depositor always looks the same. */
export const Critter = memo(function Critter({ index, feeling, ai }: { index: number; feeling: Feeling; ai?: boolean }) {
  const sp = SPECIES[(index * 7 + 3) % SPECIES.length], furs = FUR[sp];
  const [fur, light, dark] = furs[(index * 5 + (index >> 2)) % furs.length], shirt = SHIRTS[(index * 3 + 1) % SHIRTS.length];
  const p = parts(sp, fur, light, dark), up = feeling === "panic";
  return (
    <g className={`critter f-${feeling}`}>
      <ellipse cx="50" cy="126" rx="26" ry="5" fill="#000" opacity="0.13" />
      <ellipse cx="38" cy="123" rx="11" ry="5.5" fill={dark} {...st} /><ellipse cx="62" cy="123" rx="11" ry="5.5" fill={dark} {...st} />
      <ellipse cx={up ? 22 : 25} cy={up ? 72 : 98} rx="7.5" ry="13" fill={fur} {...st} transform={`rotate(${up ? 150 : 16} ${up ? 22 : 25} ${up ? 72 : 98})`} />
      <ellipse cx={up ? 78 : 75} cy={up ? 72 : 98} rx="7.5" ry="13" fill={fur} {...st} transform={`rotate(${up ? -150 : -16} ${up ? 78 : 75} ${up ? 72 : 98})`} />
      <path d="M 30 86 Q 30 76 42 76 L 58 76 Q 70 76 70 86 L 72 112 Q 72 121 62 121 L 38 121 Q 28 121 28 112 Z" fill={shirt} {...st} />
      <path d="M 42 76 L 50 88 L 58 76 Z" fill="#fffdf8" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      {p.behind}
      <ellipse cx="50" cy="46" rx={p.headRx} ry="31" fill={fur} {...st} />
      <ellipse cx="42" cy="30" rx={p.headRx * 0.55} ry="11" fill="#fff" opacity="0.16" />
      {p.face}
      {feeling === "calm" && <><ellipse cx="27" cy="56" rx="5.5" ry="3.4" fill="#f58aa0" opacity="0.5" /><ellipse cx="73" cy="56" rx="5.5" ry="3.4" fill="#f58aa0" opacity="0.5" /></>}
      <Eyes feeling={feeling} y={p.eyeY} />
      <Mouth feeling={feeling} y={p.mouthY} />
      {feeling === "worried" && <path d="M 86 20 q -6 10 0 14 q 6 -4 0 -14 Z" fill="#8fd3ff" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />}
      {feeling === "panic" && <g><circle cx="50" cy="-10" r="11" fill="#e5484d" stroke={INK} strokeWidth={2} /><rect x="48" y="-17" width="4" height="9" rx="2" fill="#fff" /><circle cx="50" cy="-4.5" r="2.2" fill="#fff" /></g>}
      {ai && <g><rect x="33" y={feeling === "panic" ? -40 : -20} width="34" height="17" rx="8.5" fill="#1f6c9f" stroke="#fffdf8" strokeWidth={1.5} /><text x="50" y={feeling === "panic" ? -27.5 : -7.5} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">AI</text></g>}
    </g>
  );
});

/** The chair: Leo, a lion in a pinstripe suit behind his desk. `tone` is how his latest statement sounded. */
export const Chairman = memo(function Chairman({ tone, plate, closed }: { tone: string; plate: string; closed: boolean }) {
  const feeling: Feeling = closed ? "panic" : tone === "alarming" ? "panic" : tone === "cautious" ? "worried" : "calm";
  const mane = "#9a5a2c", face = "#f2b45a", muzzle = "#fde6c4";
  return (
    <g className={`chairman f-${feeling}`}>
      {/* the chair's back */}
      <path d="M 62 60 Q 62 20 120 20 Q 178 20 178 60 L 182 190 L 58 190 Z" fill="#7a2f2a" {...st} strokeWidth={3} />
      <path d="M 76 62 Q 76 34 120 34 Q 164 34 164 62 L 166 180 L 74 180 Z" fill="#96403a" />
      {/* suit */}
      <path d="M 62 150 Q 62 124 92 122 L 148 122 Q 178 124 178 150 L 186 214 L 54 214 Z" fill="#2b3a67" {...st} strokeWidth={3} />
      <g stroke="#55649a" strokeWidth={1.4} opacity={0.7}>{[72, 84, 96, 144, 156, 168].map((x) => <line key={x} x1={x} y1={130} x2={x - (x < 120 ? 4 : -4)} y2={212} />)}</g>
      <path d="M 100 122 L 120 152 L 140 122 Z" fill="#fffdf8" {...st} strokeWidth={2.2} />
      <path d="M 114 130 L 126 130 L 124 142 L 130 178 L 120 190 L 110 178 L 116 142 Z" fill="#c8323a" {...st} strokeWidth={2.2} />
      {/* mane, ears, head */}
      {Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return <circle key={i} cx={120 + Math.cos(a) * 50} cy={74 + Math.sin(a) * 46} r={21} fill={mane} {...st} strokeWidth={2.6} />; })}
      <circle cx="120" cy="74" r="50" fill={mane} />
      <circle cx="82" cy="36" r="13" fill={face} {...st} /><circle cx="158" cy="36" r="13" fill={face} {...st} />
      <circle cx="82" cy="36" r="6" fill="#f7a8b8" /><circle cx="158" cy="36" r="6" fill="#f7a8b8" />
      <ellipse cx="120" cy="76" rx="42" ry="40" fill={face} {...st} strokeWidth={2.8} />
      <ellipse cx="108" cy="54" rx="24" ry="12" fill="#fff" opacity="0.18" />
      <ellipse cx="120" cy="96" rx="22" ry="16" fill={muzzle} />
      <path d="M 111 85 L 129 85 L 120 96 Z" fill="#5a2f24" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      <g transform="translate(70 28) scale(1)"><Eyes feeling={feeling} y={42} dx={17} iris="#3f7d57" /></g>
      <g transform="translate(70 36)"><Mouth feeling={feeling} y={66} /></g>
      {/* paws on the desk, the desk and the nameplate */}
      <ellipse cx="78" cy="206" rx="17" ry="11" fill={face} {...st} /><ellipse cx="162" cy="206" rx="17" ry="11" fill={face} {...st} />
      <path d="M 6 210 L 234 210 L 240 250 L 0 250 Z" fill="#8a5a36" {...st} strokeWidth={3} />
      <path d="M 6 210 L 234 210 L 236 220 L 4 220 Z" fill="#a8744a" />
      <rect x="78" y="224" width="84" height="20" rx="4" fill="#e8c56b" {...st} strokeWidth={2} />
      <text x="120" y="238.5" textAnchor="middle" fontSize="11.5" fontWeight="700" fill={INK} fontFamily="Georgia, serif" letterSpacing="0.5">{plate}</text>
    </g>
  );
});
