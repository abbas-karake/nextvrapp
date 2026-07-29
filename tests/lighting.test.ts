import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createQuestVisibleMaterial } from '../src/lighting';

describe('Quest lighting compatibility', () => {
  it('uses a deterministic visible fallback instead of a black atlas path', () => {
    const texture = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ color: 0x000000, map: texture });
    const result = createQuestVisibleMaterial(source, 0x88aacc);
    expect(result).toBeInstanceOf(THREE.MeshBasicMaterial);
    const visible = result as THREE.MeshBasicMaterial;
    expect(visible.map).toBeNull();
    expect(visible.color.getHex()).toBe(0x88aacc);
  });

  it('also converts the MeshPhong materials used by the pedestrian FBX', () => {
    const source = new THREE.MeshPhongMaterial({ color: 0x000000 });
    const result = createQuestVisibleMaterial(source, 0xd9a17c);
    expect(result).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((result as THREE.MeshBasicMaterial).color.getHex()).toBe(0xd9a17c);
  });
});
