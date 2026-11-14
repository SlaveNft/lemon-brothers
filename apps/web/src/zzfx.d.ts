// ZzFX 1.4.0 ships no type declarations; this covers the two exports the press room uses.
declare module "zzfx" {
  export function zzfx(...parameters: number[]): AudioBufferSourceNode;
  export const ZZFX: { volume: number; sampleRate: number; audioContext: AudioContext };
}
