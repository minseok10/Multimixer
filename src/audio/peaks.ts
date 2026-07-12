/**
 * Pure waveform peak extraction.
 *
 * Reduces a decoded buffer to `bucketCount` min/max pairs (mono-downmixed) so
 * the canvas renderer can draw a fixed-resolution waveform regardless of track
 * length. Computed once per track after decode; O(samples).
 *
 * Accepts a minimal structural interface rather than a concrete `AudioBuffer`
 * so it can be unit-tested without Web Audio.
 */

import type { Peaks } from './types';

export interface ChannelSource {
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

const DEFAULT_BUCKETS = 2000;

export function computePeaks(
  buffer: ChannelSource,
  bucketCount: number = DEFAULT_BUCKETS,
): Peaks {
  const buckets = Math.max(1, Math.floor(bucketCount));
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);

  const length = buffer.length;
  const channels = buffer.numberOfChannels;

  if (length === 0 || channels === 0) {
    return { length: buckets, min, max };
  }

  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

  const samplesPerBucket = length / buckets;

  for (let b = 0; b < buckets; b++) {
    const startSample = Math.floor(b * samplesPerBucket);
    const endSample = Math.min(length, Math.floor((b + 1) * samplesPerBucket));

    let lo = Infinity;
    let hi = -Infinity;

    for (let i = startSample; i < endSample; i++) {
      // Downmix channels to mono by averaging.
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += data[c][i];
      const v = sum / channels;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }

    if (lo === Infinity) {
      // Empty bucket (more buckets than samples): flat line.
      lo = 0;
      hi = 0;
    }
    min[b] = lo;
    max[b] = hi;
  }

  return { length: buckets, min, max };
}
