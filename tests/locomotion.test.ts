import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  getTerrainHeight,
  moveFromStick,
  moveFromViewDirection,
  startJump,
  stepVertical,
} from '../src/locomotion';
import { isJumpPressed, readThumbstick } from '../src/input';

describe('applyDeadzone', () => {
  it('ignores small controller drift', () => {
    expect(applyDeadzone(0.08)).toBe(0);
    expect(applyDeadzone(-0.1)).toBe(0);
  });

  it('rescales input outside the deadzone', () => {
    expect(applyDeadzone(1)).toBe(1);
    expect(applyDeadzone(-1)).toBe(-1);
  });
});

describe('moveFromStick', () => {
  it('moves forward along negative Z at zero yaw', () => {
    expect(moveFromStick(0, -1, 0, 3, 0.5)).toEqual({ x: 0, z: -1.5 });
  });

  it.each([
    ['forward', 0, -1, 0, -1],
    ['back', 0, 1, 0, 1],
    ['left', -1, 0, -1, 0],
    ['right', 1, 0, 1, 0],
  ])('moves %s relative to the current view', (_name, stickX, stickY, expectedX, expectedZ) => {
    const movement = moveFromViewDirection(stickX as number, stickY as number, 0, -1, 2, 0.5);
    expect(movement.x).toBeCloseTo(expectedX as number);
    expect(movement.z).toBeCloseTo(expectedZ as number);
  });

  it('keeps forward-turn diagonals aligned with the new viewer direction', () => {
    const movement = moveFromViewDirection(0.5, -1, 1, 0, 2, 0.5);
    expect(movement.x).toBeGreaterThan(0);
    expect(movement.z).toBeGreaterThan(0);
    expect(Math.hypot(movement.x, movement.z)).toBeLessThanOrEqual(1);
  });
});

describe('jumping', () => {
  it('starts only while grounded', () => {
    expect(startJump({ height: 0, velocity: 0, grounded: true }, 5)).toEqual({
      height: 0,
      velocity: 5,
      grounded: false,
    });
    expect(startJump({ height: 1, velocity: 2, grounded: false }, 5)).toEqual({
      height: 1,
      velocity: 2,
      grounded: false,
    });
  });

  it('lands without falling below the terrain', () => {
    const landed = stepVertical({ height: 0.01, velocity: -1, grounded: false }, 0.1, -12);
    expect(landed).toEqual({ height: 0, velocity: 0, grounded: true });
  });
});

describe('getTerrainHeight', () => {
  it('is deterministic and gentle at the starting point', () => {
    expect(getTerrainHeight(0, 0)).toBe(getTerrainHeight(0, 0));
    expect(Math.abs(getTerrainHeight(0, 0))).toBeLessThan(1);
  });
});

describe('Quest controller input', () => {
  it('reads the standard WebXR thumbstick axes', () => {
    expect(readThumbstick({ axes: [0, 0, 0.4, -0.8], buttons: [] })).toEqual({
      x: 0.4,
      y: -0.8,
    });
  });

  it('falls back to the first two axes', () => {
    expect(readThumbstick({ axes: [0.25, -0.5], buttons: [] })).toEqual({
      x: 0.25,
      y: -0.5,
    });
  });

  it('allows the face button or thumbstick press to jump', () => {
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false }));
    buttons[4] = { pressed: true };
    expect(isJumpPressed({ axes: [], buttons })).toBe(true);
    buttons[4] = { pressed: false };
    buttons[3] = { pressed: true };
    expect(isJumpPressed({ axes: [], buttons })).toBe(true);
  });
});
