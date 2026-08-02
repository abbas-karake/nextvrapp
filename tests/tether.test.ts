import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { advanceTetherProjectile, gripTetherAction, VisualTether } from '../src/tether';

describe('Quest grip tether input', () => {
  it('uses hysteresis for one fire and one release action', () => {
    expect(gripTetherAction(false, 0.6)).toBe('fire');
    expect(gripTetherAction(true, 0.4)).toBe('hold');
    expect(gripTetherAction(true, 0.2)).toBe('release');
    expect(gripTetherAction(false, 0.2)).toBe('idle');
  });
});

describe('visible tether projectile', () => {
  it('travels at finite speed and clamps at its target', () => {
    expect(advanceTetherProjectile(0, 40, 20, 0.1)).toEqual({ distance: 4, reached: false });
    expect(advanceTetherProjectile(19, 40, 20, 0.1)).toEqual({ distance: 20, reached: true });
  });

  it('does not attach through a nearer non-swingable foreground mesh', () => {
    const scene = new THREE.Scene();
    const blocker = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1), new THREE.MeshBasicMaterial());
    blocker.position.set(0, 0, -3);
    const target = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    target.position.set(0, 0, -8);
    target.userData.swingable = true;
    target.userData.swingObjectId = 'building-behind-prop';
    scene.add(blocker, target);
    scene.updateMatrixWorld(true);
    const tether = new VisualTether(scene, 0xffffff);
    const origin = new THREE.Vector3();
    tether.fire(origin, new THREE.Vector3(0, 0, -1), [target, blocker], origin);
    expect(tether.update(1, origin)).toBe('missed');
    expect(tether.getAttachment()).toBeUndefined();
  });

  it('rejects an otherwise valid anchor inside minimum distance', () => {
    const scene = new THREE.Scene();
    const target = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    target.position.z = -1.2;
    target.userData.swingable = true;
    target.userData.swingObjectId = 'too-near';
    scene.add(target);
    scene.updateMatrixWorld(true);
    const tether = new VisualTether(scene, 0xffffff);
    const origin = new THREE.Vector3();
    tether.fire(origin, new THREE.Vector3(0, 0, -1), [target], origin);
    expect(tether.update(1, origin)).toBe('missed');
  });

  it('stores the exact visible child-mesh hit through transformed parent metadata', () => {
    const scene = new THREE.Scene();
    const wrapper = new THREE.Group();
    wrapper.position.set(2, 1, -5);
    wrapper.userData.swingable = true;
    wrapper.userData.swingObjectId = 'test-building';
    const target = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    wrapper.add(target);
    scene.add(wrapper);
    scene.updateMatrixWorld(true);
    const tether = new VisualTether(scene, 0xffffff);
    const origin = new THREE.Vector3(2, 1, 0);
    tether.fire(origin, new THREE.Vector3(0, 0, -1), [wrapper], origin);
    expect(tether.update(1, origin)).toBe('attached');
    expect(tether.getAttachment()).toEqual({
      point: { x: 2, y: 1, z: -4 },
      normal: { x: 0, y: 0, z: 1 },
      objectId: 'test-building',
      localPoint: { x: 0, y: 0, z: 1 },
    });
  });
});
