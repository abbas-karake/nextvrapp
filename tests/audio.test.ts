import { describe, expect, it } from 'vitest';
import { synthesizeEffect, windGainForSpeed } from '../src/audio';

describe('procedural game audio', () => {
  it.each(['step', 'jump', 'land'] as const)('generates a bounded non-silent %s effect', (kind) => {
    const samples = synthesizeEffect(kind, 8000);
    expect(samples.length).toBeGreaterThan(400);
    expect(samples.some((sample) => Math.abs(sample) > 0.01)).toBe(true);
    expect(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1)).toBe(true);
  });

  it.each(['shoot', 'attach', 'release'] as const)('generates a bounded non-silent %s tether effect', (kind) => {
    const samples = synthesizeEffect(kind, 8000);
    expect(samples.some((sample) => Math.abs(sample) > 0.01)).toBe(true);
    expect(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1)).toBe(true);
  });

  it('increases wind smoothly with swing speed', () => {
    expect(windGainForSpeed(0)).toBe(0);
    expect(windGainForSpeed(18)).toBeGreaterThan(windGainForSpeed(8));
    expect(windGainForSpeed(100)).toBeLessThanOrEqual(0.22);
  });

  it('is deterministic so repeated sessions sound consistent', () => {
    expect(Array.from(synthesizeEffect('step', 1000))).toEqual(Array.from(synthesizeEffect('step', 1000)));
  });
});
