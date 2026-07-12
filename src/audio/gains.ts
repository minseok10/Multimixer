/**
 * Pure solo/mute/volume resolution.
 *
 * Kept free of Web Audio so it can be unit-tested and reused by both the live
 * engine and the offline mix export. Given each track's fader/mute/solo flags,
 * it returns the *effective* linear gain that should be applied.
 *
 * Rules (standard DAW behaviour):
 *   - If ANY track is soloed, only soloed tracks are audible; every non-soloed
 *     track is silenced regardless of its own mute/volume.
 *   - A muted track is always silent.
 *   - Otherwise the track plays at its fader volume.
 */

export interface GainInput {
  id: string;
  volume: number;
  muted: boolean;
  soloed: boolean;
}

export const MAX_TRACK_VOLUME = 1.5;

/** True if at least one track is soloed. */
export function anySoloed(tracks: readonly GainInput[]): boolean {
  return tracks.some((t) => t.soloed);
}

/** Effective linear gain for one track, given whether a solo is active anywhere. */
export function effectiveGain(track: GainInput, soloActive: boolean): number {
  if (track.muted) return 0;
  if (soloActive && !track.soloed) return 0;
  return clampTrackVolume(track.volume);
}

/** Resolve effective gains for all tracks. Returns a Map keyed by track id. */
export function resolveEffectiveGains(
  tracks: readonly GainInput[],
): Map<string, number> {
  const soloActive = anySoloed(tracks);
  const out = new Map<string, number>();
  for (const t of tracks) {
    out.set(t.id, effectiveGain(t, soloActive));
  }
  return out;
}

/** Clamp a fader value into the valid [0, 1] range. */
export function clampVolume(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Clamp an individual stem fader into the valid [0, 1.5] range. */
export function clampTrackVolume(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > MAX_TRACK_VOLUME) return MAX_TRACK_VOLUME;
  return v;
}
