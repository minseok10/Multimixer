import { describe, it, expect } from 'vitest';
import { beatTimes } from './metronome';

describe('beatTimes', () => {
  it('starts the first click at t=0', () => {
    expect(beatTimes(8, 120)[0]).toBe(0);
  });

  it('spaces clicks by 60/bpm and covers the timeline', () => {
    const t = beatTimes(8, 120); // beat = 0.5s
    expect(t).toHaveLength(16); // 0, 0.5, ..., 7.5
    expect(t[1]).toBeCloseTo(0.5);
    expect(t[t.length - 1]).toBeCloseTo(7.5);
  });

  it('uses uniform spacing', () => {
    const t = beatTimes(10, 90); // beat = 0.6667s
    for (let i = 1; i < t.length; i++) {
      expect(t[i] - t[i - 1]).toBeCloseTo(60 / 90);
    }
  });

  it('moves clicks later for a positive downbeat offset', () => {
    expect(beatTimes(2, 120, 0.037)).toEqual([0.037, 0.537, 1.037, 1.537]);
  });

  it('moves clicks earlier and skips the beat before the file boundary', () => {
    const t = beatTimes(2, 120, -0.037);
    expect(t).toHaveLength(4);
    expect(t[0]).toBeCloseTo(0.463);
    expect(t[3]).toBeCloseTo(1.963);
  });

  it('keeps an exactly shifted beat at the file boundary', () => {
    expect(beatTimes(1, 120, -0.5)[0]).toBe(0);
  });

  it('never emits a beat at or past the duration', () => {
    const t = beatTimes(8, 120);
    expect(t.every((x) => x < 8)).toBe(true);
  });

  it('returns empty for zero/negative duration or bpm', () => {
    expect(beatTimes(0, 120)).toEqual([]);
    expect(beatTimes(8, 0)).toEqual([]);
    expect(beatTimes(-5, 120)).toEqual([]);
    expect(beatTimes(8, Number.NaN)).toEqual([]);
    expect(beatTimes(8, 120, Number.NaN)).toEqual([]);
  });
});
