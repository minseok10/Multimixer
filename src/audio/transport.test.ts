import { describe, it, expect } from 'vitest';
import {
  computePosition,
  formatTime,
  loopActive,
  positiveMod,
  wrapLoop,
  type PositionParams,
} from './transport';

const base: PositionParams = {
  isPlaying: true,
  startOffset: 0,
  startContextTime: 100,
  now: 100,
  duration: 30,
  loop: null,
  loopEnabled: false,
  pausedAt: 0,
};

describe('positiveMod', () => {
  it('always returns a non-negative result', () => {
    expect(positiveMod(-1, 4)).toBe(3);
    expect(positiveMod(5, 4)).toBe(1);
    expect(positiveMod(0, 4)).toBe(0);
  });
});

describe('loopActive', () => {
  it('requires enabled, present, and non-empty', () => {
    expect(loopActive(null, true)).toBe(false);
    expect(loopActive({ start: 2, end: 2 }, true)).toBe(false);
    expect(loopActive({ start: 2, end: 5 }, false)).toBe(false);
    expect(loopActive({ start: 2, end: 5 }, true)).toBe(true);
  });
});

describe('computePosition (linear)', () => {
  it('reports pausedAt while stopped', () => {
    expect(computePosition({ ...base, isPlaying: false, pausedAt: 12 }).position).toBe(12);
  });

  it('advances linearly with the clock', () => {
    expect(computePosition({ ...base, now: 105 }).position).toBeCloseTo(5);
    expect(computePosition({ ...base, now: 100 }).position).toBeCloseTo(0);
  });

  it('honours a non-zero start offset', () => {
    expect(computePosition({ ...base, startOffset: 10, now: 103 }).position).toBeCloseTo(13);
  });

  it('flags ended and clamps at duration', () => {
    const r = computePosition({ ...base, now: 140 });
    expect(r.position).toBe(30);
    expect(r.ended).toBe(true);
  });
});

describe('wrapLoop', () => {
  const loop = { start: 4, end: 8 }; // span 4
  it('passes through before loopEnd', () => {
    expect(wrapLoop(2, loop)).toBe(2);
    expect(wrapLoop(7.99, loop)).toBeCloseTo(7.99);
  });
  it('wraps at loopEnd back to loopStart', () => {
    expect(wrapLoop(8, loop)).toBeCloseTo(4);
    expect(wrapLoop(9, loop)).toBeCloseTo(5);
    expect(wrapLoop(12, loop)).toBeCloseTo(4); // exactly one span later
    expect(wrapLoop(13, loop)).toBeCloseTo(5);
  });
});

describe('computePosition (loop)', () => {
  const params: PositionParams = {
    ...base,
    startOffset: 4,
    duration: 30,
    loop: { start: 4, end: 8 },
    loopEnabled: true,
  };
  it('wraps within the loop region and never ends', () => {
    const r = computePosition({ ...params, now: 100 + 6 }); // raw = 10
    expect(r.position).toBeCloseTo(6);
    expect(r.ended).toBe(false);
    const r2 = computePosition({ ...params, now: 100 + 100 }); // long after
    expect(r2.position).toBeGreaterThanOrEqual(4);
    expect(r2.position).toBeLessThan(8);
    expect(r2.ended).toBe(false);
  });
});

describe('formatTime', () => {
  it('formats minutes, seconds, millis', () => {
    expect(formatTime(0)).toBe('0:00.000');
    expect(formatTime(65.25)).toBe('1:05.250');
    expect(formatTime(-3)).toBe('0:00.000');
  });
});
