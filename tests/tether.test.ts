import { describe, expect, it } from 'vitest';
import { advanceTetherProjectile, gripTetherAction } from '../src/tether';

describe('Quest grip tether input', () => {
  it('uses hysteresis for one fire and one release action', () => {
    expect(gripTetherAction(false, 0.6)).toBe('fire');
    expect(gripTetherAction(true, 0.4)).toBe('hold');
    expect(gripTetherAction(true, 0.2)).toBe('release');
    expect(gripTetherAction(false, 0.2)).toBe('idle');
  });
});

describe('visible tether projectile', () => {
  it('travels at finite speed and clamps at its target', () => {
    expect(advanceTetherProjectile(0, 40, 20, 0.1)).toEqual({ distance: 4, reached: false });
    expect(advanceTetherProjectile(19, 40, 20, 0.1)).toEqual({ distance: 20, reached: true });
  });
});
