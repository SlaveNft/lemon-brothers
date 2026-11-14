/**
 * Language switch: English or Russian. The engine stays language-free (its text tables are English and the
 * season hash never sees text); the web app picks strings here.
 *
 *   tr("English", "Русский")   inline pair, so each string keeps its context in the component (works for JSX too)
 *   plural(n, "магазин", "магазина", "магазинов")   Russian plural forms (English callers pass their own)
 *
 * The choice is kept in localStorage; the first visit follows the browser language. Switching reloads the page so
 * module-level tables (memos, product names) are rebuilt in the new language.
 */
export type Lang = "en" | "ru";
const KEY = "chair.lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "ru") return saved;
  } catch { /* storage blocked: fall back to the browser language */ }
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "en" || q === "ru") return q;
    return (navigator.language || "").toLowerCase().startsWith("ru") ? "ru" : "en";
  } catch { return "en"; }
}

export const LANG: Lang = typeof window === "undefined" ? "en" : detect();
export const RU = LANG === "ru";

export const tr = <T,>(en: T, ru: T): T => (RU ? ru : en);

export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* storage blocked: the URL parameter still works */ }
  const u = new URL(window.location.href);
  u.searchParams.set("lang", l);
  window.location.replace(u.toString());
}

/** Russian plural: 1 магазин, 2 магазина, 5 магазинов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** "3 shops" / "3 магазина": English singular/plural plus the three Russian forms. */
export const count = (n: number, en1: string, enN: string, ru1: string, ru2: string, ru5: string) =>
  `${n} ${RU ? plural(n, ru1, ru2, ru5) : n === 1 ? en1 : enN}`;

/** A length of time in the unit a person would say: "55 minutes" for 3300 seconds, "30 seconds" for 30. */
export const span = (seconds: number) => seconds >= 60 && seconds % 60 === 0
  ? count(seconds / 60, "minute", "minutes", "минута", "минуты", "минут")
  : count(seconds, "second", "seconds", "секунда", "секунды", "секунд");
