import type { Vector3Value } from './swing';

export type TraversalHand = 'left' | 'right';
export type RopeLifecycle = 'idle' | 'flying' | 'attached';
export type PullGesturePhase = 'idle' | 'armed' | 'pulling' | 'recovery';

export interface RopeState {
  hand: TraversalHand;
  active: boolean;
  lifecycle: RopeLifecycle;
  anchorPoint: Vector3Value | null;
  anchorNormal: Vector3Value | null;
  anchorObjectId: string | null;
  anchorLocalPoint: Vector3Value | null;
  currentLength: number;
  targetLength: number;
  minimumLength: number;
  maximumLength: number;
  previousControllerPosition: Vector3Value;
  filteredControllerVelocity: Vector3Value;
  accumulatedPullDistance: number;
  pendingShortenDistance: number;
  pendingPullImpulse: number;
  pullPhase: PullGesturePhase;
  visualRope: unknown | null;
  attachedAtTime: number;
  lastFullPullAtTime: number;
}

export interface RopeAttachment {
  point: Vector3Value;
  normal: Vector3Value;
  objectId: string;
  localPoint?: Vector3Value;
}
