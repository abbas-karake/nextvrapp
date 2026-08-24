import { describe, expect, it } from 'vitest';
import { traversalConfig } from '../src/traversal-config';

describe('traversal tuning configuration', () => {
  it('centralizes safe Quest defaults for rope traversal', () => {
    expect(traversalConfig.physics.fixedHz).toBe(72);
    expect(traversalConfig.physics.maximumCatchUpSteps).toBe(3);
    expect(traversalConfig.rope.maxRange).toBe(80);
    expect(traversalConfig.rope.minimumLength).toBe(1.5);
    expect(traversalConfig.rope.attachmentPreload).toBe(0.02);
    expect(traversalConfig.rope.stiffness).toBe(110);
    expect(traversalConfig.rope.damping).toBe(14);
    expect(traversalConfig.rope.maxForce).toBe(4500);
    expect(traversalConfig.pull.maximumTrackedSpeed).toBe(4);
    expect(traversalConfig.pull.activationSpeed).toBe(0.1);
    expect(traversalConfig.pull.minimumArmExtension).toBe(0.2);
    expect(traversalConfig.pull.maximumPendingDistance).toBe(0.65);
    expect(traversalConfig.pull.maximumPullRate).toBe(2);
    expect(traversalConfig.pull.minimumLaunchImpulse).toBe(6);
    expect(traversalConfig.pull.maxImpulsePerPull).toBe(12);
    expect(traversalConfig.dualPull.maximumMultiplier).toBe(1.25);
    expect(traversalConfig.swing.maximumAssistedSpeed).toBe(38);
    expect(traversalConfig.swing.releaseBoostScale).toBeGreaterThan(1);
    expect(traversalConfig.swingPendulum.autoReelRate).toBeGreaterThan(0);
    expect(traversalConfig.swingPendulum.autoReelSpeedCeiling)
      .toBeGreaterThan(traversalConfig.swingPendulum.autoReelSpeedFloor);
    expect(traversalConfig.targeting.assistConeAngleDegrees).toBe(10);
    expect(traversalConfig.comfort.cameraRollEnabled).toBe(false);
    expect(traversalConfig.comfort.impactShakeStrength).toBe(0);
    expect(traversalConfig.comfort.maximumSpeed)
      .toBeGreaterThanOrEqual(traversalConfig.swing.maximumAssistedSpeed);
  });
});
