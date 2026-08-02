import { describe, expect, it } from 'vitest';
import { createPullGestureState, updatePullGesture, type PullGestureResult } from '../src/hand-pull';
import { stepTraversalPhysics } from '../src/rope-physics';
import { traversalConfig } from '../src/traversal-config';
import {
  attachRope,
  createRopeState,
  discardSlackPullImpulse,
  queueRopePull,
} from '../src/traversal-controller';

function runPull(inwardSpeed: number): { upwardVelocity: number; ropeLength: number } {
  const rope = createRopeState('left', 1.5, 80);
  attachRope(
    rope,
    { point: { x: 0, y: 10, z: 0 }, normal: { x: 0, y: -1, z: 0 }, objectId: 'roof' },
    { x: 0, y: 0, z: 0 },
    0,
    0,
  );
  const gesture = createPullGestureState();
  const result: PullGestureResult = {
    inwardSpeed: 0,
    acceptedPullDistance: 0,
    impulseMagnitude: 0,
    pullStarted: false,
    phaseChanged: false,
  };
  const tuning = {
    deadZoneSpeed: traversalConfig.pull.deadZoneSpeed,
    activationSpeed: traversalConfig.pull.activationSpeed,
    minimumArmExtension: traversalConfig.pull.minimumArmExtension,
    recoveryDistance: traversalConfig.pull.recoveryDistance,
    maximumPendingDistance: traversalConfig.pull.maximumPendingDistance,
    maximumTrackedSpeed: traversalConfig.pull.maximumTrackedSpeed,
    baseForce: traversalConfig.pull.baseForce,
    additionalForce: traversalConfig.pull.additionalForce,
    maxImpulsePerPull: traversalConfig.pull.maxImpulsePerPull,
  };
  const chest = { x: 0, y: 1.2, z: 0 };
  updatePullGesture(gesture, {
    ropeActive: true,
    ropeNearTaut: true,
    controllerPosition: { x: 0.6, y: 1.2, z: 0 },
    controllerVelocity: { x: 0, y: 0, z: 0 },
    chestPosition: chest,
    deltaSeconds: 0.02,
  }, tuning, result);
  updatePullGesture(gesture, {
    ropeActive: true,
    ropeNearTaut: true,
    controllerPosition: { x: 0.58, y: 1.2, z: 0 },
    controllerVelocity: { x: -inwardSpeed, y: 0, z: 0 },
    chestPosition: chest,
    deltaSeconds: 0.02,
  }, tuning, result);
  queueRopePull(
    rope,
    result.acceptedPullDistance,
    result.impulseMagnitude,
    traversalConfig.rope.reelSensitivity,
    traversalConfig.pull.maximumPendingDistance,
    traversalConfig.pull.maxImpulsePerPull,
  );
  const state = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
    grounded: false,
    physicsRemainder: 0,
  };
  stepTraversalPhysics(
    state,
    [rope],
    { x: 0, z: 0 },
    1 / 72,
    { ...traversalConfig, physics: { ...traversalConfig.physics, gravity: 0 } },
  );
  return { upwardVelocity: state.velocity.y, ropeLength: rope.currentLength };
}

describe('physical hand pull integration', () => {
  it('shortens the rope and gives fast pulls more anchorward acceleration', () => {
    const slow = runPull(0.25);
    const fast = runPull(2);
    expect(slow.ropeLength).toBeLessThan(10);
    expect(fast.ropeLength).toBeLessThan(slow.ropeLength);
    expect(slow.upwardVelocity).toBeGreaterThan(0);
    expect(fast.upwardVelocity).toBeGreaterThan(slow.upwardVelocity);
  });

  it('discards queued propulsion across a zero-step slack interval', () => {
    const rope = createRopeState('left', 1.5, 80);
    attachRope(
      rope,
      { point: { x: 0, y: 10, z: 0 }, normal: { x: 0, y: -1, z: 0 }, objectId: 'roof' },
      { x: 0, y: 0, z: 0 },
      0,
      0,
    );
    queueRopePull(rope, 0, 3, 1, 0.65, 7.5);
    discardSlackPullImpulse(rope, false);
    expect(rope.pendingPullImpulse).toBe(0);
    const state = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 4, y: 0, z: 0 },
      grounded: false,
      physicsRemainder: 0,
    };
    stepTraversalPhysics(
      state,
      [rope],
      { x: 0, z: 0 },
      1 / 72,
      { ...traversalConfig, physics: { ...traversalConfig.physics, gravity: 0 } },
    );
    expect(state.velocity.y).toBe(0);
    expect(state.velocity.x).toBe(4);
  });
});
