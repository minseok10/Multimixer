import { describe, it, expect } from 'vitest';
import {
  anySoloed,
  clampVolume,
  effectiveGain,
  resolveEffectiveGains,
  type GainInput,
} from './gains';

const track = (over: Partial<GainInput> & { id: string }): GainInput => ({
  volume: 1,
  muted: false,
  soloed: false,
  ...over,
});

describe('clampVolume', () => {
  it('clamps into [0, 1]', () => {
    expect(clampVolume(-0.5)).toBe(0);
    expect(clampVolume(1.5)).toBe(1);
    expect(clampVolume(0.3)).toBeCloseTo(0.3);
  });
  it('treats NaN as 0', () => {
    expect(clampVolume(NaN)).toBe(0);
  });
});

describe('anySoloed', () => {
  it('detects a soloed track', () => {
    expect(anySoloed([track({ id: 'a' }), track({ id: 'b', soloed: true })])).toBe(true);
    expect(anySoloed([track({ id: 'a' }), track({ id: 'b' })])).toBe(false);
  });
});

describe('effectiveGain', () => {
  it('returns volume when no solo is active', () => {
    expect(effectiveGain(track({ id: 'a', volume: 0.7 }), false)).toBeCloseTo(0.7);
  });
  it('mutes override volume', () => {
    expect(effectiveGain(track({ id: 'a', volume: 0.7, muted: true }), false)).toBe(0);
  });
  it('silences non-soloed tracks when a solo is active', () => {
    expect(effectiveGain(track({ id: 'a', volume: 0.7 }), true)).toBe(0);
  });
  it('plays a soloed track even while solo is active', () => {
    expect(effectiveGain(track({ id: 'a', volume: 0.7, soloed: true }), true)).toBeCloseTo(0.7);
  });
  it('mute wins over solo on the same track', () => {
    expect(
      effectiveGain(track({ id: 'a', volume: 0.7, soloed: true, muted: true }), true),
    ).toBe(0);
  });
});

describe('resolveEffectiveGains', () => {
  it('with no solo, each track plays at its own volume', () => {
    const g = resolveEffectiveGains([
      track({ id: 'a', volume: 0.5 }),
      track({ id: 'b', volume: 0.9, muted: true }),
    ]);
    expect(g.get('a')).toBeCloseTo(0.5);
    expect(g.get('b')).toBe(0);
  });

  it('with one solo, only soloed tracks are audible', () => {
    const g = resolveEffectiveGains([
      track({ id: 'a', volume: 0.5, soloed: true }),
      track({ id: 'b', volume: 0.9 }),
      track({ id: 'c', volume: 1, soloed: true }),
    ]);
    expect(g.get('a')).toBeCloseTo(0.5);
    expect(g.get('b')).toBe(0);
    expect(g.get('c')).toBeCloseTo(1);
  });
});
