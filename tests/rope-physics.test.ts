import { describe, expect, it } from 'vitest';
import { resolveTraversalGrounded, solveRopeTension, stepTraversalPhysics, type RopeForceResult } from '../src/rope-physics';
import { traversalConfig } from '../src/traversal-config';
import { attachRope, createRopeState, releaseRope } from '../src/traversal-controller';

function emptyResult(): RopeForceResult {
  return { x: 99, y: 99, z: 99, tension: 99, stretch: 99, radialVelocity: 99, taut: true };
}

describe('tension-only rope physics', () => {
  it('preserves grounded state on render frames with no fixed physics step', () => {
    expect(resolveTraversalGrounded(true, 0, false)).toBe(true);
    expect(resolveTraversalGrounded(false, 0, true)).toBe(false);
    expect(resolveTraversalGrounded(true, 1, false)).toBe(false);
    expect(resolveTraversalGrounded(false, 1, true)).toBe(true);
  });

  it('honors slack tolerance instead of damping boundary chatter', () => {
    const output = emptyResult();
    const tuning = { stiffness: 110, damping: 14, maximumForce: 4500, slackTolerance: 0.02 };
    solveRopeTension(
      {
        ropeOrigin: { x: 0, y: 0, z: 0 },
        anchor: { x: 0, y: 5.01, z: 0 },
        playerVelocity: { x: 0, y: -4, z: 0 },
        currentLength: 5,
      },
      tuning,
      output,
    );
    expect(output.taut).toBe(false);
    expect(output.tension).toBe(0);
    solveRopeTension(
      {
        ropeOrigin: { x: 0, y: 0, z: 0 },
        anchor: { x: 0, y: 5.03, z: 0 },
        playerVelocity: { x: 0, y: -4, z: 0 },
        currentLength: 5,
      },
      tuning,
      output,
    );
    expect(output.taut).toBe(true);
    expect(output.tension).toBeGreaterThan(0);
  });

  it('applies no force while the rope is slack', () => {
    const output = emptyResult();
    const returned = solveRopeTension(
      {
        ropeOrigin: { x: 0, y: 0, z: 0 },
        anchor: { x: 0, y: 5, z: 0 },
        playerVelocity: { x: 4, y: 0, z: 0 },
        currentLength: 6,
      },
      { stiffness: 110, damping: 14, maximumForce: 4500, slackTolerance: 0.02 },
      output,
    );
    expect(returned).toBe(output);
    expect(output).toEqual({ x: 0, y: 0, z: 0, tension: 0, stretch: -1, radialVelocity: 0, taut: false });
  });

  it('pulls only toward the anchor when stretched without damping tangential motion', () => {
    const output = emptyResult();
    solveRopeTension(
      {
        ropeOrigin: { x: 0, y: 0, z: 0 },
        anchor: { x: 0, y: 5, z: 0 },
        playerVelocity: { x: 10, y: 0, z: 0 },
        currentLength: 4,
      },
      { stiffness: 110, damping: 14, maximumForce: 4500, slackTolerance: 0.02 },
      output,
    );
    expect(output.taut).toBe(true);
    expect(output.stretch).toBe(1);
    expect(output.radialVelocity).toBe(0);
    expect(output).toMatchObject({ x: 0, y: 110, z: 0, tension: 110 });
  });

  it('adds radial damping only while the player moves outward', () => {
    const outward = emptyResult();
    const inward = emptyResult();
    const tuning = { stiffness: 110, damping: 14, maximumForce: 4500, slackTolerance: 0.02 };
    solveRopeTension(
      {
        ropeOrigin: { x: 0, y: 0, z: 0 },
        anchor: { x: 0, y: 5, z: 0 },
        playerVelocity: { x: 0, y: -2, z: 0 },
        currentLength: 4,
      },
      tuning,
      outward,
    );
    solveRopeTension(
      {
        ropeOrigin: { x: 0, y: 0, z: 0 },
        anchor: { x: 0, y: 5, z: 0 },
        playerVelocity: { x: 0, y: 2, z: 0 },
        currentLength: 4,
      },
      tuning,
      inward,
    );
    expect(outward.radialVelocity).toBe(2);
    expect(outward.tension).toBe(138);
    expect(inward.radialVelocity).toBe(-2);
    expect(inward.tension).toBe(110);
  });

  it('clamps extreme tension without producing non-finite force', () => {
    const output = emptyResult();
    solveRopeTension(
      {
        ropeOrigin: { x: 0, y: 0, z: 0 },
        anchor: { x: 0, y: 100, z: 0 },
        playerVelocity: { x: 0, y: -1000, z: 0 },
        currentLength: 1,
      },
      { stiffness: 110, damping: 14, maximumForce: 4500, slackTolerance: 0.02 },
      output,
    );
    expect(output.tension).toBe(4500);
    expect([output.x, output.y, output.z, output.tension].every(Number.isFinite)).toBe(true);
  });

  it('adds inward rope acceleration without replacing tangential momentum', () => {
    const rope = createRopeState('left', 1.5, 80);
    attachRope(
      rope,
      { point: { x: 0, y: 5, z: 0 }, normal: { x: 0, y: -1, z: 0 }, objectId: 'tower' },
      { x: 0, y: 0, z: 0 },
      0,
      0,
    );
    rope.currentLength = 4;
    rope.targetLength = 4;
    const state = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 10, y: -2, z: 0 },
      grounded: false,
      physicsRemainder: 0,
    };
    stepTraversalPhysics(
      state,
      [rope],
      { x: 0, z: 0 },
      1 / 72,
      {
        ...traversalConfig,
        physics: { ...traversalConfig.physics, gravity: 0 },
        airControl: { ...traversalConfig.airControl, acceleration: 0 },
      },
    );
    expect(state.velocity.x).toBeCloseTo(10, 10);
    expect(state.velocity.y).toBeGreaterThan(-2);
    expect(state.position.x).toBeGreaterThan(0);
  });

  it('keeps a falling pendulum bounded and finite in the metre-scale world', () => {
    const rope = createRopeState('left', 1.5, 80);
    attachRope(
      rope,
      { point: { x: 0, y: 10, z: 0 }, normal: { x: 0, y: -1, z: 0 }, objectId: 'tower' },
      { x: 0, y: 5, z: 0 },
      0,
      0,
    );
    const state = {
      position: { x: 0, y: 5, z: 0 },
      velocity: { x: 8, y: 0, z: 0 },
      grounded: false,
      physicsRemainder: 0,
    };
    let maximumDistance = 0;
    for (let frame = 0; frame < 144; frame += 1) {
      stepTraversalPhysics(state, [rope], { x: 0, z: 0 }, 1 / 72, traversalConfig);
      maximumDistance = Math.max(
        maximumDistance,
        Math.hypot(state.position.x, state.position.y - 10, state.position.z),
      );
    }
    expect(maximumDistance).toBeLessThanOrEqual(6);
    expect([
      state.position.x,
      state.position.y,
      state.position.z,
      state.velocity.x,
      state.velocity.y,
      state.velocity.z,
    ].every(Number.isFinite)).toBe(true);
  });

  it('applies only the small attachment preload without continuous auto-reel', () => {
    const rope = createRopeState('left', 1.5, 80);
    attachRope(
      rope,
      { point: { x: 0, y: 10, z: 0 }, normal: { x: 0, y: -1, z: 0 }, objectId: 'roof' },
      { x: 0, y: 0, z: 0 },
      0,
      0.02,
    );
    const preloadedLength = rope.currentLength;
    expect(preloadedLength).toBeCloseTo(9.8, 10);
    expect(rope.targetLength).toBe(preloadedLength);
    const state = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      physicsRemainder: 0,
    };
    for (let frame = 0; frame < 72; frame += 1) {
      stepTraversalPhysics(
        state,
        [rope],
        { x: 0, z: 0 },
        1 / 72,
        { ...traversalConfig, physics: { ...traversalConfig.physics, gravity: 0 } },
      );
    }
    expect(rope.currentLength).toBe(preloadedLength);
    expect(rope.targetLength).toBe(preloadedLength);
  });

  it('fades aerial control to zero at its maximum influence speed', () => {
    const state = {
      position: { x: 0, y: 10, z: 0 },
      velocity: { x: 25, y: 0, z: 0 },
      grounded: false,
      physicsRemainder: 0,
    };
    stepTraversalPhysics(
      state,
      [],
      { x: 1, z: 0 },
      1 / 72,
      {
        ...traversalConfig,
        physics: { ...traversalConfig.physics, gravity: 0 },
        comfort: { ...traversalConfig.comfort, maximumSpeed: 100 },
      },
    );
    expect(state.velocity.x).toBe(25);
  });

  it('enforces the configured maximum traversal speed', () => {
    const state = {
      position: { x: 0, y: 10, z: 0 },
      velocity: { x: 40, y: 0, z: 0 },
      grounded: false,
      physicsRemainder: 0,
    };
    stepTraversalPhysics(
      state,
      [],
      { x: 0, z: 0 },
      1 / 72,
      { ...traversalConfig, physics: { ...traversalConfig.physics, gravity: 0 } },
    );
    expect(Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z))
      .toBeLessThanOrEqual(traversalConfig.comfort.maximumSpeed);
  });

  it('preserves instantaneous velocity when a rope is released', () => {
    const rope = createRopeState('left', 1.5, 80);
    attachRope(
      rope,
      { point: { x: 0, y: 8, z: 0 }, normal: { x: 0, y: -1, z: 0 }, objectId: 'tower' },
      { x: 0, y: 3, z: 0 },
      0,
      0,
    );
    releaseRope(rope);
    const state = {
      position: { x: 0, y: 3, z: 0 },
      velocity: { x: 12, y: 5, z: -3 },
      grounded: false,
      physicsRemainder: 0,
    };
    stepTraversalPhysics(
      state,
      [rope],
      { x: 0, z: 0 },
      1 / 72,
      {
        ...traversalConfig,
        physics: { ...traversalConfig.physics, gravity: 0 },
        airControl: { ...traversalConfig.airControl, acceleration: 0 },
      },
    );
    expect(state.velocity).toEqual({ x: 12, y: 5, z: -3 });
  });
});
