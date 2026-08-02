import { describe, expect, it } from 'vitest';
import { ropeButtonAction } from '../src/input';

describe('primary trigger rope input', () => {
  it('fires and releases once with analog hysteresis', () => {
    expect(ropeButtonAction(false, 0.54)).toBe('idle');
    expect(ropeButtonAction(false, 0.56)).toBe('fire');
    expect(ropeButtonAction(true, 0.4)).toBe('hold');
    expect(ropeButtonAction(true, 0.31)).toBe('hold');
    expect(ropeButtonAction(true, 0.3)).toBe('release');
    expect(ropeButtonAction(false, 0.2)).toBe('idle');
  });
});
