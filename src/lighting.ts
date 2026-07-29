import * as THREE from 'three';

export function createSharedAtlasMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff, toneMapped: false });
}

export function createQuestVisibleMaterial(
  material: THREE.Material,
  fallbackColor = 0xb8cad8,
): THREE.Material {
  if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhongMaterial)) {
    return material;
  }
  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.color.setHex(0xffffff);
    return material;
  }
  return new THREE.MeshBasicMaterial({
    name: material.name,
    color: fallbackColor,
    vertexColors: false,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
    depthTest: material.depthTest,
    depthWrite: material.depthWrite,
    toneMapped: false,
  });
}

export function configureQuestVisibleModel(
  object: THREE.Object3D,
  fallbackColor = 0xb8cad8,
  sharedMaterial?: THREE.Material,
): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = true;
    if (sharedMaterial) {
      child.material = sharedMaterial;
    } else if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => createQuestVisibleMaterial(material, fallbackColor));
    } else {
      child.material = createQuestVisibleMaterial(child.material, fallbackColor);
    }
  });
}
