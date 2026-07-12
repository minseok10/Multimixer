/**
 * Shared types for the audio engine and UI.
 *
 * This file is the public contract between the phase-critical engine
 * (`src/audio`) and the UI (`src/components`). Treat these types as an API:
 * UI code depends on them, not on engine internals.
 */

/** Precomputed waveform peaks: paired min/max per bucket, mono-downmixed. */
export interface Peaks {
  /** Number of buckets (== min.length == max.length). */
  length: number;
  /** Minimum sample value per bucket, range roughly [-1, 0]. */
  min: Float32Array;
  /** Maximum sample value per bucket, range roughly [0, 1]. */
  max: Float32Array;
}

/** A loop region on the shared timeline, in seconds. */
export interface LoopRegion {
  start: number;
  end: number;
}

/** Immutable snapshot of a single track's UI-relevant state. */
export interface TrackState {
  id: string;
  name: string;
  /** Linear volume fader value in [0, 1]. */
  volume: number;
  muted: boolean;
  soloed: boolean;
  /** Track length in seconds. */
  duration: number;
  peaks: Peaks;
}

/** Immutable snapshot of the whole engine, consumed by React. */
export interface EngineState {
  tracks: TrackState[];
  isPlaying: boolean;
  /** Longest track length; the transport timeline length in seconds. */
  duration: number;
  masterVolume: number;
  loop: LoopRegion | null;
  loopEnabled: boolean;
}
