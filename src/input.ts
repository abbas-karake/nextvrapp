export interface ButtonLike {
  pressed: boolean;
  value?: number;
}

export interface GamepadLike {
  axes: readonly number[];
  buttons: readonly ButtonLike[];
}

export interface StickAxes {
  x: number;
  y: number;
}

export type RopeButtonAction = 'idle' | 'fire' | 'hold' | 'release';

export function ropeButtonAction(wasHeld: boolean, pressure: number): RopeButtonAction {
  if (!wasHeld && pressure >= 0.55) return 'fire';
  if (wasHeld && pressure <= 0.3) return 'release';
  return wasHeld ? 'hold' : 'idle';
}

export function readThumbstick(gamepad: GamepadLike): StickAxes {
  const axisOffset = gamepad.axes.length >= 4 ? 2 : 0;
  return {
    x: gamepad.axes[axisOffset] ?? 0,
    y: gamepad.axes[axisOffset + 1] ?? 0,
  };
}

export interface HandPose {
  trigger: number;
  grip: number;
  thumb: number;
}

function buttonPressure(button: ButtonLike | undefined): number {
  if (!button) return 0;
  if (typeof button.value === 'number') return Math.max(0, Math.min(button.value, 1));
  return button.pressed ? 1 : 0;
}

export function getHandPose(gamepad: GamepadLike | undefined): HandPose {
  if (!gamepad) return { trigger: 0, grip: 0, thumb: 0 };
  return {
    trigger: buttonPressure(gamepad.buttons[0]),
    grip: buttonPressure(gamepad.buttons[1]),
    thumb: Math.max(buttonPressure(gamepad.buttons[4]), buttonPressure(gamepad.buttons[5])),
  };
}

export function isJumpPressed(gamepad: GamepadLike): boolean {
  return Boolean(
    gamepad.buttons[3]?.pressed ||
      gamepad.buttons[4]?.pressed ||
      gamepad.buttons[5]?.pressed,
  );
}
