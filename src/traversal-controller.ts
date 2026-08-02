import type { Vector3Value } from './swing';
import type { RopeAttachment, RopeState, TraversalHand } from './traversal-types';

function copyVector(source: Vector3Value): Vector3Value {
  return { x: source.x, y: source.y, z: source.z };
}

export function createRopeState(
  hand: TraversalHand,
  minimumLength: number,
  maximumLength: number,
): RopeState {
  return {
    hand,
    active: false,
    lifecycle: 'idle',
    anchorPoint: null,
    anchorNormal: null,
    anchorObjectId: null,
    anchorLocalPoint: null,
    currentLength: maximumLength,
    targetLength: maximumLength,
    minimumLength,
    maximumLength,
    previousControllerPosition: { x: 0, y: 0, z: 0 },
    filteredControllerVelocity: { x: 0, y: 0, z: 0 },
    accumulatedPullDistance: 0,
    pullPhase: 'idle',
    visualRope: null,
    attachedAtTime: 0,
    lastFullPullAtTime: Number.NEGATIVE_INFINITY,
  };
}

export function beginRopeFlight(rope: RopeState): void {
  releaseRope(rope);
  rope.lifecycle = 'flying';
}

export function attachRope(
  rope: RopeState,
  attachment: RopeAttachment,
  ropeOrigin: Vector3Value,
  attachedAtTime: number,
  attachmentPreload: number,
): void {
  const distance = Math.hypot(
    attachment.point.x - ropeOrigin.x,
    attachment.point.y - ropeOrigin.y,
    attachment.point.z - ropeOrigin.z,
  );
  rope.active = true;
  rope.lifecycle = 'attached';
  rope.anchorPoint = copyVector(attachment.point);
  rope.anchorNormal = copyVector(attachment.normal);
  rope.anchorObjectId = attachment.objectId;
  rope.anchorLocalPoint = attachment.localPoint ? copyVector(attachment.localPoint) : null;
  const preloadedLength = distance * (1 - Math.max(0, Math.min(attachmentPreload, 0.1)));
  rope.currentLength = Math.max(rope.minimumLength, Math.min(preloadedLength, rope.maximumLength));
  rope.targetLength = rope.currentLength;
  rope.accumulatedPullDistance = 0;
  rope.pullPhase = 'idle';
  rope.attachedAtTime = attachedAtTime;
}

export function releaseRope(rope: RopeState): boolean {
  if (!rope.active && rope.lifecycle === 'idle') return false;
  rope.active = false;
  rope.lifecycle = 'idle';
  rope.anchorPoint = null;
  rope.anchorNormal = null;
  rope.anchorObjectId = null;
  rope.anchorLocalPoint = null;
  rope.accumulatedPullDistance = 0;
  rope.pullPhase = 'idle';
  return true;
}
