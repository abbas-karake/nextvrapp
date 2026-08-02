import type { Vector3Value, SwingState } from './swing';
import type { TraversalConfig } from './traversal-config';
import type { RopeState } from './traversal-types';

export interface RopeForceInput {
  ropeOrigin: Vector3Value;
  anchor: Vector3Value;
  playerVelocity: Vector3Value;
  currentLength: number;
}

export interface RopeForceTuning {
  stiffness: number;
  damping: number;
  maximumForce: number;
  slackTolerance: number;
}

export interface RopeForceResult extends Vector3Value {
  tension: number;
  stretch: number;
  radialVelocity: number;
  taut: boolean;
}

export function solveRopeTension(
  input: RopeForceInput,
  tuning: RopeForceTuning,
  output: RopeForceResult,
): RopeForceResult {
  const dx = input.anchor.x - input.ropeOrigin.x;
  const dy = input.anchor.y - input.ropeOrigin.y;
  const dz = input.anchor.z - input.ropeOrigin.z;
  const distance = Math.hypot(dx, dy, dz);
  output.x = 0;
  output.y = 0;
  output.z = 0;
  output.tension = 0;
  output.stretch = distance - input.currentLength;
  output.radialVelocity = 0;
  output.taut = output.stretch > tuning.slackTolerance;
  if (!output.taut || distance < 1e-8) return output;

  const directionX = dx / distance;
  const directionY = dy / distance;
  const directionZ = dz / distance;
  const radialVelocity = -(
    input.playerVelocity.x * directionX
    + input.playerVelocity.y * directionY
    + input.playerVelocity.z * directionZ
  );
  output.radialVelocity = Math.abs(radialVelocity) < 1e-12 ? 0 : radialVelocity;
  output.tension = Math.min(
    tuning.maximumForce,
    Math.max(
      0,
      output.stretch * tuning.stiffness + Math.max(0, output.radialVelocity) * tuning.damping,
    ),
  );
  output.x = directionX * output.tension;
  output.y = directionY * output.tension;
  output.z = directionZ * output.tension;
  return output;
}

export interface TraversalPhysicsState extends SwingState {
  physicsRemainder: number;
}

export function resolveTraversalGrounded(
  wasGrounded: boolean,
  physicsSteps: number,
  finalCollisionLanded: boolean,
): boolean {
  return physicsSteps === 0 ? wasGrounded : finalCollisionLanded;
}

export interface TraversalPhysicsInput {
  x: number;
  z: number;
  leftRopeOffset?: Vector3Value;
  rightRopeOffset?: Vector3Value;
}

const ropeOriginScratch: Vector3Value = { x: 0, y: 0, z: 0 };
const ropeForceScratch: RopeForceResult = {
  x: 0,
  y: 0,
  z: 0,
  tension: 0,
  stretch: 0,
  radialVelocity: 0,
  taut: false,
};

export function stepTraversalPhysics(
  state: TraversalPhysicsState,
  ropes: readonly RopeState[],
  input: TraversalPhysicsInput,
  deltaSeconds: number,
  config: TraversalConfig,
): number {
  const stepSeconds = 1 / config.physics.fixedHz;
  state.physicsRemainder += Math.min(Math.max(deltaSeconds, 0), config.physics.maximumSafeDeltaSeconds);
  let steps = 0;

  while (
    state.physicsRemainder + 1e-12 >= stepSeconds
    && steps < config.physics.maximumCatchUpSteps
  ) {
    const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    const maximumAirInfluenceSpeed = Math.max(config.airControl.maximumInfluenceSpeed, 1e-6);
    const airAuthority = Math.max(0, 1 - horizontalSpeed / maximumAirInfluenceSpeed)
      * config.comfort.accelerationScale;
    let accelerationX = input.x * config.airControl.acceleration * airAuthority;
    let accelerationY = config.physics.gravity;
    let accelerationZ = input.z * config.airControl.acceleration * airAuthority;
    let pullImpulseX = 0;
    let pullImpulseY = 0;
    let pullImpulseZ = 0;

    for (const rope of ropes) {
      if (!rope.active || !rope.anchorPoint) continue;
      const consumedPullDistance = Math.min(
        rope.pendingShortenDistance,
        config.pull.maximumPullRate * stepSeconds,
        Math.max(0, rope.currentLength - rope.minimumLength),
      );
      rope.pendingShortenDistance -= consumedPullDistance;
      rope.currentLength -= consumedPullDistance;
      rope.targetLength = Math.max(rope.minimumLength, rope.targetLength - consumedPullDistance);
      const lengthDifference = rope.targetLength - rope.currentLength;
      const maximumLengthChange = config.rope.reelSensitivity * stepSeconds;
      rope.currentLength += Math.max(
        -maximumLengthChange,
        Math.min(lengthDifference, maximumLengthChange),
      );
      const ropeOffset = rope.hand === 'left'
        ? input.leftRopeOffset
        : input.rightRopeOffset;
      ropeOriginScratch.x = state.position.x + (ropeOffset?.x ?? 0);
      ropeOriginScratch.y = state.position.y + (ropeOffset?.y ?? 0);
      ropeOriginScratch.z = state.position.z + (ropeOffset?.z ?? 0);
      const toAnchorX = rope.anchorPoint.x - ropeOriginScratch.x;
      const toAnchorY = rope.anchorPoint.y - ropeOriginScratch.y;
      const toAnchorZ = rope.anchorPoint.z - ropeOriginScratch.z;
      const distanceToAnchor = Math.hypot(toAnchorX, toAnchorY, toAnchorZ);
      const pendingPullImpulse = rope.pendingPullImpulse;
      rope.pendingPullImpulse = 0;
      if (
        pendingPullImpulse > 0
        && distanceToAnchor > 1e-8
        && distanceToAnchor >= rope.currentLength - config.rope.slackTolerance
      ) {
        const impulseScale = pendingPullImpulse
          * config.comfort.pullStrengthScale
          / distanceToAnchor;
        pullImpulseX += toAnchorX * impulseScale;
        pullImpulseY += toAnchorY * impulseScale;
        pullImpulseZ += toAnchorZ * impulseScale;
      }
      solveRopeTension(
        {
          ropeOrigin: ropeOriginScratch,
          anchor: rope.anchorPoint,
          playerVelocity: state.velocity,
          currentLength: rope.currentLength,
        },
        {
          stiffness: config.rope.stiffness,
          damping: config.rope.damping,
          maximumForce: config.rope.maxForce,
          slackTolerance: config.rope.slackTolerance,
        },
        ropeForceScratch,
      );
      accelerationX += ropeForceScratch.x / config.physics.playerMass;
      accelerationY += ropeForceScratch.y / config.physics.playerMass;
      accelerationZ += ropeForceScratch.z / config.physics.playerMass;
    }

    state.velocity.x += pullImpulseX / config.physics.playerMass;
    state.velocity.y += pullImpulseY / config.physics.playerMass;
    state.velocity.z += pullImpulseZ / config.physics.playerMass;
    state.velocity.x += accelerationX * stepSeconds;
    state.velocity.y += accelerationY * stepSeconds;
    state.velocity.z += accelerationZ * stepSeconds;
    const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
    const maximumSpeed = config.comfort.maximumSpeed;
    if (maximumSpeed > 0 && speed > maximumSpeed) {
      const speedScale = maximumSpeed / speed;
      state.velocity.x *= speedScale;
      state.velocity.y *= speedScale;
      state.velocity.z *= speedScale;
    }
    state.position.x += state.velocity.x * stepSeconds;
    state.position.y += state.velocity.y * stepSeconds;
    state.position.z += state.velocity.z * stepSeconds;
    state.grounded = false;
    state.physicsRemainder -= stepSeconds;
    steps += 1;
  }

  if (steps === config.physics.maximumCatchUpSteps && state.physicsRemainder >= stepSeconds) {
    state.physicsRemainder %= stepSeconds;
  }
  return steps;
}
