/**
 * Metronome click synthesis.
 *
 * The click track is rendered into a full-timeline AudioBuffer and played as one
 * more AudioBufferSourceNode started at the SAME common t0 as every track (see
 * AudioEngine). That means the metronome is phase-locked to the music by the
 * exact same guarantee as the tracks — it can't drift.
 *
 * The buffer is rendered at a reduced sample rate (METRONOME_SAMPLE_RATE) to cut
 * memory and build cost ~4x on long files. The source node resamples it to the
 * context rate, and loopStart/loopEnd/offset are all expressed in seconds, so the
 * click timing is preserved to sub-millisecond.
 *
 * Uniform clicks (no accent): the downbeat anchor defaults to t=0, can be
 * nudged slightly earlier/later, and repeats every 60/bpm seconds.
 */

/**
 * Render rate for the click buffer. Comfortably above the click's 1.2 kHz
 * content (Nyquist 6 kHz) but far below a typical 48 kHz context, so a
 * full-length click track costs ~1/4 the memory. Onset placement is quantized to
 * 1/12000 s (~83 µs) before resampling — inaudible as misalignment.
 */
export const METRONOME_SAMPLE_RATE = 12000;

const CLICK_FREQ = 1200;
const CLICK_DURATION = 0.03; // seconds
const CLICK_DECAY = 0.008; // exponential decay time constant

/** Beat times in seconds for a timeline, phase-shifted around t=0. Pure. */
export function beatTimes(duration: number, bpm: number, downbeatOffsetSec = 0): number[] {
  const times: number[] = [];
  if (
    !Number.isFinite(duration) ||
    !Number.isFinite(bpm) ||
    !Number.isFinite(downbeatOffsetSec) ||
    duration <= 0 ||
    bpm <= 0
  ) return times;
  const beat = 60 / bpm;
  // Include a beat before index 0 when a negative nudge pushes the nominal
  // downbeat before the file boundary. Index-based math avoids accumulation.
  const firstIndex = Math.ceil(-downbeatOffsetSec / beat);
  for (let k = firstIndex; ; k++) {
    const t = downbeatOffsetSec + k * beat;
    if (t >= duration - 1e-9) break;
    if (t >= -1e-9) times.push(Math.max(0, t));
  }
  return times;
}

/**
 * Render a click buffer spanning `durationSec` at `renderRate`, with a click at
 * every beat. Uses a throwaway OfflineAudioContext purely as a buffer factory.
 */
export function buildMetronomeBuffer(
  renderRate: number,
  durationSec: number,
  bpm: number,
  downbeatOffsetSec = 0,
): AudioBuffer {
  const lengthSamples = Math.max(1, Math.ceil(durationSec * renderRate));
  const factory = new OfflineAudioContext(1, lengthSamples, renderRate);
  const buffer = factory.createBuffer(1, lengthSamples, renderRate);
  const data = buffer.getChannelData(0);

  const clickSamples = Math.floor(CLICK_DURATION * renderRate);

  for (const t of beatTimes(durationSec, bpm, downbeatOffsetSec)) {
    const start = Math.floor(t * renderRate);
    const end = Math.min(lengthSamples, start + clickSamples);
    for (let i = start; i < end; i++) {
      const tt = (i - start) / renderRate;
      data[i] = Math.sin(2 * Math.PI * CLICK_FREQ * tt) * Math.exp(-tt / CLICK_DECAY) * 0.9;
    }
  }
  return buffer;
}
