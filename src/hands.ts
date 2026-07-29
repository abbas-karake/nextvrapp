import * as THREE from 'three';
import type { HandPose } from './input';

interface FingerRig {
  joints: THREE.Group[];
  strength: 'trigger' | 'grip';
}

export interface ControllerHand {
  object: THREE.Group;
  update: (pose: HandPose, deltaSeconds: number) => void;
}

export interface FingerLayout {
  x: number;
  width: number;
  length: number;
  strength: 'trigger' | 'grip';
}

const skinMaterial = new THREE.MeshLambertMaterial({ color: 0xd9a17c });
const nailMaterial = new THREE.MeshLambertMaterial({ color: 0xf2c7b2 });

export function visualHandednessForController(handedness: XRHandedness): XRHandedness {
  if (handedness === 'left') return 'right';
  if (handedness === 'right') return 'left';
  return handedness;
}

export function getFingerLayout(handedness: XRHandedness): FingerLayout[] {
  const indexToPinky = handedness === 'left'
    ? [-0.032, -0.011, 0.011, 0.032]
    : [0.032, 0.011, -0.011, -0.032];
  const lengths = [0.078, 0.086, 0.081, 0.069];
  return indexToPinky.map((x, index) => ({
    x,
    width: index === 0 || index === 3 ? 0.014 : 0.015,
    length: lengths[index],
    strength: index === 0 ? 'trigger' : 'grip',
  }));
}

function capsuleSegment(radius: number, span: number): THREE.Mesh {
  const cylinderLength = Math.max(0.002, span - radius * 2);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, cylinderLength, 4, 8), skinMaterial);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.z = -span / 2;
  return mesh;
}

function addFinger(parent: THREE.Group, layout: FingerLayout): FingerRig {
  const proportions = [0.43, 0.33, 0.24];
  const joints: THREE.Group[] = [];
  let current = parent;
  proportions.forEach((proportion, index) => {
    const span = layout.length * proportion;
    const joint = new THREE.Group();
    if (index === 0) joint.position.set(layout.x, 0, -0.076);
    current.add(joint);
    joint.add(capsuleSegment(layout.width * (0.5 - index * 0.035), span));
    const next = new THREE.Group();
    next.position.z = -span;
    joint.add(next);
    joints.push(joint);
    current = next;
  });
  return { joints, strength: layout.strength };
}

export function createControllerHand(handedness: XRHandedness): ControllerHand {
  const object = new THREE.Group();
  object.name = `${handedness}-power-hand`;
  object.visible = false;
  const side = handedness === 'left' ? -1 : 1;
  object.position.set(0, -0.018, -0.025);
  object.rotation.set(-0.08, 0, side * 0.06);

  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skinMaterial);
  palm.scale.set(0.047, 0.024, 0.061);
  palm.position.z = -0.027;
  object.add(palm);

  const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.025, 4, 10), skinMaterial);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.z = 0.047;
  object.add(wrist);

  const fingers = getFingerLayout(handedness).map((layout) => addFinger(object, layout));

  const thumbRoot = new THREE.Group();
  thumbRoot.position.set(side * 0.043, -0.004, -0.018);
  thumbRoot.rotation.set(0.28, side * 0.72, side * 0.18);
  const thumbMiddle = new THREE.Group();
  thumbRoot.add(capsuleSegment(0.009, 0.035));
  thumbMiddle.position.z = -0.035;
  thumbMiddle.add(capsuleSegment(0.008, 0.028));
  thumbRoot.add(thumbMiddle);
  object.add(thumbRoot);

  const nail = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 5), nailMaterial);
  nail.scale.set(0.009, 0.003, 0.013);
  nail.position.set(side * 0.053, -0.012, -0.063);
  object.add(nail);

  const target = { trigger: 0, grip: 0, thumb: 0 };
  const update = (pose: HandPose, deltaSeconds: number): void => {
    const blend = 1 - Math.exp(-18 * deltaSeconds);
    target.trigger = THREE.MathUtils.lerp(target.trigger, pose.trigger, blend);
    target.grip = THREE.MathUtils.lerp(target.grip, pose.grip, blend);
    target.thumb = THREE.MathUtils.lerp(target.thumb, pose.thumb, blend);
    for (const finger of fingers) {
      const curl = finger.strength === 'trigger' ? target.trigger : target.grip;
      finger.joints[0].rotation.x = -curl * 0.82;
      finger.joints[1].rotation.x = -curl * 1.05;
      finger.joints[2].rotation.x = -curl * 1.18;
    }
    thumbRoot.rotation.x = 0.28 - target.thumb * 0.72;
    thumbMiddle.rotation.x = -target.thumb * 0.9;
  };

  return { object, update };
}
