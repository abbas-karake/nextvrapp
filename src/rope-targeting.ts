import type { Vector3Value } from './swing';

export interface RopeTargetCandidate {
  point: Vector3Value;
  normal: Vector3Value;
  objectId: string;
  distance: number;
  angleDegrees: number;
  direct: boolean;
  visible: boolean;
  swingable: boolean;
}

export interface RopeTargetSelectionConfig {
  maxRange: number;
  minimumDistance: number;
  assistConeAngleDegrees: number;
}

export function chooseRopeTarget(
  candidates: readonly RopeTargetCandidate[],
  config: RopeTargetSelectionConfig,
): RopeTargetCandidate | null {
  const valid = candidates.filter((candidate) =>
    candidate.swingable
    && candidate.visible
    && candidate.distance >= config.minimumDistance
    && candidate.distance <= config.maxRange
    && (candidate.direct || candidate.angleDegrees <= config.assistConeAngleDegrees),
  );
  return valid.find((candidate) => candidate.direct) ?? valid[0] ?? null;
}
