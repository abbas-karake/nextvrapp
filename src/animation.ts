import * as THREE from 'three';

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
