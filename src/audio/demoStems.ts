/**
 * Demo stems, synthesized in-memory so the app ships with something to play
 * without committing binary audio or hitting the network.
 *
 * Every stem is exactly the same length and sample rate, generated from the
 * same tempo grid, so loading them demonstrates the engine's phase lock:
 * pressing play lands all four hits on the same sample. Deterministic (seeded
 * noise) so the demo sounds identical every run.
 */

const BPM = 120;
const BEAT = 60 / BPM; // 0.5 s
const BARS = 4;
const BAR = BEAT * 4; // 2 s
const DURATION = BAR * BARS; // 8 s

/** Small deterministic PRNG (mulberry32) for reproducible noise. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Exponential-ish amplitude envelope, value at time `t` after note start. */
function env(t: number, attack: number, decay: number): number {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / decay);
}

export interface RawStem {
  name: string;
  data: Float32Array;
}

/** Synthesize the raw mono sample data for every demo stem. */
export function synthesizeStems(sampleRate: number): RawStem[] {
  const length = Math.floor(DURATION * sampleRate);

  // Chord progression: Am – F – C – G, one chord per bar.
  const chords = [
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [60, 64, 67], // C
    [55, 59, 62], // G
  ];
  const bassRoots = [33, 29, 36, 31]; // A1, F1, C2, G1

  return [
    { name: 'Drums', data: synthDrums(length, sampleRate) },
    { name: 'Bass', data: synthBass(length, sampleRate, bassRoots) },
    { name: 'Chords', data: synthChords(length, sampleRate, chords) },
    { name: 'Arp', data: synthArp(length, sampleRate, chords) },
  ];
}

/**
 * Turn raw stems into AudioBuffers. Uses a throwaway OfflineAudioContext purely
 * as an AudioBuffer factory so buffers match the engine's sample rate.
 */
export function buildDemoStems(
  sampleRate: number,
): { name: string; buffer: AudioBuffer }[] {
  const factory = new OfflineAudioContext(1, 1, sampleRate);
  return synthesizeStems(sampleRate).map(({ name, data }) => {
    const buffer = factory.createBuffer(1, data.length, sampleRate);
    buffer.getChannelData(0).set(data);
    return { name, buffer };
  });
}

function synthDrums(length: number, sr: number): Float32Array {
  const out = new Float32Array(length);
  const rng = makeRng(1);
  const add = (start: number, dur: number, fn: (t: number) => number) => {
    const s0 = Math.floor(start * sr);
    const s1 = Math.min(length, Math.floor((start + dur) * sr));
    for (let i = s0; i < s1; i++) out[i] += fn((i - s0) / sr);
  };

  for (let bar = 0; bar < BARS; bar++) {
    const b = bar * BAR;
    // Kick on beats 1 and 3.
    for (const beat of [0, 2]) {
      const t0 = b + beat * BEAT;
      add(t0, 0.3, (t) => {
        const pitch = 45 + 80 * Math.exp(-t / 0.03); // fast pitch drop
        return Math.sin(2 * Math.PI * pitch * t) * env(t, 0.001, 0.12) * 0.9;
      });
    }
    // Snare (noise) on beats 2 and 4.
    for (const beat of [1, 3]) {
      const t0 = b + beat * BEAT;
      add(t0, 0.2, (t) => (rng() * 2 - 1) * env(t, 0.001, 0.09) * 0.5);
    }
    // Hi-hat every 8th note.
    for (let eighth = 0; eighth < 8; eighth++) {
      const t0 = b + eighth * (BEAT / 2);
      add(t0, 0.05, (t) => (rng() * 2 - 1) * env(t, 0.0005, 0.02) * 0.2);
    }
  }
  return normalize(out, 0.85);
}

function synthBass(length: number, sr: number, roots: number[]): Float32Array {
  const out = new Float32Array(length);
  const add = (start: number, dur: number, fn: (t: number) => number) => {
    const s0 = Math.floor(start * sr);
    const s1 = Math.min(length, Math.floor((start + dur) * sr));
    for (let i = s0; i < s1; i++) out[i] += fn((i - s0) / sr);
  };

  for (let bar = 0; bar < BARS; bar++) {
    const freq = midiToFreq(roots[bar]);
    // A note on each beat.
    for (let beat = 0; beat < 4; beat++) {
      const t0 = bar * BAR + beat * BEAT;
      add(t0, BEAT * 0.9, (t) => {
        // Simple saw-ish tone: a few harmonics.
        const s =
          Math.sin(2 * Math.PI * freq * t) +
          0.5 * Math.sin(2 * Math.PI * 2 * freq * t) +
          0.25 * Math.sin(2 * Math.PI * 3 * freq * t);
        return s * env(t, 0.005, 0.18) * 0.4;
      });
    }
  }
  return normalize(out, 0.8);
}

function synthChords(length: number, sr: number, chords: number[][]): Float32Array {
  const out = new Float32Array(length);
  for (let bar = 0; bar < BARS; bar++) {
    const notes = chords[bar];
    const s0 = Math.floor(bar * BAR * sr);
    const s1 = Math.min(length, Math.floor((bar + 1) * BAR * sr));
    for (let i = s0; i < s1; i++) {
      const t = (i - s0) / sr;
      // Slow attack pad, gentle release at the bar end.
      const e = Math.min(t / 0.15, 1) * Math.min((BAR - t) / 0.2, 1);
      let v = 0;
      for (const n of notes) v += Math.sin(2 * Math.PI * midiToFreq(n) * t);
      out[i] += (v / notes.length) * Math.max(0, e) * 0.5;
    }
  }
  return normalize(out, 0.7);
}

function synthArp(length: number, sr: number, chords: number[][]): Float32Array {
  const out = new Float32Array(length);
  const add = (start: number, dur: number, fn: (t: number) => number) => {
    const st0 = Math.floor(start * sr);
    const st1 = Math.min(length, Math.floor((start + dur) * sr));
    for (let i = st0; i < st1; i++) out[i] += fn((i - st0) / sr);
  };

  for (let bar = 0; bar < BARS; bar++) {
    const notes = chords[bar];
    // 8 sixteenth-ish blips per bar, cycling the chord tones an octave up.
    for (let step = 0; step < 8; step++) {
      const midi = notes[step % notes.length] + 12;
      const freq = midiToFreq(midi);
      const t0 = bar * BAR + step * (BEAT / 2);
      add(t0, 0.18, (t) => Math.sin(2 * Math.PI * freq * t) * env(t, 0.003, 0.06) * 0.35);
    }
  }
  return normalize(out, 0.6);
}

/** Peak-normalize to a target ceiling. */
function normalize(buf: Float32Array, ceiling: number): Float32Array {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) {
    const g = ceiling / peak;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  }
  return buf;
}
