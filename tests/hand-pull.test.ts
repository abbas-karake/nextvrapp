import { describe, expect, it } from 'vitest';
import {
  createControllerMotionState,
  createPullGestureState,
  ignorePullGestureSample,
  sampleControllerLocalMotion,
  updatePullGesture,
  worldToPlayerLocalPosition,
  type ControllerMotionSampleResult,
  type PullGestureResult,
} from '../src/hand-pull';

function motionResult(): ControllerMotionSampleResult {
  return { velocity: { x: 0, y: 0, z: 0 }, speed: 0, trackingSpikeRejected: false };
}

function pullResult(): PullGestureResult {
  return {
    movementSpeed: 0,
    acceptedPullDistance: 0,
    impulseMagnitude: 0,
    impulseDirection: { x: 0, y: 0, z: 0 },
    pullStarted: false,
    phaseChanged: false,
  };
}

const pullTuning = {
  deadZoneSpeed: 0.08,
  activationSpeed: 0.1,
  minimumArmExtension: 0.2,
  recoveryDistance: 0.12,
  maximumPendingDistance: 0.65,
  maximumTrackedSpeed: 4,
  baseForce: 120,
  additionalForce: 850,
  minimumLaunchImpulse: 6,
  maxImpulsePerPull: 12,
};

describe('player-local physical hand sampling', () => {
  it('removes player-root translation from controller movement', () => {
    const output = { x: 0, y: 0, z: 0 };
    worldToPlayerLocalPosition(
      { x: 1, y: 1.4, z: -0.5 },
      { x: 0, y: 0, z: 0 },
      0,
      output,
    );
    const first = { ...output };
    worldToPlayerLocalPosition(
      { x: 11, y: 6.4, z: -3.5 },
      { x: 10, y: 5, z: -3 },
      0,
      output,
    );
    expect(output.x).toBeCloseTo(first.x, 10);
    expect(output.y).toBeCloseTo(first.y, 10);
    expect(output.z).toBeCloseTo(first.z, 10);
  });

  it('removes player-root yaw while preserving intentional local motion', () => {
    const output = { x: 0, y: 0, z: 0 };
    worldToPlayerLocalPosition(
      { x: 0, y: 1.2, z: -1 },
      { x: 0, y: 0, z: 0 },
      Math.PI / 2,
      output,
    );
    expect(output.x).toBeCloseTo(1, 10);
    expect(output.y).toBeCloseTo(1.2, 10);
    expect(output.z).toBeCloseTo(0, 10);
  });

  it('filters small controller deltas and rejects one-frame tracking spikes', () => {
    const state = createControllerMotionState();
    const output = motionResult();
    sampleControllerLocalMotion(
      state,
      { x: 0.7, y: 1.2, z: -0.2 },
      1 / 90,
      { smoothingRate: 18, maximumTrackedSpeed: 4 },
      output,
    );
    sampleControllerLocalMotion(
      state,
      { x: 0.701, y: 1.2, z: -0.2 },
      1 / 90,
      { smoothingRate: 18, maximumTrackedSpeed: 4 },
      output,
    );
    expect(output.trackingSpikeRejected).toBe(false);
    expect(output.speed).toBeGreaterThan(0);
    expect(output.speed).toBeLessThan(0.09);

    sampleControllerLocalMotion(
      state,
      { x: 1.701, y: 1.2, z: -0.2 },
      1 / 90,
      { smoothingRate: 18, maximumTrackedSpeed: 4 },
      output,
    );
    expect(output.trackingSpikeRejected).toBe(true);
    expect(output.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(output.speed).toBe(0);
  });

  it('starts a hard pull on the same sample that arms an extended hand', () => {
    const state = createPullGestureState();
    const output = pullResult();
    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.24, y: 1.2, z: 0 },
      controllerVelocity: { x: -2, y: 0, z: 0 },
      chestPosition: { x: 0, y: 1.2, z: 0 },
      deltaSeconds: 0.02,
    }, { ...pullTuning, minimumArmExtension: 0.2 }, output);
    expect(state.phase).toBe('pulling');
    expect(output.pullStarted).toBe(true);
    expect(output.acceptedPullDistance).toBeGreaterThan(0);
    expect(output.impulseMagnitude).toBeGreaterThan(0);
  });

  it('gives a light intentional pull a useful launch even while the attached rope is slack', () => {
    const state = createPullGestureState();
    const output = pullResult();
    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: false,
      controllerPosition: { x: 0.3, y: 1.2, z: 0 },
      controllerVelocity: { x: -0.12, y: 0, z: 0 },
      chestPosition: { x: 0, y: 1.2, z: 0 },
      deltaSeconds: 0.02,
    }, pullTuning, output);
    expect(state.phase).toBe('pulling');
    expect(output.pullStarted).toBe(true);
    expect(output.impulseMagnitude).toBeGreaterThanOrEqual(6);
    expect(output.impulseMagnitude).toBeLessThanOrEqual(12);
  });

  it('requires outward recovery before another full pull can start', () => {
    const state = createPullGestureState();
    const output = pullResult();
    const chest = { x: 0, y: 1.2, z: 0 };
    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.6, y: 1.2, z: 0 },
      controllerVelocity: { x: 0, y: 0, z: 0 },
      chestPosition: chest,
      deltaSeconds: 0.02,
    }, pullTuning, output);
    expect(state.phase).toBe('armed');

    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.58, y: 1.2, z: 0 },
      controllerVelocity: { x: -1, y: 0, z: 0 },
      chestPosition: chest,
      deltaSeconds: 0.02,
    }, pullTuning, output);
    expect(state.phase).toBe('pulling');
    expect(output.pullStarted).toBe(true);
    expect(output.acceptedPullDistance).toBeGreaterThan(0);

    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.58, y: 1.2, z: 0 },
      controllerVelocity: { x: 0, y: 0, z: 0 },
      chestPosition: chest,
      deltaSeconds: 0.02,
    }, pullTuning, output);
    expect(state.phase).toBe('recovery');
    expect(output.pullStarted).toBe(false);

    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.45, y: 1.2, z: 0 },
      controllerVelocity: { x: -1, y: 0, z: 0 },
      chestPosition: chest,
      deltaSeconds: 0.02,
    }, pullTuning, output);
    expect(state.phase).toBe('recovery');
    expect(output.pullStarted).toBe(false);

    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.71, y: 1.2, z: 0 },
      controllerVelocity: { x: 2, y: 0, z: 0 },
      chestPosition: chest,
      deltaSeconds: 0.1,
    }, pullTuning, output);
    expect(state.phase).toBe('armed');

    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.69, y: 1.2, z: 0 },
      controllerVelocity: { x: -1, y: 0, z: 0 },
      chestPosition: chest,
      deltaSeconds: 0.02,
    }, pullTuning, output);
    expect(state.phase).toBe('pulling');
    expect(output.pullStarted).toBe(true);
  });

  it('gives fast inward movement more pull budget and impulse than slow movement', () => {
    const samplePull = (inwardVelocity: number): { distance: number; impulse: number } => {
      const state = createPullGestureState();
      const output = pullResult();
      const chest = { x: 0, y: 1.2, z: 0 };
      updatePullGesture(state, {
        ropeActive: true,
        ropeNearTaut: true,
        controllerPosition: { x: 0.6, y: 1.2, z: 0 },
        controllerVelocity: { x: 0, y: 0, z: 0 },
        chestPosition: chest,
        deltaSeconds: 0.02,
      }, pullTuning, output);
      updatePullGesture(state, {
        ropeActive: true,
        ropeNearTaut: true,
        controllerPosition: { x: 0.58, y: 1.2, z: 0 },
        controllerVelocity: { x: -inwardVelocity, y: 0, z: 0 },
        chestPosition: chest,
        deltaSeconds: 0.02,
      }, pullTuning, output);
      return { distance: state.pendingShortenDistance, impulse: output.impulseMagnitude };
    };
    const slow = samplePull(0.25);
    const fast = samplePull(2);
    expect(fast.distance).toBeGreaterThan(slow.distance);
    expect(fast.impulse).toBeGreaterThan(slow.impulse);
    expect(fast.impulse).toBeLessThanOrEqual(pullTuning.maxImpulsePerPull);
  });

  it('allows borderline inward motion below launch activation to reel without impulse', () => {
    const state = createPullGestureState();
    const output = pullResult();
    const chest = { x: 0, y: 1.2, z: 0 };
    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.6, y: 1.2, z: 0 },
      controllerVelocity: { x: 0, y: 0, z: 0 },
      chestPosition: chest,
      deltaSeconds: 0.02,
    }, pullTuning, output);
    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.598, y: 1.2, z: 0 },
      controllerVelocity: { x: -0.09, y: 0, z: 0 },
      chestPosition: chest,
      deltaSeconds: 0.02,
    }, pullTuning, output);
    expect(state.phase).toBe('armed');
    expect(state.pendingShortenDistance).toBeGreaterThan(0);
    expect(output.impulseMagnitude).toBe(0);
    expect(output.pullStarted).toBe(false);
  });

  it('does not create pull budget from sub-dead-zone tremor', () => {
    const state = createPullGestureState();
    const output = pullResult();
    const chest = { x: 0, y: 1.2, z: 0 };
    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.6, y: 1.2, z: 0 },
      controllerVelocity: { x: 0, y: 0, z: 0 },
      chestPosition: chest,
      deltaSeconds: 0.02,
    }, pullTuning, output);
    for (let sample = 0; sample < 100; sample += 1) {
      updatePullGesture(state, {
        ropeActive: true,
        ropeNearTaut: true,
        controllerPosition: { x: 0.6, y: 1.2, z: 0 },
        controllerVelocity: { x: sample % 2 === 0 ? -0.05 : 0.05, y: 0, z: 0 },
        chestPosition: chest,
        deltaSeconds: 0.02,
      }, pullTuning, output);
    }
    expect(state.phase).toBe('armed');
    expect(state.pendingShortenDistance).toBe(0);
  });

  it('freezes the current stroke when a tracking sample is rejected', () => {
    const state = createPullGestureState();
    const output = pullResult();
    const chest = { x: 0, y: 1.2, z: 0 };
    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.6, y: 1.2, z: 0 },
      controllerVelocity: { x: 0, y: 0, z: 0 },
      chestPosition: chest,
      deltaSeconds: 0.02,
    }, pullTuning, output);
    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.56, y: 1.2, z: 0 },
      controllerVelocity: { x: -2, y: 0, z: 0 },
      chestPosition: chest,
      deltaSeconds: 0.02,
    }, pullTuning, output);
    const impulseBeforeSpike = state.accumulatedImpulse;
    expect(state.phase).toBe('pulling');
    ignorePullGestureSample(state, output);
    expect(state.phase).toBe('pulling');
    expect(state.accumulatedImpulse).toBe(impulseBeforeSpike);
    expect(output).toEqual({
      movementSpeed: 0,
      acceptedPullDistance: 0,
      impulseMagnitude: 0,
      impulseDirection: { x: 0, y: 0, z: 0 },
      pullStarted: false,
      phaseChanged: false,
    });
  });

  it('requires net outward recovery in either oscillation ordering', () => {
    const runOscillation = (firstVelocity: number, secondVelocity: number) => {
      const state = createPullGestureState();
      const output = pullResult();
      const chest = { x: 0, y: 1.2, z: 0 };
      state.phase = 'recovery';
      state.strokeDirection.x = -1;
      for (let cycle = 0; cycle < 10; cycle += 1) {
        for (const velocity of [firstVelocity, secondVelocity]) {
          updatePullGesture(state, {
            ropeActive: true,
            ropeNearTaut: true,
            controllerPosition: { x: 0.6, y: 1.2, z: 0 },
            controllerVelocity: { x: velocity, y: 0, z: 0 },
            chestPosition: chest,
            deltaSeconds: 0.02,
          }, pullTuning, output);
        }
      }
      return state;
    };
    const outwardFirst = runOscillation(1, -1);
    const inwardFirst = runOscillation(-1, 1);
    expect(outwardFirst.phase).toBe('recovery');
    expect(outwardFirst.recoveryDistance).toBeCloseTo(0, 10);
    expect(inwardFirst.phase).toBe('recovery');
    expect(inwardFirst.recoveryDistance).toBeCloseTo(0, 10);
  });

  it('returns recovery to armed even when the hand is close to the body', () => {
    const state = createPullGestureState();
    const output = pullResult();
    state.phase = 'recovery';
    state.strokeDirection.x = -1;
    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: true,
      controllerPosition: { x: 0.15, y: 1.2, z: 0 },
      controllerVelocity: { x: 2, y: 0, z: 0 },
      chestPosition: { x: 0, y: 1.2, z: 0 },
      deltaSeconds: 0.1,
    }, pullTuning, output);
    expect(state.phase).toBe('armed');
  });

  it('freezes a stroke through the actual tracking-spike rejection path', () => {
    const motion = createControllerMotionState();
    const motionOutput = motionResult();
    const gesture = createPullGestureState();
    const pullOutput = pullResult();
    gesture.phase = 'pulling';
    gesture.accumulatedImpulse = 3;
    sampleControllerLocalMotion(
      motion,
      { x: 0.6, y: 1.2, z: 0 },
      1 / 90,
      { smoothingRate: 18, maximumTrackedSpeed: 4 },
      motionOutput,
    );
    sampleControllerLocalMotion(
      motion,
      { x: 1.6, y: 1.2, z: 0 },
      1 / 90,
      { smoothingRate: 18, maximumTrackedSpeed: 4 },
      motionOutput,
    );
    expect(motionOutput.trackingSpikeRejected).toBe(true);
    if (motionOutput.trackingSpikeRejected) ignorePullGestureSample(gesture, pullOutput);
    expect(gesture.phase).toBe('pulling');
    expect(gesture.accumulatedImpulse).toBe(3);
    expect(pullOutput.impulseMagnitude).toBe(0);
    expect(pullOutput.acceptedPullDistance).toBe(0);
  });

  it('allows an intentional directional pull close to the body', () => {
    const state = createPullGestureState();
    const output = pullResult();
    updatePullGesture(state, {
      ropeActive: true,
      ropeNearTaut: false,
      controllerPosition: { x: 0.05, y: 1.2, z: 0 },
      controllerVelocity: { x: 0, y: -1, z: 0 },
      chestPosition: { x: 0, y: 1.2, z: 0 },
      deltaSeconds: 0.02,
    }, pullTuning, output);
    expect(state.phase).toBe('pulling');
    expect(output.pullStarted).toBe(true);
    expect(output.impulseDirection).toEqual({ x: -0, y: 1, z: -0 });
  });
});
