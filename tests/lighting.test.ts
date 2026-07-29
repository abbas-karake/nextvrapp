import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { configureQuestVisibleModel, createQuestVisibleMaterial, createSharedAtlasMaterial } from '../src/lighting';

describe('Quest lighting compatibility', () => {
  it('preserves mapped GLTF materials and forces a white atlas multiplier', () => {
    const texture = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ color: 0x000000, map: texture });
    const result = createQuestVisibleMaterial(source, 0x88aacc);
    expect(result).toBe(source);
    expect(source.map).toBe(texture);
    expect(source.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(source.color.getHex()).toBe(0xffffff);
  });

  it('preserves mapped MeshPhong pedestrian materials', () => {
    const texture = new THREE.Texture();
    const source = new THREE.MeshPhongMaterial({ color: 0x000000, map: texture });
    expect(createQuestVisibleMaterial(source, 0xd9a17c)).toBe(source);
    expect(source.color.getHex()).toBe(0xffffff);
  });

  it('uses a visible unlit fallback only for untextured meshes', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const result = createQuestVisibleMaterial(source, 0x88aacc);
    expect(result).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((result as THREE.MeshBasicMaterial).color.getHex()).toBe(0x88aacc);
  });

  it('applies one shared atlas material to every mesh in a prefab', () => {
    const texture = new THREE.Texture();
    const shared = createSharedAtlasMaterial(texture);
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()),
    );
    configureQuestVisibleModel(root, 0xffffff, shared);
    const materials: THREE.Material[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) materials.push(object.material as THREE.Material);
    });
    expect(materials).toEqual([shared, shared]);
    expect(shared.map).toBe(texture);
    expect(texture.flipY).toBe(false);
  });
});
