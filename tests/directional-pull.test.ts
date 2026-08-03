import { describe, expect, it } from 'vitest';
import {
  createPullGestureState,
  playerLocalToWorldDirection,
  updatePullGesture,
  worldToPlayerLocalPosition,
  type PullGestureResult,
} from '../src/hand-pull';

const tuning = {
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

function result(): PullGestureResult {
  return {
    movementSpeed: 0,
    acceptedPullDistance: 0,
    impulseMagnitude: 0,
    impulseDirection: { x: 0, y: 0, z: 0 },
    pullStarted: false,
    phaseChanged: false,
  };
}

function sample(velocity: { x: number; y: number; z: number }): PullGestureResult {
  const state = createPullGestureState();
  const output = result();
  updatePullGesture(state, {
    ropeActive: true,
    ropeNearTaut: false,
    controllerPosition: { x: 0.35, y: 1.35, z: 0 },
    controllerVelocity: velocity,
    chestPosition: { x: 0, y: 1.35, z: 0 },
    deltaSeconds: 0.02,
  }, tuning, output);
  expect(state.phase).toBe('pulling');
  return output;
}

describe('motion-opposed directional rope pulls', () => {
  it.each([
    [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }],
    [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    [{ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }],
    [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }],
    [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }],
    [{ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }],
  ])('opposes motion on every signed cardinal axis', (velocity, expected) => {
    const output = sample(velocity);
    expect(output.impulseDirection.x).toBeCloseTo(expected.x, 10);
    expect(output.impulseDirection.y).toBeCloseTo(expected.y, 10);
    expect(output.impulseDirection.z).toBeCloseTo(expected.z, 10);
  });

  it('launches exactly upward when the hand stroke moves down', () => {
    const output = sample({ x: 0, y: -0.12, z: 0 });
    expect(output.impulseMagnitude).toBeGreaterThanOrEqual(6);
    expect(output.impulseDirection).toEqual({ x: -0, y: 1, z: -0 });
  });

  it('launches along the exact normalized opposite of a diagonal stroke', () => {
    const output = sample({ x: 1, y: -1, z: 0 });
    expect(output.impulseDirection.x).toBeCloseTo(-Math.SQRT1_2, 10);
    expect(output.impulseDirection.y).toBeCloseTo(Math.SQRT1_2, 10);
    expect(output.impulseDirection.z).toBeCloseTo(0, 10);
  });

  it.each([0, Math.PI / 2, -Math.PI / 2, 0.73])(
    'round-trips player-local direction through yaw %s',
    (yaw) => {
      const player = { x: 3, y: 4, z: -2 };
      const worldOffset = { x: 0.4, y: -0.3, z: -0.7 };
      const local = { x: 0, y: 0, z: 0 };
      worldToPlayerLocalPosition(
        {
          x: player.x + worldOffset.x,
          y: player.y + worldOffset.y,
          z: player.z + worldOffset.z,
        },
        player,
        yaw,
        local,
      );
      const roundTrip = { x: 0, y: 0, z: 0 };
      playerLocalToWorldDirection(local, yaw, roundTrip);
      expect(roundTrip.x).toBeCloseTo(worldOffset.x, 10);
      expect(roundTrip.y).toBeCloseTo(worldOffset.y, 10);
      expect(roundTrip.z).toBeCloseTo(worldOffset.z, 10);
    },
  );

  it('rotates a player-local launch direction back into world space using player yaw', () => {
    const world = { x: 0, y: 0, z: 0 };
    playerLocalToWorldDirection({ x: 0, y: 1, z: -1 }, Math.PI / 2, world);
    expect(world.x).toBeCloseTo(-1, 10);
    expect(world.y).toBeCloseTo(1, 10);
    expect(world.z).toBeCloseTo(0, 10);
  });
});
