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

/**
 * Hard pendulum constraint, Battle-Glide style.
 *
 * After integration, any rope whose distance exceeds its length gets the body
 * projected fully back onto the rope sphere and the outward radial velocity
 * component is removed. Tangential momentum is fully preserved, which is what
 * produces the tight, energy-conserving arc feel.
 */
export function constrainRopesHard(
  state: TraversalPhysicsState,
  ropes: readonly RopeState[],
  input: TraversalPhysicsInput,
  slackTolerance: number,
): boolean {
  let anyTaut = false;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    let corrected = false;
    for (const rope of ropes) {
      if (!rope.active || !rope.anchorPoint) continue;
      const ropeOffset = rope.hand === 'left'
        ? input.leftRopeOffset
        : input.rightRopeOffset;
      const originX = state.position.x + (ropeOffset?.x ?? 0);
      const originY = state.position.y + (ropeOffset?.y ?? 0);
      const originZ = state.position.z + (ropeOffset?.z ?? 0);
      const dx = rope.anchorPoint.x - originX;
      const dy = rope.anchorPoint.y - originY;
      const dz = rope.anchorPoint.z - originZ;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < 1e-8) continue;
      const excess = distance - rope.currentLength;
      if (excess <= slackTolerance) continue;
      anyTaut = true;
      const nx = dx / distance;
      const ny = dy / distance;
      const nz = dz / distance;
      // Smoothed full convergence: 60% of the excess per pass, six passes,
      // leaves <0.5% residual stretch while avoiding the harsh one-step jerk
      // that bleeds swing energy every time the rope retightens.
      state.position.x += nx * excess * 0.6;
      state.position.y += ny * excess * 0.6;
      state.position.z += nz * excess * 0.6;
      const awaySpeed = -(
        state.velocity.x * nx
        + state.velocity.y * ny
        + state.velocity.z * nz
      );
      if (awaySpeed > 0) {
        state.velocity.x += nx * awaySpeed;
        state.velocity.y += ny * awaySpeed;
        state.velocity.z += nz * awaySpeed;
      }
      corrected = true;
    }
    if (!corrected) break;
  }
  return anyTaut;
}

/** Scales horizontal velocity toward the view-forward direction on release. */
export function applyReleaseBoost(
  velocity: Vector3Value,
  forwardX: number,
  forwardZ: number,
  blend: number,
  boostScale: number,
  maximumBonusSpeed: number,
): void {
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  if (horizontalSpeed < 0.5) return;
  const forwardLength = Math.hypot(forwardX, forwardZ);
  if (forwardLength < 1e-6) return;
  const normalizedForwardX = forwardX / forwardLength;
  const normalizedForwardZ = forwardZ / forwardLength;
  const safeBlend = Math.max(0, Math.min(blend, 1));
  const blendedX = velocity.x * (1 - safeBlend)
    + normalizedForwardX * horizontalSpeed * safeBlend;
  const blendedZ = velocity.z * (1 - safeBlend)
    + normalizedForwardZ * horizontalSpeed * safeBlend;
  const boostedSpeed = horizontalSpeed * boostScale;
  const cappedSpeed = Math.min(boostedSpeed, horizontalSpeed + maximumBonusSpeed);
  const blendedMagnitude = Math.hypot(blendedX, blendedZ);
  if (blendedMagnitude < 1e-6) return;
  const scale = cappedSpeed / blendedMagnitude;
  velocity.x = blendedX * scale;
  velocity.z = blendedZ * scale;
}

const ropeOriginScratch: Vector3Value = { x: 0, y: 0, z: 0 };

function clamp01(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

function ropeIsTaut(
  rope: RopeState,
  bodyPosition: Vector3Value,
  offset: Vector3Value | undefined,
  slackTolerance: number,
): boolean {
  if (!rope.anchorPoint) return false;
  const dx = rope.anchorPoint.x - (bodyPosition.x + (offset?.x ?? 0));
  const dy = rope.anchorPoint.y - (bodyPosition.y + (offset?.y ?? 0));
  const dz = rope.anchorPoint.z - (bodyPosition.z + (offset?.z ?? 0));
  return Math.hypot(dx, dy, dz) > rope.currentLength + slackTolerance;
}

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
    const inputMagnitude = Math.hypot(input.x, input.z);
    const maximumAirInfluenceSpeed = Math.max(config.airControl.maximumInfluenceSpeed, 1e-6);
    const airAuthority = Math.max(0, 1 - Math.hypot(state.velocity.x, state.velocity.z) / maximumAirInfluenceSpeed)
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

      // Speed-scaled auto-reel: gently shorten the rope while moving fast so
      // each swing pumps energy into the next one, like Battle Glide's flow.
      const currentSpeed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
      const reelWindow = Math.max(
        config.swingPendulum.autoReelSpeedCeiling - config.swingPendulum.autoReelSpeedFloor,
        1e-6,
      );
      const reelFactor = clamp01(
        (currentSpeed - config.swingPendulum.autoReelSpeedFloor) / reelWindow,
      );
      const reelAmount = config.swingPendulum.autoReelRate * reelFactor * stepSeconds;
      if (reelAmount > 0 && rope.currentLength > rope.minimumLength + 0.01) {
        const appliedReel = Math.min(reelAmount, rope.currentLength - rope.minimumLength);
        rope.currentLength -= appliedReel;
        rope.targetLength = Math.max(rope.minimumLength, rope.targetLength - appliedReel);
      }

      const pendingPullImpulse = rope.pendingPullImpulse;
      const pendingDirectionX = rope.pendingPullDirection.x;
      const pendingDirectionY = rope.pendingPullDirection.y;
      const pendingDirectionZ = rope.pendingPullDirection.z;
      rope.pendingPullImpulse = 0;
      rope.pendingPullDirection.x = 0;
      rope.pendingPullDirection.y = 0;
      rope.pendingPullDirection.z = 0;
      const pendingDirectionLength = Math.hypot(
        pendingDirectionX,
        pendingDirectionY,
        pendingDirectionZ,
      );
      if (pendingPullImpulse > 0 && pendingDirectionLength > 1e-8) {
        const impulseScale = pendingPullImpulse
          * config.comfort.pullStrengthScale
          / pendingDirectionLength;
        pullImpulseX += pendingDirectionX * impulseScale;
        pullImpulseY += pendingDirectionY * impulseScale;
        pullImpulseZ += pendingDirectionZ * impulseScale;
      }

      // Swing pumping: pushing the stick while on a taut rope accelerates you
      // along your current travel direction, converting stick input into arc
      // speed instead of fighting the pendulum.
      const ropeOffsetForPump = rope.hand === 'left'
        ? input.leftRopeOffset
        : input.rightRopeOffset;
      ropeOriginScratch.x = state.position.x + (ropeOffsetForPump?.x ?? 0);
      ropeOriginScratch.y = state.position.y + (ropeOffsetForPump?.y ?? 0);
      ropeOriginScratch.z = state.position.z + (ropeOffsetForPump?.z ?? 0);
      if (
        ropeIsTaut(rope, state.position, ropeOffsetForPump, config.rope.slackTolerance)
        && inputMagnitude > 0.15
      ) {
        const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
        if (horizontalSpeed > 1 && horizontalSpeed < config.swing.maximumAssistedSpeed) {
          const assistAcceleration = config.swing.assist
            * config.comfort.swingAssistScale
            * Math.min(inputMagnitude, 1);
          accelerationX += (state.velocity.x / horizontalSpeed) * assistAcceleration;
          accelerationZ += (state.velocity.z / horizontalSpeed) * assistAcceleration;
        }
      }
    }

    state.velocity.x += pullImpulseX / config.physics.playerMass;
    state.velocity.y += pullImpulseY / config.physics.playerMass;
    state.velocity.z += pullImpulseZ / config.physics.playerMass;
    state.velocity.x += accelerationX * stepSeconds;
    state.velocity.y += accelerationY * stepSeconds;
    state.velocity.z += accelerationZ * stepSeconds;
    state.position.x += state.velocity.x * stepSeconds;
    state.position.y += state.velocity.y * stepSeconds;
    state.position.z += state.velocity.z * stepSeconds;

    constrainRopesHard(state, ropes, input, config.rope.slackTolerance);

    const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
    const maximumSpeed = config.comfort.maximumSpeed;
    if (maximumSpeed > 0 && speed > maximumSpeed) {
      const speedScale = maximumSpeed / speed;
      state.velocity.x *= speedScale;
      state.velocity.y *= speedScale;
      state.velocity.z *= speedScale;
    }
    state.grounded = false;
    state.physicsRemainder -= stepSeconds;
    steps += 1;
  }

  if (steps === config.physics.maximumCatchUpSteps && state.physicsRemainder >= stepSeconds) {
    state.physicsRemainder %= stepSeconds;
  }
  return steps;
}
