/** Colours and type of the page (apps/web/src/styles.css, "Warm Editorial"), and two small helpers. */
export const C = {
  bg: "#fbf6ee", surface: "#fffdf8", warm: "#f1e3cf", fg: "#201914", fg2: "#4c4037", muted: "#7a6d63",
  border: "#ded2c3", soft: "#eee4d7", lemon: "#f2b83a", green: "#346538", greenBg: "#edf3ec", red: "#9f2f2d", redBg: "#fdebec",
  amber: "#956400", amberBg: "#fbf3db", blue: "#1f6c9f", blueBg: "#e1f3fe", dark: "#1d1611",
};
export const INK = "#3b2b25";
export const FONT = {
  display: 'ui-serif, "New York", "Iowan Old Style", Georgia, "Times New Roman", serif',
  body: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
};
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0 before `a`, 1 after `b`, smooth in between. */
export const ramp = (x: number, a: number, b: number) => { const p = clamp01((x - a) / (b - a)); return p * p * (3 - 2 * p); };
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
export const num = (n: number) => Math.round(n).toLocaleString("en-US");
