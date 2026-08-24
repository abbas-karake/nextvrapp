
import { describe, expect, it } from 'vitest';
import { stepTraversalPhysics } from '../src/rope-physics';
import { traversalConfig } from '../src/traversal-config';
import { createRopeState, attachRope } from '../src/traversal-controller';

function makeRope(length: number) {
  const rope = createRopeState('left', 1.5, 80);
  attachRope(
    rope,
    { point: { x: 0, y: 30, z: 0 }, normal: { x: 0, y: -1, z: 0 }, objectId: 'tower' },
    { x: 0, y: 0, z: 0 },
    0,
    0,
  );
  rope.currentLength = length;
  rope.targetLength = length;
  return rope;
}

describe('battle-glide feel simulation', () => {
  it('reaches near-theoretical peak speed at the bottom of an arc', () => {
    const s = Math.SQRT1_2;
    const rope = makeRope(20);
    const state = {
      position: { x: -20 * s, y: 30 - 20 * s, z: 0 },
      velocity: { x: 12 * s, y: -12 * s, z: 0 },
      grounded: false,
      physicsRemainder: 0,
    };
    const cfg = {
      ...traversalConfig,
      comfort: { ...traversalConfig.comfort, maximumSpeed: 100 },
      swingPendulum: { ...traversalConfig.swingPendulum, autoReelRate: 0 },
    };
    const g = traversalConfig.physics.gravity;
    const dropHeight = 20 * (1 - s);
    const theoretical = Math.sqrt(144 - 2 * g * dropHeight);
    let maxSpeed = 0;
    for (let frame = 0; frame < 72 * 4; frame += 1) {
      stepTraversalPhysics(state, [rope], { x: 0, z: 0 }, 1 / 72, cfg);
      maxSpeed = Math.max(maxSpeed, Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z));
    }
    console.log(`bottom speed ${maxSpeed.toFixed(1)} vs theory ${theoretical.toFixed(1)} (${((maxSpeed / theoretical) * 100).toFixed(0)}%)`);
    expect(maxSpeed).toBeGreaterThan(theoretical * 0.93);
  });

  it('stays stable, finite, and rope-bounded over 30 seconds of swinging', () => {
    const rope = makeRope(20);
    const state = {
      position: { x: -14.14, y: 15.86, z: 0 },
      velocity: { x: 8.49, y: -8.49, z: 0 },
      grounded: false,
      physicsRemainder: 0,
    };
    const cfg = {
      ...traversalConfig,
      comfort: { ...traversalConfig.comfort, maximumSpeed: 100 },
      swingPendulum: { ...traversalConfig.swingPendulum, autoReelRate: 0 },
    };
    for (let frame = 0; frame < 72 * 30; frame += 1) {
      stepTraversalPhysics(state, [rope], { x: 0, z: 0 }, 1 / 72, cfg);
      const dist = Math.hypot(state.position.x, state.position.y - 30, state.position.z);
      expect(dist).toBeLessThanOrEqual(rope.currentLength + 0.35);
      expect(Number.isFinite(state.position.x + state.velocity.x)).toBe(true);
    }
    expect(Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)).toBeLessThan(60);
  });

  it('auto-reel pumps speed on successive swings', () => {
    const rope = makeRope(25);
    const state = {
      position: { x: -24, y: 28, z: 0 },
      velocity: { x: 14, y: 0, z: 0 },
      grounded: false,
      physicsRemainder: 0,
    };
    let maxSpeed = 0;
    for (let frame = 0; frame < 72 * 8; frame += 1) {
      stepTraversalPhysics(state, [rope], { x: 1, z: 0 }, 1 / 72, traversalConfig);
      maxSpeed = Math.max(maxSpeed, Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z));
    }
    console.log(`pumped to ${maxSpeed.toFixed(1)} m/s, rope ${rope.currentLength.toFixed(1)}m`);
    expect(rope.currentLength).toBeLessThan(24);
    expect(maxSpeed).toBeGreaterThan(20);
  });
});
