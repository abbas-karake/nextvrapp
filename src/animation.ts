import * as THREE from 'three';

export function retargetClipToBindPose(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks
    .filter((track) => THREE.PropertyBinding.parseTrackName(track.name).propertyName !== 'position')
    .map((track) => track.clone());
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

export function filterAnimationClipToObject(
  clip: THREE.AnimationClip,
  root: THREE.Object3D,
): THREE.AnimationClip {
  const tracks = clip.tracks.filter((track) => {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    return THREE.PropertyBinding.findNode(root, parsed.nodeName) !== null;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}
