export interface ButtonLike {
  pressed: boolean;
}

export interface GamepadLike {
  axes: readonly number[];
  buttons: readonly ButtonLike[];
}

export interface StickAxes {
  x: number;
  y: number;
}

export function readThumbstick(gamepad: GamepadLike): StickAxes {
  const axisOffset = gamepad.axes.length >= 4 ? 2 : 0;
  return {
    x: gamepad.axes[axisOffset] ?? 0,
    y: gamepad.axes[axisOffset + 1] ?? 0,
  };
}

export function isJumpPressed(gamepad: GamepadLike): boolean {
  return Boolean(
    gamepad.buttons[3]?.pressed ||
      gamepad.buttons[4]?.pressed ||
      gamepad.buttons[5]?.pressed,
  );
}
