import { describe, expect, it } from 'vitest';
import { constrainTetherVelocity, shouldUseGroundLocomotion, stepSwingPhysics, type SwingState, type TetherConstraint } from '../src/swing';
import { moveBodyWithCollisionsSubstepped, moveCircleWithCollisionsSubstepped, type Collider2D } from '../src/world';

const airborne: SwingState = {
  position: { x: 0, y: 5, z: 0 },
  velocity: { x: 8, y: 0, z: 0 },
  grounded: false,
};

describe('tether swing physics', () => {
  it('prevents the player body from stretching beyond rope length', () => {
    const tether: TetherConstraint = { anchor: { x: 0, y: 10, z: 0 }, length: 5 };
    const result = stepSwingPhysics(airborne, [tether], { x: 0, z: 0, reel: false }, 0.1, { bodyOffsetY: 0 });
    const body = result.state.position;
    const distance = Math.hypot(body.x, body.y - 10, body.z);
    expect(distance).toBeLessThanOrEqual(5.001);
  });

  it('preserves tangential momentum after release', () => {
    const result = stepSwingPhysics(airborne, [], { x: 0, z: 0, reel: false }, 0.05, { bodyOffsetY: 0 });
    expect(result.state.velocity.x).toBeGreaterThan(7.8);
    expect(result.state.position.x).toBeGreaterThan(0.35);
  });

  it('keeps released swing momentum instead of switching immediately to walking', () => {
    const releasedOnGround: SwingState = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 7, y: 0, z: 2 },
      grounded: true,
    };
    expect(shouldUseGroundLocomotion(releasedOnGround, false, false)).toBe(false);
    expect(shouldUseGroundLocomotion({ ...releasedOnGround, velocity: { x: 0.1, y: 0, z: 0.1 } }, false, false)).toBe(true);
  });

  it('reels attached ropes in while grip remains held', () => {
    const tether: TetherConstraint = { anchor: { x: 0, y: 10, z: 0 }, length: 8 };
    const result = stepSwingPhysics(airborne, [tether], { x: 0, z: 0, reel: true }, 0.5, { bodyOffsetY: 0 });
    expect(result.tethers[0].length).toBeLessThan(8);
    expect(result.tethers[0].length).toBeGreaterThanOrEqual(3.5);
  });

  it('keeps opposing dual-rope lengths geometrically feasible while reeling', () => {
    const tethers: TetherConstraint[] = [
      { anchor: { x: -5, y: 5, z: 0 }, length: 5.1 },
      { anchor: { x: 5, y: 5, z: 0 }, length: 5.1 },
    ];
    const result = stepSwingPhysics(
      { position: { x: 0, y: 5, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, grounded: false },
      tethers,
      { x: 0, z: 0, reel: true },
      0.1,
      { bodyOffsetY: 0, reelSpeed: 4.5, minimumRopeLength: 2 },
    );
    const anchorDistance = Math.hypot(
      tethers[1].anchor.x - tethers[0].anchor.x,
      tethers[1].anchor.y - tethers[0].anchor.y,
      tethers[1].anchor.z - tethers[0].anchor.z,
    );
    expect(result.tethers[0].length + result.tethers[1].length).toBeGreaterThanOrEqual(anchorDistance);
  });

  it('converges every feasible opposing rope within tolerance', () => {
    const tethers: TetherConstraint[] = [
      { anchor: { x: -5, y: 8, z: 0 }, length: 5 },
      { anchor: { x: 5, y: 8, z: 0 }, length: 5 },
    ];
    const result = stepSwingPhysics(
      { position: { x: 1, y: 4, z: 3 }, velocity: { x: 0, y: 0, z: 0 }, grounded: false },
      tethers,
      { x: 0, z: 0, reel: false },
      1 / 90,
      { bodyOffsetY: 0, gravity: 0, drag: 0 },
    );
    for (const tether of result.tethers) {
      const distance = Math.hypot(
        result.state.position.x - tether.anchor.x,
        result.state.position.y - tether.anchor.y,
        result.state.position.z - tether.anchor.z,
      );
      expect(distance).toBeLessThanOrEqual(tether.length + 0.001);
    }
  });

  it('removes outward velocity from every taut obtuse dual-rope constraint', () => {
    const tethers: TetherConstraint[] = [
      { anchor: { x: -4, y: 8, z: 0 }, length: 5 },
      { anchor: { x: 4, y: 8, z: 0 }, length: 5 },
    ];
    const position = { x: 0, y: 8, z: 3 };
    const velocity = constrainTetherVelocity(
      { x: -0.576, y: 0, z: 0.768 },
      position,
      tethers,
      0,
    );
    for (const tether of tethers) {
      const dx = position.x - tether.anchor.x;
      const dy = position.y - tether.anchor.y;
      const dz = position.z - tether.anchor.z;
      const distance = Math.hypot(dx, dy, dz);
      const outwardSpeed = (velocity.x * dx + velocity.y * dy + velocity.z * dz) / distance;
      expect(Number.isFinite(outwardSpeed)).toBe(true);
      expect(outwardSpeed).toBeLessThanOrEqual(0.0001);
    }
  });

  it('converges velocity for near-tangent opposing ropes', () => {
    const halfAnchorDistance = 4.999;
    const circleHeight = Math.sqrt(25 - halfAnchorDistance * halfAnchorDistance);
    const tethers: TetherConstraint[] = [
      { anchor: { x: -halfAnchorDistance, y: 8, z: 0 }, length: 5 },
      { anchor: { x: halfAnchorDistance, y: 8, z: 0 }, length: 5 },
    ];
    const position = { x: 0, y: 8, z: circleHeight };
    const firstNormal = { x: halfAnchorDistance / 5, y: 0, z: circleHeight / 5 };
    const secondNormal = { x: -halfAnchorDistance / 5, y: 0, z: circleHeight / 5 };
    const normalDot = firstNormal.x * secondNormal.x + firstNormal.z * secondNormal.z;
    const velocity = constrainTetherVelocity(
      {
        x: secondNormal.x - normalDot * firstNormal.x,
        y: 0,
        z: secondNormal.z - normalDot * firstNormal.z,
      },
      position,
      tethers,
      0,
    );
    for (const normal of [firstNormal, secondNormal]) {
      const outwardSpeed = velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z;
      expect(outwardSpeed).toBeLessThanOrEqual(0.00001);
    }
  });

  it('converges velocity for ultra-near-tangent ropes at maximum speed', () => {
    const angle = 5e-6;
    const firstNormal = { x: 1, y: 0, z: 0 };
    const secondNormal = { x: -Math.cos(angle), y: Math.sin(angle), z: 0 };
    const position = { x: 0, y: 0, z: 0 };
    const tethers: TetherConstraint[] = [
      { anchor: { x: -5, y: 0, z: 0 }, length: 5 },
      {
        anchor: { x: -secondNormal.x * 5, y: -secondNormal.y * 5, z: 0 },
        length: 5,
      },
    ];
    const velocity = constrainTetherVelocity({ x: 0, y: 28, z: 0 }, position, tethers, 0);
    for (const normal of [firstNormal, secondNormal]) {
      const outwardSpeed = velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z;
      expect(outwardSpeed).toBeLessThanOrEqual(0.00001);
    }
  });

  it('produces the same result for different render-frame partitions', () => {
    const initial: SwingState = {
      position: { x: 0, y: 8, z: 0 },
      velocity: { x: 4, y: 2, z: -1 },
      grounded: false,
    };
    const advance = (frameDelta: number, frames: number): SwingState => {
      let state = initial;
      for (let frame = 0; frame < frames; frame += 1) {
        state = stepSwingPhysics(state, [], { x: 0.2, z: -0.1, reel: false }, frameDelta).state;
      }
      return state;
    };
    const at72Hz = advance(1 / 72, 9);
    const at80Hz = advance(1 / 80, 10);
    expect(at72Hz.position.x).toBeCloseTo(at80Hz.position.x, 10);
    expect(at72Hz.position.y).toBeCloseTo(at80Hz.position.y, 10);
    expect(at72Hz.velocity.z).toBeCloseTo(at80Hz.velocity.z, 10);
  });
});

describe('high-speed swing collision', () => {
  it('lands on a building roof when descending fast through its height', () => {
    const building: Collider2D = { minX: -2, maxX: 2, minZ: -2, maxZ: 2, minY: 0, maxY: 10 };
    const result = moveBodyWithCollisionsSubstepped(
      { x: 0, y: 14, z: 0 },
      { x: 0, y: -8, z: 0 },
      0.3,
      1.8,
      [building],
      100,
    );
    expect(result.position.y).toBe(10);
    expect(result.landed).toBe(true);
  });

  it('does not remain grounded after an oblique sweep leaves the roof edge', () => {
    const building: Collider2D = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: 0, maxY: 10 };
    const result = moveBodyWithCollisionsSubstepped(
      { x: 0, y: 10.2, z: 0 },
      { x: 3, y: -1.2, z: 0 },
      0.3,
      1.8,
      [building],
      100,
    );
    expect(result.position.x).toBeGreaterThan(1.3);
    expect(result.position.y).toBeLessThan(10);
    expect(result.landed).toBe(false);
    expect(result.collidedY).toBe(false);
  });

  it('substeps fast movement so it cannot tunnel through buildings', () => {
    const building: Collider2D = { minX: 2, maxX: 4, minZ: -1, maxZ: 1, minY: 0, maxY: 20 };
    const result = moveCircleWithCollisionsSubstepped(
      { x: 0, z: 0 },
      { x: 6, z: 0 },
      0.3,
      [building],
      100,
      1.6,
    );
    expect(result.x).toBeLessThan(2);
  });
});
