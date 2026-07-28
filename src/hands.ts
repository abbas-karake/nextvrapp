import * as THREE from 'three';
import type { HandPose } from './input';

interface FingerRig {
  root: THREE.Group;
  knuckle: THREE.Group;
  strength: 'trigger' | 'grip';
}

export interface ControllerHand {
  object: THREE.Group;
  update: (pose: HandPose, deltaSeconds: number) => void;
}

const skinMaterial = new THREE.MeshStandardMaterial({
  color: 0xd69a73,
  roughness: 0.72,
  metalness: 0,
});
const cuffMaterial = new THREE.MeshStandardMaterial({
  color: 0x172236,
  roughness: 0.7,
  metalness: 0.08,
});

function fingerSegment(width: number, length: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(width, width * 0.8, length);
  geometry.translate(0, 0, -length / 2);
  const mesh = new THREE.Mesh(geometry, skinMaterial);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export interface FingerLayout {
  x: number;
  width: number;
  length: number;
  strength: 'trigger' | 'grip';
}

export function getFingerLayout(handedness: XRHandedness): FingerLayout[] {
  const indexToPinky = handedness === 'left'
    ? [-0.032, -0.011, 0.011, 0.032]
    : [0.032, 0.011, -0.011, -0.032];
  const lengths = [0.052, 0.061, 0.057, 0.049];
  return indexToPinky.map((x, index) => ({
    x,
    width: index === 0 || index === 3 ? 0.016 : 0.017,
    length: lengths[index],
    strength: index === 0 ? 'trigger' : 'grip',
  }));
}

export function createControllerHand(handedness: XRHandedness): ControllerHand {
  const object = new THREE.Group();
  object.name = `${handedness}-controller-hand`;
  object.visible = false;

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.034, 0.105), skinMaterial);
  palm.position.set(0, -0.002, -0.035);
  object.add(palm);

  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.06, 8), cuffMaterial);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = 0.045;
  object.add(cuff);

  const fingerData = getFingerLayout(handedness);

  const fingers: FingerRig[] = [];
  for (const data of fingerData) {
    const root = new THREE.Group();
    root.position.set(data.x, 0, -0.084);
    root.add(fingerSegment(data.width, data.length * 0.58));
    const knuckle = new THREE.Group();
    knuckle.position.z = -data.length * 0.58;
    knuckle.add(fingerSegment(data.width * 0.9, data.length * 0.42));
    root.add(knuckle);
    object.add(root);
    fingers.push({ root, knuckle, strength: data.strength });
  }

  const side = handedness === 'left' ? -1 : 1;
  const thumb = new THREE.Group();
  thumb.position.set(side * 0.048, -0.002, -0.026);
  thumb.rotation.y = side * 0.78;
  thumb.add(fingerSegment(0.019, 0.05));
  object.add(thumb);

  const target = { trigger: 0, grip: 0, thumb: 0 };
  const update = (pose: HandPose, deltaSeconds: number): void => {
    const blend = 1 - Math.exp(-18 * deltaSeconds);
    target.trigger = THREE.MathUtils.lerp(target.trigger, pose.trigger, blend);
    target.grip = THREE.MathUtils.lerp(target.grip, pose.grip, blend);
    target.thumb = THREE.MathUtils.lerp(target.thumb, pose.thumb, blend);

    for (const finger of fingers) {
      const curl = finger.strength === 'trigger' ? target.trigger : target.grip;
      finger.root.rotation.x = -curl * 1.05;
      finger.knuckle.rotation.x = -curl * 1.2;
    }
    thumb.rotation.x = -target.thumb * 0.82;
    thumb.rotation.z = side * target.thumb * 0.35;
  };

  return { object, update };
}
