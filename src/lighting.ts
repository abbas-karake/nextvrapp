import * as THREE from 'three';

export function createQuestVisibleMaterial(
  material: THREE.Material,
  fallbackColor = 0xb8cad8,
): THREE.Material {
  if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhongMaterial)) {
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
): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = true;
    if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => createQuestVisibleMaterial(material, fallbackColor));
    } else {
      child.material = createQuestVisibleMaterial(child.material, fallbackColor);
    }
  });
}
