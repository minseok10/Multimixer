/**
 * Pure transport math: turning the shared audio clock into a playback position,
 * including loop wrapping. No Web Audio here so it can be unit-tested.
 *
 * The audio clock is authoritative. Playback always begins by scheduling every
 * source at a single context time `startContextTime`, playing from `startOffset`
 * seconds into the buffers. The current position is therefore a pure function of
 * `ctx.currentTime`, which guarantees the visual playhead can never disagree with
 * what is actually being heard.
 */

import type { LoopRegion } from './types';

export interface PositionParams {
  /** Whether transport is currently running. */
  isPlaying: boolean;
  /** Position (s) within the buffers where the current playback started. */
  startOffset: number;
  /** Context time (s) at which playback was scheduled to start. */
  startContextTime: number;
  /** Current value of AudioContext.currentTime (s). */
  now: number;
  /** Timeline length (s) — longest track. */
  duration: number;
  /** Active loop region, or null. Only applied when `loopEnabled`. */
  loop: LoopRegion | null;
  loopEnabled: boolean;
  /** Position (s) to report while paused/stopped. */
  pausedAt: number;
}

export interface PositionResult {
  /** Playback position in seconds. */
  position: number;
  /** True when a non-looping transport has run past the end. */
  ended: boolean;
}

/** Always-positive modulo (JS `%` keeps the sign of the dividend). */
export function positiveMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** True if a loop region is usable (enabled, present, non-empty). */
export function loopActive(loop: LoopRegion | null, loopEnabled: boolean): loop is LoopRegion {
  return loopEnabled && loop !== null && loop.end > loop.start;
}

/**
 * Wrap a raw (monotonically increasing) position into a loop region.
 * The span before `loop.start` plays once, matching a native
 * AudioBufferSourceNode with `loopStart`/`loopEnd` set.
 */
export function wrapLoop(raw: number, loop: LoopRegion): number {
  if (raw < loop.end) return raw;
  const span = loop.end - loop.start;
  return loop.start + positiveMod(raw - loop.start, span);
}

/** Compute the current playback position from the audio clock. */
export function computePosition(p: PositionParams): PositionResult {
  if (!p.isPlaying) {
    return { position: clamp(p.pausedAt, 0, p.duration), ended: false };
  }

  const raw = p.startOffset + (p.now - p.startContextTime);

  if (loopActive(p.loop, p.loopEnabled)) {
    return { position: wrapLoop(raw, p.loop), ended: false };
  }

  if (raw >= p.duration) {
    return { position: p.duration, ended: true };
  }
  return { position: clamp(raw, 0, p.duration), ended: false };
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Format seconds as m:ss.mmm for the transport readout. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  const millis = Math.floor((s % 1) * 1000);
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis
    .toString()
    .padStart(3, '0')}`;
}
