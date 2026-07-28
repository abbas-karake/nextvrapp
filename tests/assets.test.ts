import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { filterAnimationClipToObject } from '../src/animation';

const asset = new URL('../public/assets/models/people/walk.json', import.meta.url);

describe('pedestrian assets', () => {
  it('ships a real skeletal walk clip with tracks and duration', async () => {
    const clip = JSON.parse(await readFile(asset, 'utf8')) as {
      duration?: number;
      tracks?: unknown[];
    };
    expect(clip.duration).toBeGreaterThan(0);
    expect(clip.tracks?.length).toBeGreaterThan(0);
  });

  it('removes animation tracks for bones missing from a character rig', () => {
    const rig = new THREE.Group();
    const hips = new THREE.Bone();
    hips.name = 'Hips';
    rig.add(hips);
    const clip = new THREE.AnimationClip('walk', 1, [
      new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0], [0, 0, 0, 1]),
      new THREE.QuaternionKeyframeTrack('Missing.quaternion', [0], [0, 0, 0, 1]),
    ]);
    const filtered = filterAnimationClipToObject(clip, rig);
    expect(filtered.tracks.map((track) => track.name)).toEqual(['Hips.quaternion']);
    expect(clip.tracks).toHaveLength(2);
  });
});
