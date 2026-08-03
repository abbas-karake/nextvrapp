import { describe, expect, it } from 'vitest';
import { attachRope, beginRopeFlight, createRopeState, queueRopePull, releaseRope } from '../src/traversal-controller';

describe('independent rope lifecycle', () => {
  it('enters a non-active flying state before a projectile reaches its target', () => {
    const left = createRopeState('left', 1.5, 80);
    beginRopeFlight(left);
    expect(left.lifecycle).toBe('flying');
    expect(left.active).toBe(false);
    expect(releaseRope(left)).toBe(true);
    expect(left.lifecycle).toBe('idle');
  });

  it('queues bounded pull distance and impulse only for an eligible rope', () => {
    const left = createRopeState('left', 1.5, 80);
    queueRopePull(left, 0.02, 3, { x: 1, y: 0, z: 0 }, 1, 0.65, 7.5);
    expect(left.pendingShortenDistance).toBe(0);
    expect(left.pendingPullImpulse).toBe(0);
    attachRope(
      left,
      { point: { x: 0, y: 8, z: 0 }, normal: { x: 0, y: -1, z: 0 }, objectId: 'roof' },
      { x: 0, y: 2, z: 0 },
      0,
      0,
    );
    queueRopePull(left, 0.02, 3, { x: 1, y: 0, z: 0 }, 1, 0.65, 7.5);
    queueRopePull(left, 1, 10, { x: 1, y: 0, z: 0 }, 1, 0.65, 7.5);
    expect(left.pendingShortenDistance).toBe(0.65);
    expect(left.pendingPullImpulse).toBe(7.5);
  });

  it('vector-adds orthogonal pulls and cancels exact opposite pulls', () => {
    const rope = createRopeState('left', 1.5, 80);
    attachRope(
      rope,
      { point: { x: 0, y: 8, z: 0 }, normal: { x: 0, y: -1, z: 0 }, objectId: 'roof' },
      { x: 0, y: 2, z: 0 },
      0,
      0,
    );
    queueRopePull(rope, 0, 3, { x: 1, y: 0, z: 0 }, 1, 0.65, 12);
    queueRopePull(rope, 0, 4, { x: 0, y: 1, z: 0 }, 1, 0.65, 12);
    expect(rope.pendingPullImpulse).toBeCloseTo(5, 10);
    expect(rope.pendingPullDirection.x).toBeCloseTo(0.6, 10);
    expect(rope.pendingPullDirection.y).toBeCloseTo(0.8, 10);
    queueRopePull(rope, 0, 5, { x: -0.6, y: -0.8, z: 0 }, 1, 0.65, 12);
    expect(rope.pendingPullImpulse).toBeCloseTo(0, 10);
    expect(rope.pendingPullDirection).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rejects non-finite directional queue input without contaminating rope state', () => {
    const rope = createRopeState('left', 1.5, 80);
    beginRopeFlight(rope);
    queueRopePull(
      rope,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      { x: Number.NaN, y: 1, z: 0 },
      1,
      0.65,
      12,
    );
    expect(rope.pendingShortenDistance).toBe(0);
    expect(rope.pendingPullImpulse).toBe(0);
    expect(rope.pendingPullDirection).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('preserves a world-space flight pull through attachment and clears it on release', () => {
    const rope = createRopeState('left', 1.5, 80);
    beginRopeFlight(rope);
    queueRopePull(rope, 0.02, 6, { x: 0.6, y: 0.8, z: 0 }, 1, 0.65, 12);
    attachRope(
      rope,
      { point: { x: 20, y: 8, z: 0 }, normal: { x: -1, y: 0, z: 0 }, objectId: 'tower' },
      { x: 0, y: 2, z: 0 },
      0,
      0,
    );
    expect(rope.pendingPullImpulse).toBeCloseTo(6, 10);
    expect(rope.pendingPullDirection.x).toBeCloseTo(0.6, 10);
    expect(rope.pendingPullDirection.y).toBeCloseTo(0.8, 10);
    expect(rope.pendingPullDirection.z).toBeCloseTo(0, 10);
    releaseRope(rope);
    expect(rope.pendingPullImpulse).toBe(0);
    expect(rope.pendingPullDirection).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('attaches only the requested hand at the exact hit point', () => {
    const left = createRopeState('left', 1.5, 80);
    const right = createRopeState('right', 1.5, 80);
    const velocity = { x: 7, y: -3, z: 2 };
    attachRope(
      left,
      {
        point: { x: 0, y: 12, z: -5 },
        normal: { x: 0, y: 0, z: 1 },
        objectId: 'tower-4',
      },
      { x: 0, y: 2, z: 0 },
      1000,
      0.02,
    );
    expect(left.active).toBe(true);
    expect(left.anchorPoint).toEqual({ x: 0, y: 12, z: -5 });
    expect(left.anchorNormal).toEqual({ x: 0, y: 0, z: 1 });
    expect(left.anchorObjectId).toBe('tower-4');
    expect(left.currentLength).toBeCloseTo(Math.hypot(10, 5) * 0.98);
    expect(left.targetLength).toBeCloseTo(Math.hypot(10, 5) * 0.98);
    expect(left.attachedAtTime).toBe(1000);
    expect(right.active).toBe(false);
    expect(velocity).toEqual({ x: 7, y: -3, z: 2 });
  });

  it('releases only its rope and permits immediate reattachment', () => {
    const left = createRopeState('left', 1.5, 80);
    attachRope(
      left,
      { point: { x: 0, y: 6, z: 0 }, normal: { x: 0, y: -1, z: 0 }, objectId: 'roof' },
      { x: 0, y: 1, z: 0 },
      20,
      0,
    );
    expect(releaseRope(left)).toBe(true);
    expect(left.active).toBe(false);
    expect(left.anchorPoint).toBeNull();
    expect(releaseRope(left)).toBe(false);
    attachRope(
      left,
      { point: { x: 3, y: 8, z: 1 }, normal: { x: -1, y: 0, z: 0 }, objectId: 'next' },
      { x: 0, y: 1, z: 0 },
      21,
      0.02,
    );
    expect(left.active).toBe(true);
    expect(left.anchorObjectId).toBe('next');
  });
});
