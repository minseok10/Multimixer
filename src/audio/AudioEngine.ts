/**
 * AudioEngine — the phase-critical playback core.
 *
 * PHASE-LOCK GUARANTEE (the whole reason this file exists):
 *   - Exactly ONE AudioContext, so every track is driven by one sample clock.
 *   - Every track is fully decoded into an AudioBuffer (no HTMLMediaElement,
 *     which would drift).
 *   - On play, every track gets a fresh AudioBufferSourceNode and they are all
 *     started at a SINGLE future time `t0` with the same offset. Same clock +
 *     same start sample ⇒ sample-accurate alignment, drift is impossible.
 *   - AudioBufferSourceNode cannot pause/resume, so pause/seek/loop-change work
 *     by tearing every source down and re-scheduling them all at a new common
 *     `t0`. They always move together.
 *   - Buffers are zero-padded to the timeline length so native looping
 *     (loopStart/loopEnd) wraps every track at the exact same sample, even when
 *     source tracks had different lengths.
 *
 * Everything UI-facing goes through the immutable EngineState snapshot exposed
 * via subscribe()/getSnapshot() (React binds with useSyncExternalStore).
 */

import { resolveEffectiveGains, clampVolume, type GainInput } from './gains';
import { createLimiter } from './limiter';
import { computePeaks } from './peaks';
import { computePosition, loopActive } from './transport';
import type { EngineState, LoopRegion, Peaks, TrackState } from './types';

/** How far in the future to schedule playback so all sources start together. */
const LOOKAHEAD = 0.08;
/** Gain ramp time constant — click-free fader/mute/solo changes. */
const SMOOTH = 0.012;
/** Waveform resolution. */
const PEAK_BUCKETS = 2000;

interface EngineTrack {
  id: string;
  name: string;
  /** Playback buffer, zero-padded to the shared timeline length. */
  buffer: AudioBuffer;
  /** Original (pre-pad) length in seconds, for display. */
  sourceDuration: number;
  gainNode: GainNode;
  volume: number;
  muted: boolean;
  soloed: boolean;
  peaks: Peaks;
  source: AudioBufferSourceNode | null;
  scheduledStart: number | null;
  /** Cached immutable snapshot; rebuilt only when this track changes. */
  state: TrackState;
}

let idCounter = 0;
const nextId = () => `t${++idCounter}`;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private tracks = new Map<string, EngineTrack>();
  private order: string[] = [];

  private timelineSamples = 0;

  private _isPlaying = false;
  private startContextTime = 0;
  private startOffset = 0;
  private pausedAt = 0;
  /** Bumped on every stop/seek/new-play so stale onended callbacks are ignored. */
  private playToken = 0;

  private _masterVolume = 1;
  private loop: LoopRegion | null = null;
  private loopEnabled = false;

  private listeners = new Set<() => void>();
  private snapshot: EngineState = this.emptySnapshot();

  // ---- Context lifecycle -------------------------------------------------

  private getContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this._masterVolume;
    // Soft limiter on the master bus: a safety net against clipping when many
    // tracks sum together. Not a mastering tool, just headroom protection.
    const limiter = createLimiter(ctx);
    master.connect(limiter);
    limiter.connect(ctx.destination);
    // `limiter` stays alive via the audio graph connection above.
    this.ctx = ctx;
    this.masterGain = master;
    return ctx;
  }

  get sampleRate(): number {
    return this.getContext().sampleRate;
  }

  /** Must be called from a user gesture before audio can start. */
  async resume(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();
  }

  // ---- Loading -----------------------------------------------------------

  /** Decode an encoded audio file and add it as a track. */
  async loadFile(name: string, data: ArrayBuffer): Promise<TrackState> {
    const ctx = this.getContext();
    // decodeAudioData resamples to ctx.sampleRate, so every track ends up on
    // the same rate — a precondition for sample-accurate alignment.
    const buffer = await ctx.decodeAudioData(data.slice(0));
    return this.addTrackBuffer(name, buffer);
  }

  /** Add an already-decoded buffer (used by the demo-stem synthesizer). */
  addTrackBuffer(name: string, buffer: AudioBuffer): TrackState {
    if (this._isPlaying) this.stop();
    const ctx = this.getContext();

    const gainNode = ctx.createGain();
    gainNode.connect(this.masterGain!);

    const track: EngineTrack = {
      id: nextId(),
      name,
      buffer,
      sourceDuration: buffer.duration,
      gainNode,
      volume: 1,
      muted: false,
      soloed: false,
      peaks: computePeaks(buffer, PEAK_BUCKETS),
      source: null,
      scheduledStart: null,
      state: null as unknown as TrackState,
    };
    this.rebuildTrackState(track);

    this.tracks.set(track.id, track);
    this.order.push(track.id);

    this.reconcileTimeline();
    this.applyGains();
    this.notify();
    return track.state;
  }

  removeTrack(id: string): void {
    const track = this.tracks.get(id);
    if (!track) return;
    if (this._isPlaying) this.stop();
    track.gainNode.disconnect();
    this.tracks.delete(id);
    this.order = this.order.filter((t) => t !== id);
    this.reconcileTimeline();
    this.notify();
  }

  clear(): void {
    this.stop();
    for (const t of this.tracks.values()) t.gainNode.disconnect();
    this.tracks.clear();
    this.order = [];
    this.timelineSamples = 0;
    this.pausedAt = 0;
    this.loop = null;
    this.loopEnabled = false;
    this.notify();
  }

  /**
   * Ensure every track buffer is padded to the timeline length so native loops
   * wrap identically across tracks. Recomputes peaks for any padded track.
   */
  private reconcileTimeline(): void {
    let maxSamples = 0;
    for (const t of this.tracks.values()) {
      if (t.buffer.length > maxSamples) maxSamples = t.buffer.length;
    }
    this.timelineSamples = maxSamples;
    if (maxSamples === 0) return;

    const ctx = this.getContext();
    for (const t of this.tracks.values()) {
      if (t.buffer.length < maxSamples) {
        t.buffer = padBuffer(ctx, t.buffer, maxSamples);
        t.peaks = computePeaks(t.buffer, PEAK_BUCKETS);
        this.rebuildTrackState(t);
      }
    }
  }

  // ---- Transport ---------------------------------------------------------

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  private get durationSeconds(): number {
    return this.timelineSamples === 0
      ? 0
      : this.timelineSamples / this.getContext().sampleRate;
  }

  /** Current playback position in seconds, derived from the audio clock. */
  get currentTime(): number {
    const ctx = this.ctx;
    const now = ctx ? ctx.currentTime : 0;
    return computePosition({
      isPlaying: this._isPlaying,
      startOffset: this.startOffset,
      startContextTime: this.startContextTime,
      now,
      duration: this.durationSeconds,
      loop: this.loop,
      loopEnabled: this.loopEnabled,
      pausedAt: this.pausedAt,
    }).position;
  }

  async play(): Promise<void> {
    if (this._isPlaying || this.tracks.size === 0) return;
    await this.resume();
    const ctx = this.getContext();

    let offset = this.pausedAt;
    const duration = this.durationSeconds;
    if (offset >= duration) offset = 0; // restart from top if parked at the end

    const t0 = ctx.currentTime + LOOKAHEAD;
    const token = ++this.playToken;
    const looping = loopActive(this.loop, this.loopEnabled);

    for (const t of this.tracks.values()) {
      const src = ctx.createBufferSource();
      src.buffer = t.buffer;
      if (looping && this.loop) {
        src.loop = true;
        src.loopStart = this.loop.start;
        src.loopEnd = this.loop.end;
      }
      src.connect(t.gainNode);
      src.onended = () => {
        // Only a *natural* end (not a stop/seek/new play) should reset transport.
        if (token !== this.playToken) return;
        if (loopActive(this.loop, this.loopEnabled)) return;
        this.handleNaturalEnd();
      };
      // Single shared t0 for every source == phase lock.
      src.start(t0, offset);
      t.source = src;
      t.scheduledStart = t0;
    }

    this.startContextTime = t0;
    this.startOffset = offset;
    this._isPlaying = true;
    this.notify();
  }

  pause(): void {
    if (!this._isPlaying) return;
    this.pausedAt = this.currentTime;
    this.teardownSources();
    this._isPlaying = false;
    this.notify();
  }

  stop(): void {
    this.teardownSources();
    this._isPlaying = false;
    this.pausedAt = 0;
    this.notify();
  }

  seek(seconds: number): void {
    const duration = this.durationSeconds;
    const pos = Math.min(Math.max(0, seconds), duration);
    if (this._isPlaying) {
      // Re-schedule everything at a new common t0 from the seek point.
      this.teardownSources();
      this._isPlaying = false;
      this.pausedAt = pos;
      void this.play();
    } else {
      this.pausedAt = pos;
      this.notify();
    }
  }

  private handleNaturalEnd(): void {
    if (!this._isPlaying) return;
    this.teardownSources();
    this._isPlaying = false;
    this.pausedAt = 0;
    this.notify();
  }

  private teardownSources(): void {
    this.playToken++; // invalidate any pending onended
    for (const t of this.tracks.values()) {
      if (t.source) {
        t.source.onended = null;
        try {
          t.source.stop();
        } catch {
          /* already stopped */
        }
        t.source.disconnect();
        t.source = null;
      }
      t.scheduledStart = null;
    }
  }

  // ---- Mixer controls ----------------------------------------------------

  setVolume(id: string, volume: number): void {
    const t = this.tracks.get(id);
    if (!t) return;
    t.volume = clampVolume(volume);
    this.rebuildTrackState(t);
    this.applyGains();
    this.notify();
  }

  toggleMute(id: string): void {
    const t = this.tracks.get(id);
    if (!t) return;
    t.muted = !t.muted;
    this.rebuildTrackState(t);
    this.applyGains();
    this.notify();
  }

  toggleSolo(id: string): void {
    const t = this.tracks.get(id);
    if (!t) return;
    t.soloed = !t.soloed;
    this.rebuildTrackState(t);
    this.applyGains(); // solo affects every track's effective gain
    this.notify();
  }

  setMasterVolume(volume: number): void {
    this._masterVolume = clampVolume(volume);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this._masterVolume,
        this.ctx.currentTime,
        SMOOTH,
      );
    }
    this.notify();
  }

  /** Apply solo/mute/volume resolution to every track's gain node. */
  private applyGains(): void {
    if (!this.ctx) return;
    const inputs: GainInput[] = this.order.map((id) => {
      const t = this.tracks.get(id)!;
      return { id: t.id, volume: t.volume, muted: t.muted, soloed: t.soloed };
    });
    const gains = resolveEffectiveGains(inputs);
    const now = this.ctx.currentTime;
    for (const t of this.tracks.values()) {
      t.gainNode.gain.setTargetAtTime(gains.get(t.id) ?? 0, now, SMOOTH);
    }
  }

  // ---- Loop --------------------------------------------------------------

  setLoop(region: LoopRegion | null): void {
    this.loop = region;
    if (this._isPlaying) this.reschedule();
    else this.notify();
  }

  setLoopEnabled(enabled: boolean): void {
    this.loopEnabled = enabled;
    if (this._isPlaying) this.reschedule();
    else this.notify();
  }

  /** Restart playback from the current position (used when loop params change). */
  private reschedule(): void {
    const pos = this.currentTime;
    this.teardownSources();
    this._isPlaying = false;
    this.pausedAt = pos;
    void this.play();
  }

  // ---- Verification hook -------------------------------------------------

  /**
   * Exposes the scheduled start time of every live source. All `scheduledStart`
   * values being identical is a machine-checkable proof of phase alignment.
   */
  getDebugSchedule(): {
    startContextTime: number;
    startOffset: number;
    isPlaying: boolean;
    sources: { id: string; name: string; scheduledStart: number | null }[];
  } {
    return {
      startContextTime: this.startContextTime,
      startOffset: this.startOffset,
      isPlaying: this._isPlaying,
      sources: this.order.map((id) => {
        const t = this.tracks.get(id)!;
        return { id: t.id, name: t.name, scheduledStart: t.scheduledStart };
      }),
    };
  }

  /** Internal accessor for the mixdown/export routine. */
  getExportData(): {
    sampleRate: number;
    lengthSamples: number;
    masterVolume: number;
    tracks: { buffer: AudioBuffer; gain: number }[];
  } {
    const inputs: GainInput[] = this.order.map((id) => {
      const t = this.tracks.get(id)!;
      return { id: t.id, volume: t.volume, muted: t.muted, soloed: t.soloed };
    });
    const gains = resolveEffectiveGains(inputs);
    return {
      sampleRate: this.sampleRate,
      lengthSamples: this.timelineSamples,
      masterVolume: this._masterVolume,
      tracks: this.order.map((id) => {
        const t = this.tracks.get(id)!;
        return { buffer: t.buffer, gain: gains.get(id) ?? 0 };
      }),
    };
  }

  // ---- Snapshot / subscription ------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EngineState => this.snapshot;

  private rebuildTrackState(t: EngineTrack): void {
    t.state = {
      id: t.id,
      name: t.name,
      volume: t.volume,
      muted: t.muted,
      soloed: t.soloed,
      duration: t.sourceDuration,
      peaks: t.peaks,
    };
  }

  private emptySnapshot(): EngineState {
    return {
      tracks: [],
      isPlaying: false,
      duration: 0,
      masterVolume: this._masterVolume,
      loop: null,
      loopEnabled: false,
    };
  }

  private buildSnapshot(): void {
    this.snapshot = {
      tracks: this.order.map((id) => this.tracks.get(id)!.state),
      isPlaying: this._isPlaying,
      duration: this.durationSeconds,
      masterVolume: this._masterVolume,
      loop: this.loop,
      loopEnabled: this.loopEnabled,
    };
  }

  private notify(): void {
    this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  dispose(): void {
    this.teardownSources();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.listeners.clear();
  }
}

/** Zero-pad a buffer to `targetSamples` frames (returns the original if already long enough). */
function padBuffer(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  targetSamples: number,
): AudioBuffer {
  if (buffer.length >= targetSamples) return buffer;
  const out = ctx.createBuffer(
    buffer.numberOfChannels,
    targetSamples,
    buffer.sampleRate,
  );
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.getChannelData(c).set(buffer.getChannelData(c));
  }
  return out;
}
