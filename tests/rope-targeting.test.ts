import { describe, expect, it } from 'vitest';
import { chooseRopeTarget, type RopeTargetCandidate } from '../src/rope-targeting';

function candidate(overrides: Partial<RopeTargetCandidate>): RopeTargetCandidate {
  return {
    point: { x: 0, y: 10, z: -20 },
    normal: { x: 0, y: 0, z: 1 },
    objectId: 'building',
    distance: 20,
    angleDegrees: 0,
    direct: false,
    visible: true,
    swingable: true,
    ...overrides,
  };
}

describe('rope target selection', () => {
  it('always prefers a valid exact raycast hit over assisted candidates', () => {
    const assisted = candidate({ objectId: 'assisted', angleDegrees: 0.5, distance: 10 });
    const direct = candidate({ objectId: 'direct', direct: true, angleDegrees: 0, distance: 35 });
    expect(chooseRopeTarget([assisted, direct], { maxRange: 80, minimumDistance: 2, assistConeAngleDegrees: 4 }))
      .toBe(direct);
  });

  it('rejects occluded, non-swingable, too-near, and out-of-range anchors', () => {
    const valid = candidate({ objectId: 'valid', distance: 30, angleDegrees: 2 });
    expect(chooseRopeTarget([
      candidate({ objectId: 'non-swingable', direct: true, swingable: false }),
      candidate({ objectId: 'occluded', visible: false }),
      candidate({ objectId: 'too-near', distance: 1 }),
      candidate({ objectId: 'too-far', distance: 81 }),
      valid,
    ], { maxRange: 80, minimumDistance: 2, assistConeAngleDegrees: 4 })).toBe(valid);
  });
});
