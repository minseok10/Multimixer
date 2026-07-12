/**
 * Metronome click synthesis.
 *
 * The click track is rendered into a full-timeline AudioBuffer and played as one
 * more AudioBufferSourceNode started at the SAME common t0 as every track (see
 * AudioEngine). That means the metronome is phase-locked to the music by the
 * exact same guarantee as the tracks — it can't drift.
 *
 * Uniform clicks (no accent): the first click sits at t=0 (the downbeat anchor)
 * and repeats every 60/bpm seconds.
 */

const CLICK_FREQ = 1200;
const CLICK_DURATION = 0.03; // seconds
const CLICK_DECAY = 0.008; // exponential decay time constant

/** Beat times in seconds for a timeline, first click at 0. Pure. */
export function beatTimes(duration: number, bpm: number): number[] {
  const times: number[] = [];
  if (duration <= 0 || bpm <= 0) return times;
  const beat = 60 / bpm;
  // Index-based to avoid floating-point accumulation over many beats.
  for (let k = 0; k * beat < duration - 1e-9; k++) times.push(k * beat);
  return times;
}

/**
 * Render a click buffer covering `lengthSamples` at `sampleRate`, with a click
 * at every beat. Uses a throwaway OfflineAudioContext purely as a buffer factory
 * so the buffer matches the engine's sample rate (same pattern as demoStems).
 */
export function buildMetronomeBuffer(
  sampleRate: number,
  lengthSamples: number,
  bpm: number,
): AudioBuffer {
  const factory = new OfflineAudioContext(1, Math.max(1, lengthSamples), sampleRate);
  const buffer = factory.createBuffer(1, Math.max(1, lengthSamples), sampleRate);
  const data = buffer.getChannelData(0);

  const duration = lengthSamples / sampleRate;
  const clickSamples = Math.floor(CLICK_DURATION * sampleRate);

  for (const t of beatTimes(duration, bpm)) {
    const start = Math.floor(t * sampleRate);
    const end = Math.min(lengthSamples, start + clickSamples);
    for (let i = start; i < end; i++) {
      const tt = (i - start) / sampleRate;
      data[i] = Math.sin(2 * Math.PI * CLICK_FREQ * tt) * Math.exp(-tt / CLICK_DECAY) * 0.9;
    }
  }
  return buffer;
}
