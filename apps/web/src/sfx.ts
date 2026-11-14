/**
 * Sound effects synthesised with ZzFX (no audio files). On by default: browsers only allow audio after a click, so
 * the first click wakes the audio context; the sound button turns it off and the choice is remembered. Parameter order: volume, randomness, frequency, attack, sustain, release,
 * shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay,
 * sustainVolume, decay, tremolo, filter.
 */
import { ZZFX, zzfx } from "zzfx";

const KEY = "chair.sound";
let on = (() => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } })();

/** Browsers start the audio context suspended; the first press anywhere on the page wakes it. */
const wake = () => { try { void (ZZFX.audioContext as AudioContext).resume(); } catch { /* no audio */ } };
if (typeof window !== "undefined") window.addEventListener("pointerdown", wake, { once: true, capture: true });

export const soundOn = () => on;
export function setSound(v: boolean) {
  on = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ }
  if (v) { try { void (ZZFX.audioContext as AudioContext).resume(); } catch { /* not started yet */ } }
}

const SOUNDS = {
  shutter: [0.35, 0.1, 1200, 0, 0.01, 0.04, 4, 2, 0, 0, 0, 0, 0, 0.8],
  stamp: [1.0, 0.05, 55, 0.005, 0.04, 0.35, 0, 2.2, -1.5, 0, 0, 0, 0, 1.4, 0, 0, 0, 0.5, 0.08],
  coin: [0.35, 0.15, 1650, 0, 0.02, 0.14, 1, 1.6, 0, 0, 420, 0.04],
  siren: [0.45, 0, 520, 0.15, 1.6, 0.35, 0, 1, 0, 0, 0, 0, 0, 0, 7],
  whoosh: [0.25, 0.2, 180, 0.04, 0.08, 0.22, 4, 1, -4, 0, 0, 0, 0, 0.6],
  cheer: [0.4, 0.3, 300, 0.1, 0.5, 0.6, 4, 0.6, 0, 0, 0, 0, 0.08, 0.4],
  gavel: [0.9, 0.05, 140, 0, 0.02, 0.18, 2, 1.5, 0, 0, 0, 0, 0, 0.2],
  // interface: picking an answer, moving a lever
  tick: [0.22, 0.02, 880, 0, 0.01, 0.03, 1, 1.4],
  lever: [0.3, 0.02, 320, 0, 0.02, 0.07, 2, 1.2, 0, 0, 120, 0.03],
} as const;

export type Sound = keyof typeof SOUNDS;

export function play(name: Sound, volume = 1) {
  if (!on) return;
  wake();
  const p = [...SOUNDS[name]] as number[];
  p[0] *= volume;
  try { zzfx(...p); } catch { /* audio unavailable */ }
}
