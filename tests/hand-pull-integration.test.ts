import { describe, expect, it } from 'vitest';
import {
  createControllerMotionState,
  createPullGestureState,
  playerLocalToWorldDirection,
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
  queueRopePull,
  releaseRope,
  ropeAcceptsPullInput,
} from '../src/traversal-controller';
import { moveBodyWithCollisionsSubstepped } from '../src/world';

function runPull(movementSpeed: number): { launchVelocityX: number; ropeLength: number } {
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
    movementSpeed: 0,
        acceptedPullDistance: 0,
        impulseMagnitude: 0,
        impulseDirection: { x: 0, y: 0, z: 0 },
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
    minimumLaunchImpulse: traversalConfig.pull.minimumLaunchImpulse,
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
    controllerVelocity: { x: -movementSpeed, y: 0, z: 0 },
    chestPosition: chest,
    deltaSeconds: 0.02,
  }, tuning, result);
  queueRopePull(
    rope,
    result.acceptedPullDistance,
    result.impulseMagnitude,
    result.impulseDirection,
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
  return { launchVelocityX: state.velocity.x, ropeLength: rope.currentLength };
}

describe('physical hand pull integration', () => {
  it('shortens the rope and gives faster motion a stronger opposite launch', () => {
    const slow = runPull(0.25);
    const fast = runPull(2);
    expect(slow.ropeLength).toBeLessThan(10);
    expect(fast.ropeLength).toBeLessThan(slow.ropeLength);
    expect(slow.launchVelocityX).toBeGreaterThan(4);
    expect(fast.launchVelocityX).toBeGreaterThan(slow.launchVelocityX);
  });

  it('preserves an attached-rope launch across a zero-step slack interval', () => {
    const rope = createRopeState('left', 1.5, 80);
    attachRope(
      rope,
      { point: { x: 0, y: 10, z: 0 }, normal: { x: 0, y: -1, z: 0 }, objectId: 'roof' },
      { x: 0, y: 0, z: 0 },
      0,
      0,
    );
    rope.currentLength = 12;
    rope.targetLength = 12;
    queueRopePull(rope, 0, 3, { x: 0, y: 1, z: 0 }, 1, 0.65, 12);
    const state = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 4, y: 0, z: 0 },
      grounded: false,
      physicsRemainder: 0,
    };
    const configWithoutGravity = {
      ...traversalConfig,
      physics: { ...traversalConfig.physics, gravity: 0 },
    };
    expect(stepTraversalPhysics(
      state,
      [rope],
      { x: 0, z: 0 },
      1 / 144,
      configWithoutGravity,
    )).toBe(0);
    expect(rope.pendingPullImpulse).toBe(3);
    expect(stepTraversalPhysics(
      state,
      [rope],
      { x: 0, z: 0 },
      1 / 144,
      configWithoutGravity,
    )).toBe(1);
    expect(state.velocity.y).toBeGreaterThanOrEqual(3);
    expect(state.velocity.x).toBe(4);
    expect(rope.pendingPullImpulse).toBe(0);
  });

  it('does not apply a flight pull after the shot is released or misses', () => {
    const rope = createRopeState('left', 1.5, 80);
    beginRopeFlight(rope);
    expect(ropeAcceptsPullInput(rope)).toBe(true);
    const released = releaseRope(rope);
    expect(released).toBe(true);
    expect(ropeAcceptsPullInput(rope)).toBe(false);
    queueRopePull(rope, 0.4, 7.5, { x: 0, y: 1, z: 0 }, 1, 0.65, 7.5);
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
    const sampledYaw = Math.PI / 2;
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
      movementSpeed: 0,
          acceptedPullDistance: 0,
          impulseMagnitude: 0,
          impulseDirection: { x: 0, y: 0, z: 0 },
      pullStarted: false,
      phaseChanged: false,
    };
    const worldPullDirection = { x: 0, y: 0, z: 0 };
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
        minimumLaunchImpulse: traversalConfig.pull.minimumLaunchImpulse,
        maxImpulsePerPull: traversalConfig.pull.maxImpulsePerPull,
      }, pullOutput);
      playerLocalToWorldDirection(
        pullOutput.impulseDirection,
        sampledYaw,
        worldPullDirection,
      );
      queueRopePull(
        rope,
        pullOutput.acceptedPullDistance,
        pullOutput.impulseMagnitude,
        worldPullDirection,
        traversalConfig.rope.reelSensitivity,
        traversalConfig.pull.maximumPendingDistance,
        traversalConfig.pull.maxImpulsePerPull,
      );
    }
    expect(gesture.pendingShortenDistance).toBeGreaterThan(0);
    expect(gesture.accumulatedImpulse).toBeGreaterThan(0);
    expect(rope.pendingPullImpulse).toBeGreaterThan(0);
    expect(rope.pendingPullDirection.x).toBeLessThan(-0.99);
    expect(rope.active).toBe(false);

    const beforeAttachment = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      physicsRemainder: 0,
    };
    stepTraversalPhysics(
      beforeAttachment,
      [rope],
      { x: 0, z: 0 },
      1 / 72,
      { ...traversalConfig, physics: { ...traversalConfig.physics, gravity: 0 } },
    );
    expect(beforeAttachment.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(rope.pendingPullImpulse).toBeGreaterThan(0);

    const playerYawAfterFlight = -Math.PI / 2;
    const incorrectlyRerotatedDirection = { x: 0, y: 0, z: 0 };
    playerLocalToWorldDirection(
      pullOutput.impulseDirection,
      playerYawAfterFlight,
      incorrectlyRerotatedDirection,
    );
    expect(incorrectlyRerotatedDirection.x).toBeGreaterThan(0.99);
    const anchor = { x: 0, y: 8, z: -8 };
    attachRope(
      rope,
      { point: anchor, normal: { x: 0, y: -1, z: 0 }, objectId: 'high-building' },
      finalHand,
      100,
      0,
    );
    rope.currentLength += 5;
    rope.targetLength = rope.currentLength;
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
    expect(state.position.x).toBeLessThan(-0.05);
    expect(state.velocity.x).toBeLessThan(-5);
    expect(Math.abs(state.velocity.z)).toBeLessThan(1e-10);
    expect(rope.pendingPullImpulse).toBe(0);
  });

  it('launches a grounded player from a light pull on a distant slack rope', () => {
    const anchor = { x: 0, y: 2, z: -50 };
    const hand = { x: 0.3, y: 1.35, z: 0 };
    const rope = createRopeState('left', 1.5, 80);
    attachRope(
      rope,
      { point: anchor, normal: { x: 0, y: -1, z: 0 }, objectId: 'distant-low-anchor' },
      hand,
      0,
      0,
    );
    rope.currentLength += 10;
    rope.targetLength = rope.currentLength;
    const gesture = createPullGestureState();
    const pullOutput: PullGestureResult = {
      movementSpeed: 0,
          acceptedPullDistance: 0,
          impulseMagnitude: 0,
          impulseDirection: { x: 0, y: 0, z: 0 },
      pullStarted: false,
      phaseChanged: false,
    };
    updatePullGesture(gesture, {
      ropeActive: true,
      ropeNearTaut: false,
      controllerPosition: hand,
      controllerVelocity: { x: 0, y: -0.12, z: 0 },
      chestPosition: { x: 0, y: 1.35, z: 0 },
      deltaSeconds: 0.02,
    }, {
      deadZoneSpeed: traversalConfig.pull.deadZoneSpeed,
      activationSpeed: traversalConfig.pull.activationSpeed,
      minimumArmExtension: traversalConfig.pull.minimumArmExtension,
      recoveryDistance: traversalConfig.pull.recoveryDistance,
      maximumPendingDistance: traversalConfig.pull.maximumPendingDistance,
      maximumTrackedSpeed: traversalConfig.pull.maximumTrackedSpeed,
      baseForce: traversalConfig.pull.baseForce,
      additionalForce: traversalConfig.pull.additionalForce,
      minimumLaunchImpulse: traversalConfig.pull.minimumLaunchImpulse,
      maxImpulsePerPull: traversalConfig.pull.maxImpulsePerPull,
    }, pullOutput);
    expect(pullOutput.impulseMagnitude).toBeGreaterThanOrEqual(6);
    queueRopePull(
      rope,
      pullOutput.acceptedPullDistance,
      pullOutput.impulseMagnitude,
      pullOutput.impulseDirection,
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
      { x: 0, z: 0, leftRopeOffset: hand },
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
    expect(state.position.y).toBeGreaterThan(0.02);
    expect(state.velocity.y).toBeGreaterThan(5);
    expect(state.velocity.z).toBeCloseTo(0, 10);
    expect(state.grounded).toBe(false);
  });

  it('moves a grounded player opposite a filtered hand-to-chest pull, not toward the anchor', () => {
    const frameSeconds = 1 / 90;
    const chest = { x: 0, y: 1.35, z: 0 };
    const initialHand = { x: 0, y: 1.35, z: -0.32 };
    const anchor = { x: 0, y: 8, z: 8 };
    const rope = createRopeState('left', 1.5, 80);
    attachRope(
      rope,
      { point: anchor, normal: { x: 0, y: -1, z: 0 }, objectId: 'high-building' },
      initialHand,
      0,
      0,
    );
    rope.currentLength += 5;
    rope.targetLength = rope.currentLength;
    const initialLength = rope.currentLength;
    const gesture = createPullGestureState();
    const motion = createControllerMotionState();
    const motionOutput: ControllerMotionSampleResult = {
      velocity: { x: 0, y: 0, z: 0 },
      speed: 0,
      trackingSpikeRejected: false,
    };
    const pullOutput: PullGestureResult = {
      movementSpeed: 0,
          acceptedPullDistance: 0,
          impulseMagnitude: 0,
          impulseDirection: { x: 0, y: 0, z: 0 },
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
        minimumLaunchImpulse: traversalConfig.pull.minimumLaunchImpulse,
        maxImpulsePerPull: traversalConfig.pull.maxImpulsePerPull,
      }, pullOutput);
      pullDetected ||= pullOutput.acceptedPullDistance > 0;
      queueRopePull(
        rope,
        pullOutput.acceptedPullDistance,
        pullOutput.impulseMagnitude,
        pullOutput.impulseDirection,
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
    expect(state.position.z).toBeLessThan(-0.15);
    expect(state.velocity.z).toBeLessThan(0);
    expect(state.position.y).toBeCloseTo(0, 10);
    expect(state.grounded).toBe(true);
  });
});
