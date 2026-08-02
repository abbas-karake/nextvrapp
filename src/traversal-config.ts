export interface TraversalConfig {
  physics: {
    fixedHz: number;
    maximumCatchUpSteps: number;
    playerMass: number;
    gravity: number;
    maximumSafeDeltaSeconds: number;
  };
  rope: {
    maxRange: number;
    minimumLength: number;
    maximumLength: number;
    minimumAnchorDistance: number;
    attachmentPreload: number;
    stiffness: number;
    damping: number;
    maxForce: number;
    reelSensitivity: number;
    slackTolerance: number;
  };
  pull: {
    deadZoneSpeed: number;
    activationSpeed: number;
    maximumTrackedSpeed: number;
    controllerVelocitySmoothing: number;
    minimumArmExtension: number;
    maximumPendingDistance: number;
    maximumPullRate: number;
    baseForce: number;
    additionalForce: number;
    recoveryDistance: number;
    maxImpulsePerPull: number;
  };
  dualPull: {
    synchronizationWindowMs: number;
    maximumMultiplier: number;
    maximumForce: number;
    ropeDirectionWeight: number;
    velocityWeight: number;
    gazeWeight: number;
  };
  swing: {
    assist: number;
    minimumAssistSpeed: number;
    maximumAssistedSpeed: number;
    releaseAssist: number;
  };
  airControl: {
    acceleration: number;
    maximumInfluenceSpeed: number;
  };
  targeting: {
    assistEnabled: boolean;
    assistConeAngleDegrees: number;
    assistSphereRadius: number;
    maximumAssistRays: number;
  };
  comfort: {
    vignetteEnabled: boolean;
    vignetteStrength: number;
    vignetteStartSpeed: number;
    maximumSpeed: number;
    accelerationScale: number;
    pullStrengthScale: number;
    swingAssistScale: number;
    cameraRollEnabled: boolean;
    artificialCameraRoll: number;
    snapTurnEnabled: boolean;
    snapTurnDegrees: number;
    smoothTurnSpeed: number;
    horizonStabilization: number;
    impactShakeStrength: number;
  };
}

export const traversalConfig: TraversalConfig = {
  physics: {
    fixedHz: 72,
    maximumCatchUpSteps: 3,
    playerMass: 1,
    gravity: -11.5,
    maximumSafeDeltaSeconds: 0.1,
  },
  rope: {
    maxRange: 80,
    minimumLength: 1.5,
    maximumLength: 80,
    minimumAnchorDistance: 2,
    attachmentPreload: 0.02,
    stiffness: 110,
    damping: 14,
    maxForce: 4500,
    reelSensitivity: 1,
    slackTolerance: 0.02,
  },
  pull: {
    deadZoneSpeed: 0.08,
    activationSpeed: 0.18,
    maximumTrackedSpeed: 4,
    controllerVelocitySmoothing: 18,
    minimumArmExtension: 0.35,
    maximumPendingDistance: 0.65,
    maximumPullRate: 2,
    baseForce: 120,
    additionalForce: 850,
    recoveryDistance: 0.12,
    maxImpulsePerPull: 7.5,
  },
  dualPull: {
    synchronizationWindowMs: 180,
    maximumMultiplier: 1.25,
    maximumForce: 6500,
    ropeDirectionWeight: 0.7,
    velocityWeight: 0.2,
    gazeWeight: 0.1,
  },
  swing: {
    assist: 30,
    minimumAssistSpeed: 2,
    maximumAssistedSpeed: 28,
    releaseAssist: 0.15,
  },
  airControl: {
    acceleration: 3.5,
    maximumInfluenceSpeed: 25,
  },
  targeting: {
    assistEnabled: true,
    assistConeAngleDegrees: 4,
    assistSphereRadius: 0.5,
    maximumAssistRays: 9,
  },
  comfort: {
    vignetteEnabled: false,
    vignetteStrength: 0.35,
    vignetteStartSpeed: 12,
    maximumSpeed: 28,
    accelerationScale: 1,
    pullStrengthScale: 1,
    swingAssistScale: 1,
    cameraRollEnabled: false,
    artificialCameraRoll: 0,
    snapTurnEnabled: false,
    snapTurnDegrees: 30,
    smoothTurnSpeed: 1.8,
    horizonStabilization: 1,
    impactShakeStrength: 0,
  },
};
