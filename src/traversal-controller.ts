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
    pendingShortenDistance: 0,
    pendingPullImpulse: 0,
    pendingPullDirection: { x: 0, y: 0, z: 0 },
    pullPhase: 'idle',
    visualRope: null,
    attachedAtTime: 0,
    lastFullPullAtTime: Number.NEGATIVE_INFINITY,
  };
}

export function ropeAcceptsPullInput(rope: RopeState): boolean {
  return rope.active || rope.lifecycle === 'flying';
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
  const preserveFlightPull = rope.lifecycle === 'flying';
  const bufferedShortenDistance = rope.pendingShortenDistance;
  const bufferedPullImpulse = rope.pendingPullImpulse;
  const bufferedPullDirection = copyVector(rope.pendingPullDirection);
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
  rope.pendingShortenDistance = preserveFlightPull ? bufferedShortenDistance : 0;
  rope.pendingPullImpulse = preserveFlightPull ? bufferedPullImpulse : 0;
  rope.pendingPullDirection.x = preserveFlightPull ? bufferedPullDirection.x : 0;
  rope.pendingPullDirection.y = preserveFlightPull ? bufferedPullDirection.y : 0;
  rope.pendingPullDirection.z = preserveFlightPull ? bufferedPullDirection.z : 0;
  rope.pullPhase = 'idle';
  rope.attachedAtTime = attachedAtTime;
}

export function queueRopePull(
  rope: RopeState,
  acceptedPullDistance: number,
  impulseMagnitude: number,
  impulseDirection: Vector3Value,
  reelSensitivity: number,
  maximumPendingDistance: number,
  maximumImpulse: number,
): void {
  if (!ropeAcceptsPullInput(rope)) return;
  const safePullDistance = Number.isFinite(acceptedPullDistance)
    ? Math.max(0, acceptedPullDistance)
    : 0;
  rope.pendingShortenDistance = Math.min(
    maximumPendingDistance,
    rope.pendingShortenDistance + safePullDistance * reelSensitivity,
  );
  const directionLength = Math.hypot(
    impulseDirection.x,
    impulseDirection.y,
    impulseDirection.z,
  );
  const acceptedImpulse = Number.isFinite(impulseMagnitude)
    ? Math.max(0, impulseMagnitude)
    : 0;
  if (
    acceptedImpulse <= 0
    || !Number.isFinite(directionLength)
    || directionLength <= 1e-8
  ) return;
  const existingX = rope.pendingPullDirection.x * rope.pendingPullImpulse;
  const existingY = rope.pendingPullDirection.y * rope.pendingPullImpulse;
  const existingZ = rope.pendingPullDirection.z * rope.pendingPullImpulse;
  const nextX = existingX + impulseDirection.x / directionLength * acceptedImpulse;
  const nextY = existingY + impulseDirection.y / directionLength * acceptedImpulse;
  const nextZ = existingZ + impulseDirection.z / directionLength * acceptedImpulse;
  const nextMagnitude = Math.hypot(nextX, nextY, nextZ);
  rope.pendingPullImpulse = Math.min(maximumImpulse, nextMagnitude);
  if (nextMagnitude > 1e-8) {
    rope.pendingPullDirection.x = nextX / nextMagnitude;
    rope.pendingPullDirection.y = nextY / nextMagnitude;
    rope.pendingPullDirection.z = nextZ / nextMagnitude;
  } else {
    rope.pendingPullDirection.x = 0;
    rope.pendingPullDirection.y = 0;
    rope.pendingPullDirection.z = 0;
  }
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
  rope.pendingShortenDistance = 0;
  rope.pendingPullImpulse = 0;
  rope.pendingPullDirection.x = 0;
  rope.pendingPullDirection.y = 0;
  rope.pendingPullDirection.z = 0;
  rope.pullPhase = 'idle';
  return true;
}
