import { describe, expect, it } from 'vitest';
import {
  createControllerMotionState,
  createPullGestureState,
  sampleControllerLocalMotion,
  updatePullGesture,
  type ControllerMotionSampleResult,
  type PullGestureResult,
} from '../src/hand-pull';
import { resolveTraversalGrounded, stepTraversalPhysics } from '../src/rope-physics';
import { traversalConfig } from '../src/traversal-config';
import {
  attachRope,
  beginRopeFlight,
  createRopeState,
  discardSlackPullImpulse,
  queueRopePull,
  releaseRope,
  ropeAcceptsPullInput,
} from '../src/traversal-controller';
import { moveBodyWithCollisionsSubstepped } from '../src/world';

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

  it('does not apply a flight pull after the shot is released or misses', () => {
    const rope = createRopeState('left', 1.5, 80);
    beginRopeFlight(rope);
    expect(ropeAcceptsPullInput(rope)).toBe(true);
    const released = releaseRope(rope);
    expect(released).toBe(true);
    expect(ropeAcceptsPullInput(rope)).toBe(false);
    queueRopePull(rope, 0.4, 7.5, 1, 0.65, 7.5);
    expect(rope.pendingShortenDistance).toBe(0);
    expect(rope.pendingPullImpulse).toBe(0);
    const state = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      physicsRemainder: 0,
    };
    stepTraversalPhysics(state, [rope], { x: 0, z: 0 }, 1 / 72, traversalConfig);
    expect(state.velocity.y).toBeLessThanOrEqual(0);
  });

  it('buffers a pull made during projectile flight and applies it only after attachment', () => {
    const frameSeconds = 1 / 90;
    const chest = { x: 0, y: 1.35, z: 0 };
    const initialHand = { x: 0, y: 1.35, z: -0.32 };
    const rope = createRopeState('left', 1.5, 80);
    beginRopeFlight(rope);
    const gesture = createPullGestureState();
    const motion = createControllerMotionState();
    const motionOutput: ControllerMotionSampleResult = {
      velocity: { x: 0, y: 0, z: 0 },
      speed: 0,
      trackingSpikeRejected: false,
    };
    const pullOutput: PullGestureResult = {
      inwardSpeed: 0,
      acceptedPullDistance: 0,
      impulseMagnitude: 0,
      pullStarted: false,
      phaseChanged: false,
    };
    sampleControllerLocalMotion(
      motion,
      initialHand,
      frameSeconds,
      {
        smoothingRate: traversalConfig.pull.controllerVelocitySmoothing,
        maximumTrackedSpeed: traversalConfig.pull.maximumTrackedSpeed,
      },
      motionOutput,
    );
    let finalHand = initialHand;
    for (let frame = 1; frame <= 8; frame += 1) {
      finalHand = {
        x: 0,
        y: 1.35,
        z: initialHand.z + (0.22 * frame) / 8,
      };
      sampleControllerLocalMotion(
        motion,
        finalHand,
        frameSeconds,
        {
          smoothingRate: traversalConfig.pull.controllerVelocitySmoothing,
          maximumTrackedSpeed: traversalConfig.pull.maximumTrackedSpeed,
        },
        motionOutput,
      );
      updatePullGesture(gesture, {
        ropeActive: ropeAcceptsPullInput(rope),
        ropeNearTaut: true,
        controllerPosition: finalHand,
        controllerVelocity: motionOutput.velocity,
        chestPosition: chest,
        deltaSeconds: frameSeconds,
      }, {
        deadZoneSpeed: traversalConfig.pull.deadZoneSpeed,
        activationSpeed: traversalConfig.pull.activationSpeed,
        minimumArmExtension: traversalConfig.pull.minimumArmExtension,
        recoveryDistance: traversalConfig.pull.recoveryDistance,
        maximumPendingDistance: traversalConfig.pull.maximumPendingDistance,
        maximumTrackedSpeed: traversalConfig.pull.maximumTrackedSpeed,
        baseForce: traversalConfig.pull.baseForce,
        additionalForce: traversalConfig.pull.additionalForce,
        maxImpulsePerPull: traversalConfig.pull.maxImpulsePerPull,
      }, pullOutput);
    }
    expect(gesture.pendingShortenDistance).toBeGreaterThan(0);
    expect(gesture.accumulatedImpulse).toBeGreaterThan(0);
    expect(rope.active).toBe(false);

    const anchor = { x: 0, y: 8, z: -8 };
    attachRope(
      rope,
      { point: anchor, normal: { x: 0, y: -1, z: 0 }, objectId: 'high-building' },
      finalHand,
      100,
      0,
    );
    queueRopePull(
      rope,
      gesture.pendingShortenDistance,
      gesture.accumulatedImpulse,
      traversalConfig.rope.reelSensitivity,
      traversalConfig.pull.maximumPendingDistance,
      traversalConfig.pull.maxImpulsePerPull,
    );
    const state = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      physicsRemainder: 0,
    };
    const steps = stepTraversalPhysics(
      state,
      [rope],
      { x: 0, z: 0, leftRopeOffset: finalHand },
      1 / 72,
      traversalConfig,
    );
    const collision = moveBodyWithCollisionsSubstepped(
      { x: 0, y: 0, z: 0 },
      state.position,
      0.32,
      2.2,
      [],
      100,
    );
    state.position = collision.position;
    state.grounded = resolveTraversalGrounded(true, steps, collision.landed);
    expect(state.position.y).toBeGreaterThan(0);
    expect(state.velocity.y).toBeGreaterThan(0);
    expect(state.grounded).toBe(false);
  });

  it('lifts a grounded Quest-scale player after a normal hand-to-chest pull', () => {
    const frameSeconds = 1 / 90;
    const chest = { x: 0, y: 1.35, z: 0 };
    const initialHand = { x: 0, y: 1.35, z: -0.32 };
    const anchor = { x: 0, y: 8, z: -8 };
    const rope = createRopeState('left', 1.5, 80);
    attachRope(
      rope,
      { point: anchor, normal: { x: 0, y: -1, z: 0 }, objectId: 'high-building' },
      initialHand,
      0,
      0,
    );
    const initialLength = rope.currentLength;
    const gesture = createPullGestureState();
    const motion = createControllerMotionState();
    const motionOutput: ControllerMotionSampleResult = {
      velocity: { x: 0, y: 0, z: 0 },
      speed: 0,
      trackingSpikeRejected: false,
    };
    const pullOutput: PullGestureResult = {
      inwardSpeed: 0,
      acceptedPullDistance: 0,
      impulseMagnitude: 0,
      pullStarted: false,
      phaseChanged: false,
    };
    const state = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      physicsRemainder: 0,
    };
    sampleControllerLocalMotion(
      motion,
      initialHand,
      frameSeconds,
      {
        smoothingRate: traversalConfig.pull.controllerVelocitySmoothing,
        maximumTrackedSpeed: traversalConfig.pull.maximumTrackedSpeed,
      },
      motionOutput,
    );

    let pullDetected = false;
    for (let frame = 1; frame <= 8; frame += 1) {
      const hand = {
        x: 0,
        y: 1.35,
        z: initialHand.z + (0.22 * frame) / 8,
      };
      sampleControllerLocalMotion(
        motion,
        hand,
        frameSeconds,
        {
          smoothingRate: traversalConfig.pull.controllerVelocitySmoothing,
          maximumTrackedSpeed: traversalConfig.pull.maximumTrackedSpeed,
        },
        motionOutput,
      );
      const handWorld = {
        x: state.position.x + hand.x,
        y: state.position.y + hand.y,
        z: state.position.z + hand.z,
      };
      const ropeNearTaut = Math.hypot(
        anchor.x - handWorld.x,
        anchor.y - handWorld.y,
        anchor.z - handWorld.z,
      ) >= rope.currentLength - traversalConfig.rope.slackTolerance;
      updatePullGesture(gesture, {
        ropeActive: true,
        ropeNearTaut,
        controllerPosition: hand,
        controllerVelocity: motionOutput.velocity,
        chestPosition: chest,
        deltaSeconds: frameSeconds,
      }, {
        deadZoneSpeed: traversalConfig.pull.deadZoneSpeed,
        activationSpeed: traversalConfig.pull.activationSpeed,
        minimumArmExtension: traversalConfig.pull.minimumArmExtension,
        recoveryDistance: traversalConfig.pull.recoveryDistance,
        maximumPendingDistance: traversalConfig.pull.maximumPendingDistance,
        maximumTrackedSpeed: traversalConfig.pull.maximumTrackedSpeed,
        baseForce: traversalConfig.pull.baseForce,
        additionalForce: traversalConfig.pull.additionalForce,
        maxImpulsePerPull: traversalConfig.pull.maxImpulsePerPull,
      }, pullOutput);
      pullDetected ||= pullOutput.acceptedPullDistance > 0;
      queueRopePull(
        rope,
        pullOutput.acceptedPullDistance,
        pullOutput.impulseMagnitude,
        traversalConfig.rope.reelSensitivity,
        traversalConfig.pull.maximumPendingDistance,
        traversalConfig.pull.maxImpulsePerPull,
      );
      const previous = { ...state.position };
      const wasGrounded = state.grounded;
      const physicsSteps = stepTraversalPhysics(
        state,
        [rope],
        { x: 0, z: 0, leftRopeOffset: hand },
        frameSeconds,
        traversalConfig,
      );
      const collision = moveBodyWithCollisionsSubstepped(
        previous,
        {
          x: state.position.x - previous.x,
          y: state.position.y - previous.y,
          z: state.position.z - previous.z,
        },
        0.32,
        2.2,
        [],
        100,
      );
      state.position = collision.position;
      if (collision.collidedY) state.velocity.y = 0;
      state.grounded = resolveTraversalGrounded(wasGrounded, physicsSteps, collision.landed);
    }

    expect(pullDetected).toBe(true);
    expect(rope.currentLength).toBeLessThan(initialLength);
    expect(state.position.y).toBeGreaterThan(0.15);
    expect(state.velocity.y).toBeGreaterThan(0);
    expect(state.grounded).toBe(false);
  });
});
