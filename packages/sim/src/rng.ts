/**
 * Deterministic 32-bit RNG (mulberry32). Integer-only so the same sequence can be
 * reproduced in the Rust contract. The state is a plain number stored in GameState.
 */
export function next(state: number): [value: number, state: number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [(t ^ (t >>> 14)) >>> 0, s];
}

/** A small mutable wrapper used inside one reducer step. */
export class Rng {
  constructor(public state: number) {}
  u32(): number {
    const [v, s] = next(this.state);
    this.state = s;
    return v;
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return n <= 0 ? 0 : this.u32() % n;
  }
  /** True with probability permille / 1000. */
  chance(permille: number): boolean {
    return this.int(1000) < permille;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)];
  }
}

/** FNV-1a 32-bit over a string, used for replay hashes. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
