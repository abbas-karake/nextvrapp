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
    expect(traversalConfig.dualPull.maximumMultiplier).toBe(1.25);
    expect(traversalConfig.swing.maximumAssistedSpeed).toBe(28);
    expect(traversalConfig.targeting.assistConeAngleDegrees).toBe(4);
    expect(traversalConfig.comfort.cameraRollEnabled).toBe(false);
    expect(traversalConfig.comfort.impactShakeStrength).toBe(0);
  });
});
