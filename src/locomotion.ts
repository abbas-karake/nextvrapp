export interface Movement2D {
  x: number;
  z: number;
}

export interface VerticalState {
  height: number;
  velocity: number;
  grounded: boolean;
}

export function applyDeadzone(value: number, deadzone = 0.15): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;

  const scaled = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(value) * Math.min(scaled, 1);
}

export function moveFromViewDirection(
  stickX: number,
  stickY: number,
  forwardX: number,
  forwardZ: number,
  speed: number,
  deltaSeconds: number,
): Movement2D {
  const forwardLength = Math.hypot(forwardX, forwardZ);
  const fx = forwardLength > 1e-6 ? forwardX / forwardLength : 0;
  const fz = forwardLength > 1e-6 ? forwardZ / forwardLength : -1;
  const rightX = -fz;
  const rightZ = fx;
  const strafe = applyDeadzone(stickX);
  const forward = -applyDeadzone(stickY);
  const inputLength = Math.hypot(strafe, forward);
  const normalizedScale = inputLength > 1 ? 1 / inputLength : 1;
  const distance = speed * deltaSeconds * normalizedScale;
  return {
    x: (fx * forward + rightX * strafe) * distance,
    z: (fz * forward + rightZ * strafe) * distance,
  };
}

export function moveFromStick(
  stickX: number,
  stickY: number,
  yaw: number,
  speed: number,
  deltaSeconds: number,
): Movement2D {
  const strafe = applyDeadzone(stickX);
  const forward = -applyDeadzone(stickY);
  const magnitude = Math.hypot(strafe, forward);
  const normalizedScale = magnitude > 1 ? 1 / magnitude : 1;
  const distance = speed * deltaSeconds * normalizedScale;

  return {
    x: (strafe * Math.cos(yaw) - forward * Math.sin(yaw)) * distance,
    z: (strafe * Math.sin(yaw) - forward * Math.cos(yaw)) * distance,
  };
}

export function startJump(state: VerticalState, jumpVelocity: number): VerticalState {
  if (!state.grounded) return state;
  return { ...state, velocity: jumpVelocity, grounded: false };
}

export function stepVertical(
  state: VerticalState,
  deltaSeconds: number,
  gravity: number,
): VerticalState {
  if (state.grounded) return state;

  const velocity = state.velocity + gravity * deltaSeconds;
  const height = state.height + velocity * deltaSeconds;

  if (height <= 0) return { height: 0, velocity: 0, grounded: true };
  return { height, velocity, grounded: false };
}

export function getTerrainHeight(x: number, z: number): number {
  return (
    Math.sin(x * 0.08) * 0.45 +
    Math.cos(z * 0.07) * 0.35 +
    Math.sin((x + z) * 0.13) * 0.2
  );
}
