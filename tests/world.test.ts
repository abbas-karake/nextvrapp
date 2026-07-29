import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createControllerHand, getFingerLayout } from '../src/hands';
import { getHandPose, type GamepadLike } from '../src/input';
import {
  advanceRouteDistance,
  loadAvailable,
  moveCircleWithCollisions,
  moveRigWithTrackedCollision,
  sampleClosedRoute,
  updateRouteAgentCollider,
  worldPointFromRigLocal,
  type Collider2D,
  type RoutePoint,
} from '../src/world';

const wall: Collider2D = { minX: 2, maxX: 4, minZ: -1, maxZ: 1 };

function mockGamepad(values: number[]): GamepadLike {
  return {
    axes: [0, 0, 0, 0],
    buttons: values.map((value) => ({ pressed: value > 0.5, value })),
  };
}

describe('city collision', () => {
  it('blocks movement into a building collider', () => {
    const result = moveCircleWithCollisions(
      { x: 1.5, z: 0 },
      { x: 0.4, z: 0 },
      0.3,
      [wall],
      100,
    );
    expect(result).toEqual({ x: 1.5, z: 0 });
  });

  it('slides along a building rather than freezing both axes', () => {
    const result = moveCircleWithCollisions(
      { x: 1.5, z: 0 },
      { x: 0.4, z: 0.5 },
      0.3,
      [wall],
      100,
    );
    expect(result.x).toBe(1.5);
    expect(result.z).toBe(0.5);
  });

  it('clamps the player inside the world boundary', () => {
    const result = moveCircleWithCollisions(
      { x: 9.6, z: 0 },
      { x: 1, z: 0 },
      0.3,
      [],
      10,
    );
    expect(result.x).toBe(9.7);
  });

  it('keeps a collider centered on a moving pedestrian', () => {
    const collider: Collider2D = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    updateRouteAgentCollider(collider, { x: 5, z: 6 }, 0, 'pedestrian');
    expect(collider).toEqual({ minX: 4.62, maxX: 5.38, minZ: 5.62, maxZ: 6.38 });
  });

  it('transforms the XR reference-space head through the city rig', () => {
    const world = worldPointFromRigLocal({ x: 18, z: 8 }, -Math.PI / 2, { x: 0.5, z: -1 });
    expect(world.x).toBeCloseTo(19);
    expect(world.z).toBeCloseTo(8.5);
  });

  it('uses the tracked head offset when testing stick movement', () => {
    const rig = moveRigWithTrackedCollision(
      { x: 0, z: 0 },
      { x: 1.6, z: 0 },
      { x: 0.3, z: 0 },
      0.3,
      [wall],
      100,
    );
    expect(rig).toEqual({ x: 0, z: 0 });
  });

  it('pushes the rig out when a moving collider overlaps a stationary tracked head', () => {
    const rig = moveRigWithTrackedCollision(
      { x: 0, z: 0 },
      { x: 2.2, z: 0 },
      { x: 0, z: 0 },
      0.3,
      [wall],
      100,
    );
    expect(rig.x).toBeLessThanOrEqual(-0.5);
    expect(rig.z).toBe(0);
  });
});

describe('closed routes', () => {
  const square: RoutePoint[] = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
  ];

  it('wraps route distance without growing forever', () => {
    expect(advanceRouteDistance(39, 3, 1, 40)).toBe(2);
  });

  it('samples position and facing on a route segment with a cached route length', () => {
    const result = sampleClosedRoute(square, 15, undefined, 40);
    expect(result.x).toBeCloseTo(10);
    expect(result.z).toBeCloseTo(5);
    expect(result.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('wraps samples past the route end', () => {
    const result = sampleClosedRoute(square, 42);
    expect(result.x).toBeCloseTo(2);
    expect(result.z).toBeCloseTo(0);
  });
});

describe('partial asset loading', () => {
  it('keeps successful assets when another asset fails', async () => {
    const loaded = await loadAvailable(['building', 'car', 'person'], async (key) => {
      if (key === 'person') throw new Error('missing person');
      return `${key}-asset`;
    });
    expect([...loaded.entries()]).toEqual([
      ['building', 'building-asset'],
      ['car', 'car-asset'],
    ]);
  });
});

describe('controller hands', () => {
  it('maps the left trigger to the index finger beside the left thumb', () => {
    const layout = getFingerLayout('left');
    expect(layout.find((finger) => finger.strength === 'trigger')?.x).toBe(-0.032);
  });

  it('maps the right trigger to the index finger beside the right thumb', () => {
    const layout = getFingerLayout('right');
    expect(layout.find((finger) => finger.strength === 'trigger')?.x).toBe(0.032);
  });

  it('uses rounded three-joint anatomy instead of block fingers', () => {
    const hand = createControllerHand('right');
    let capsuleCount = 0;
    hand.object.traverse((object) => {
      if (object instanceof THREE.Mesh && object.geometry.type === 'CapsuleGeometry') capsuleCount += 1;
    });
    expect(capsuleCount).toBeGreaterThanOrEqual(14);
  });

  it('maps analog trigger, grip, and thumb controls', () => {
    const pose = getHandPose(mockGamepad([0.7, 0.4, 0, 0, 0.9, 0]));
    expect(pose.trigger).toBeCloseTo(0.7);
    expect(pose.grip).toBeCloseTo(0.4);
    expect(pose.thumb).toBeCloseTo(0.9);
  });

  it('falls back to pressed state for digital buttons', () => {
    const pose = getHandPose({
      axes: [],
      buttons: [
        { pressed: true },
        { pressed: false },
        { pressed: false },
        { pressed: false },
        { pressed: true },
      ],
    });
    expect(pose.trigger).toBe(1);
    expect(pose.grip).toBe(0);
    expect(pose.thumb).toBe(1);
  });
});
