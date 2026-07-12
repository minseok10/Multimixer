import { describe, it, expect } from 'vitest';
import { computePeaks, type ChannelSource } from './peaks';

function mono(samples: number[]): ChannelSource {
  const data = Float32Array.from(samples);
  return {
    length: data.length,
    numberOfChannels: 1,
    getChannelData: () => data,
  };
}

function stereo(left: number[], right: number[]): ChannelSource {
  const l = Float32Array.from(left);
  const r = Float32Array.from(right);
  return {
    length: l.length,
    numberOfChannels: 2,
    getChannelData: (c) => (c === 0 ? l : r),
  };
}

describe('computePeaks', () => {
  it('produces the requested number of buckets', () => {
    const p = computePeaks(mono([0, 1, -1, 0.5, -0.5, 0.2, -0.2, 0]), 4);
    expect(p.length).toBe(4);
    expect(p.min.length).toBe(4);
    expect(p.max.length).toBe(4);
  });

  it('captures per-bucket min and max', () => {
    // 8 samples, 4 buckets → 2 samples each.
    const p = computePeaks(mono([0, 1, -1, 0.5, -0.5, 0.2, -0.2, 0]), 4);
    expect(p.max[0]).toBeCloseTo(1);
    expect(p.min[0]).toBeCloseTo(0);
    expect(p.min[1]).toBeCloseTo(-1);
    expect(p.max[1]).toBeCloseTo(0.5);
  });

  it('downmixes channels by averaging', () => {
    const p = computePeaks(stereo([1, 1], [-1, -1]), 1);
    expect(p.max[0]).toBeCloseTo(0); // (1 + -1) / 2
    expect(p.min[0]).toBeCloseTo(0);
  });

  it('handles empty buffers without NaN', () => {
    const p = computePeaks(mono([]), 4);
    expect(p.length).toBe(4);
    expect([...p.min].every((v) => v === 0)).toBe(true);
    expect([...p.max].every((v) => v === 0)).toBe(true);
  });

  it('fills empty buckets with zero when buckets exceed samples', () => {
    const p = computePeaks(mono([0.5, -0.5]), 6);
    expect(p.length).toBe(6);
    expect([...p.max].some((v) => v > 0)).toBe(true);
    expect(Number.isNaN(p.min[5])).toBe(false);
  });
});
