import type { Vector3Value } from './swing';

export function worldToPlayerLocalPosition(
  controllerWorldPosition: Vector3Value,
  playerWorldPosition: Vector3Value,
  playerYaw: number,
  output: Vector3Value,
): Vector3Value {
  const dx = controllerWorldPosition.x - playerWorldPosition.x;
  const dz = controllerWorldPosition.z - playerWorldPosition.z;
  const cosine = Math.cos(playerYaw);
  const sine = Math.sin(playerYaw);
  output.x = dx * cosine - dz * sine;
  output.y = controllerWorldPosition.y - playerWorldPosition.y;
  output.z = dx * sine + dz * cosine;
  return output;
}

export interface ControllerMotionState {
  initialized: boolean;
  previousPosition: Vector3Value;
  filteredVelocity: Vector3Value;
}

export interface ControllerMotionTuning {
  smoothingRate: number;
  maximumTrackedSpeed: number;
}

export interface ControllerMotionSampleResult {
  velocity: Vector3Value;
  speed: number;
  trackingSpikeRejected: boolean;
}

export function createControllerMotionState(): ControllerMotionState {
  return {
    initialized: false,
    previousPosition: { x: 0, y: 0, z: 0 },
    filteredVelocity: { x: 0, y: 0, z: 0 },
  };
}

function clearMotionResult(
  state: ControllerMotionState,
  output: ControllerMotionSampleResult,
  trackingSpikeRejected: boolean,
): ControllerMotionSampleResult {
  state.filteredVelocity.x = 0;
  state.filteredVelocity.y = 0;
  state.filteredVelocity.z = 0;
  output.velocity.x = 0;
  output.velocity.y = 0;
  output.velocity.z = 0;
  output.speed = 0;
  output.trackingSpikeRejected = trackingSpikeRejected;
  return output;
}

export function sampleControllerLocalMotion(
  state: ControllerMotionState,
  currentPosition: Vector3Value,
  deltaSeconds: number,
  tuning: ControllerMotionTuning,
  output: ControllerMotionSampleResult,
): ControllerMotionSampleResult {
  if (!state.initialized || deltaSeconds <= 0 || deltaSeconds > 0.1) {
    state.initialized = true;
    state.previousPosition.x = currentPosition.x;
    state.previousPosition.y = currentPosition.y;
    state.previousPosition.z = currentPosition.z;
    return clearMotionResult(state, output, false);
  }

  const inverseDelta = 1 / deltaSeconds;
  const rawX = (currentPosition.x - state.previousPosition.x) * inverseDelta;
  const rawY = (currentPosition.y - state.previousPosition.y) * inverseDelta;
  const rawZ = (currentPosition.z - state.previousPosition.z) * inverseDelta;
  const rawSpeed = Math.hypot(rawX, rawY, rawZ);
  state.previousPosition.x = currentPosition.x;
  state.previousPosition.y = currentPosition.y;
  state.previousPosition.z = currentPosition.z;

  if (!Number.isFinite(rawSpeed) || rawSpeed > tuning.maximumTrackedSpeed) {
    return clearMotionResult(state, output, true);
  }

  const alpha = 1 - Math.exp(-Math.max(0, tuning.smoothingRate) * deltaSeconds);
  state.filteredVelocity.x += (rawX - state.filteredVelocity.x) * alpha;
  state.filteredVelocity.y += (rawY - state.filteredVelocity.y) * alpha;
  state.filteredVelocity.z += (rawZ - state.filteredVelocity.z) * alpha;
  output.velocity.x = state.filteredVelocity.x;
  output.velocity.y = state.filteredVelocity.y;
  output.velocity.z = state.filteredVelocity.z;
  output.speed = Math.hypot(output.velocity.x, output.velocity.y, output.velocity.z);
  output.trackingSpikeRejected = false;
  return output;
}

export type PullPhase = 'idle' | 'armed' | 'pulling' | 'recovery';

export interface PullGestureState {
  phase: PullPhase;
  accumulatedPullDistance: number;
  accumulatedImpulse: number;
  pendingShortenDistance: number;
  recoveryDistance: number;
}

export interface PullGestureInput {
  ropeActive: boolean;
  ropeNearTaut: boolean;
  controllerPosition: Vector3Value;
  controllerVelocity: Vector3Value;
  chestPosition: Vector3Value;
  deltaSeconds: number;
}

export interface PullGestureTuning {
  deadZoneSpeed: number;
  activationSpeed: number;
  minimumArmExtension: number;
  recoveryDistance: number;
  maximumPendingDistance: number;
  maximumTrackedSpeed: number;
  baseForce: number;
  additionalForce: number;
  minimumLaunchImpulse: number;
  maxImpulsePerPull: number;
}

export interface PullGestureResult {
  inwardSpeed: number;
  acceptedPullDistance: number;
  impulseMagnitude: number;
  pullStarted: boolean;
  phaseChanged: boolean;
}

export function ignorePullGestureSample(
  _state: PullGestureState,
  output: PullGestureResult,
): PullGestureResult {
  output.inwardSpeed = 0;
  output.acceptedPullDistance = 0;
  output.impulseMagnitude = 0;
  output.pullStarted = false;
  output.phaseChanged = false;
  return output;
}

export function createPullGestureState(): PullGestureState {
  return {
    phase: 'idle',
    accumulatedPullDistance: 0,
    accumulatedImpulse: 0,
    pendingShortenDistance: 0,
    recoveryDistance: 0,
  };
}

export function updatePullGesture(
  state: PullGestureState,
  input: PullGestureInput,
  tuning: PullGestureTuning,
  output: PullGestureResult,
): PullGestureResult {
  output.inwardSpeed = 0;
  output.acceptedPullDistance = 0;
  output.impulseMagnitude = 0;
  output.pullStarted = false;
  output.phaseChanged = false;

  if (!input.ropeActive) {
    output.phaseChanged = state.phase !== 'idle';
    state.phase = 'idle';
    state.accumulatedPullDistance = 0;
    state.accumulatedImpulse = 0;
    state.pendingShortenDistance = 0;
    state.recoveryDistance = 0;
    return output;
  }

  const toChestX = input.chestPosition.x - input.controllerPosition.x;
  const toChestY = input.chestPosition.y - input.controllerPosition.y;
  const toChestZ = input.chestPosition.z - input.controllerPosition.z;
  const extension = Math.hypot(toChestX, toChestY, toChestZ);
  if (extension > 1e-8) {
    output.inwardSpeed = (
      input.controllerVelocity.x * toChestX
      + input.controllerVelocity.y * toChestY
      + input.controllerVelocity.z * toChestZ
    ) / extension;
  }

  if (state.phase === 'idle') {
    if (extension < tuning.minimumArmExtension) return output;
    state.phase = 'armed';
    output.phaseChanged = true;
  }

  if (state.phase === 'armed' && extension < tuning.minimumArmExtension) {
    state.phase = 'idle';
    state.accumulatedPullDistance = 0;
    state.accumulatedImpulse = 0;
    state.pendingShortenDistance = 0;
    state.recoveryDistance = 0;
    output.phaseChanged = true;
    return output;
  }

  const deltaSeconds = Math.max(0, Math.min(input.deltaSeconds, 0.1));
  if (state.phase === 'recovery') {
    const signedOutwardSpeed = -output.inwardSpeed;
    const recoverySpeed = signedOutwardSpeed > tuning.deadZoneSpeed
      ? signedOutwardSpeed - tuning.deadZoneSpeed
      : signedOutwardSpeed < -tuning.deadZoneSpeed
        ? signedOutwardSpeed + tuning.deadZoneSpeed
        : 0;
    state.recoveryDistance += recoverySpeed * deltaSeconds;
    if (state.recoveryDistance >= tuning.recoveryDistance) {
      state.phase = extension >= tuning.minimumArmExtension ? 'armed' : 'idle';
      state.recoveryDistance = 0;
      state.accumulatedPullDistance = 0;
      state.accumulatedImpulse = 0;
      output.phaseChanged = true;
    }
    return output;
  }

  if (state.phase === 'pulling' && output.inwardSpeed <= tuning.deadZoneSpeed) {
    state.phase = 'recovery';
    state.recoveryDistance = 0;
    output.phaseChanged = true;
    return output;
  }

  if (
    state.phase === 'armed'
    && output.inwardSpeed > tuning.deadZoneSpeed
    && output.inwardSpeed <= tuning.activationSpeed
  ) {
    output.acceptedPullDistance = (output.inwardSpeed - tuning.deadZoneSpeed) * deltaSeconds;
    state.accumulatedPullDistance += output.acceptedPullDistance;
    state.pendingShortenDistance = Math.min(
      tuning.maximumPendingDistance,
      state.pendingShortenDistance + output.acceptedPullDistance,
    );
    return output;
  }

  if (state.phase === 'armed' && output.inwardSpeed > tuning.activationSpeed) {
    state.phase = 'pulling';
    output.pullStarted = true;
    output.phaseChanged = true;
  }

  if (state.phase === 'pulling') {
    output.acceptedPullDistance = Math.max(0, output.inwardSpeed - tuning.deadZoneSpeed) * deltaSeconds;
    state.accumulatedPullDistance += output.acceptedPullDistance;
    state.pendingShortenDistance = Math.min(
      tuning.maximumPendingDistance,
      state.pendingShortenDistance + output.acceptedPullDistance,
    );
    const pullRange = Math.max(tuning.maximumTrackedSpeed - tuning.activationSpeed, 1e-6);
    const normalizedPull = Math.max(
      0,
      Math.min((output.inwardSpeed - tuning.activationSpeed) / pullRange, 1),
    );
    const pullForce = tuning.baseForce + normalizedPull * tuning.additionalForce;
    const requestedImpulse = (
      output.acceptedPullDistance * pullForce
      + (output.pullStarted ? tuning.minimumLaunchImpulse : 0)
    );
    const availableImpulse = Math.max(0, tuning.maxImpulsePerPull - state.accumulatedImpulse);
    output.impulseMagnitude = Math.min(requestedImpulse, availableImpulse);
    state.accumulatedImpulse += output.impulseMagnitude;
  }
  return output;
}
