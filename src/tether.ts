import * as THREE from 'three';
import type { TetherConstraint } from './swing';
import { traversalConfig } from './traversal-config';
import type { RopeAttachment } from './traversal-types';

export type GripTetherAction = 'idle' | 'fire' | 'hold' | 'release';
export type TetherEvent = 'attached' | 'missed';

export function gripTetherAction(wasHeld: boolean, gripValue: number): GripTetherAction {
  if (!wasHeld && gripValue >= 0.55) return 'fire';
  if (wasHeld && gripValue <= 0.3) return 'release';
  return wasHeld ? 'hold' : 'idle';
}

export function advanceTetherProjectile(
  distance: number,
  speed: number,
  targetDistance: number,
  deltaSeconds: number,
): { distance: number; reached: boolean } {
  const next = Math.min(targetDistance, distance + speed * Math.max(0, deltaSeconds));
  return { distance: next, reached: next >= targetDistance };
}

export class VisualTether {
  private mode: 'idle' | 'flying' | 'attached' = 'idle';
  private readonly projectile: THREE.Mesh;
  private readonly line: THREE.Line;
  private readonly linePositions: THREE.BufferAttribute;
  private readonly raycaster = new THREE.Raycaster();
  private readonly start = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly anchorNormal = new THREE.Vector3();
  private readonly anchorLocalPoint = new THREE.Vector3();
  private readonly normalMatrix = new THREE.Matrix3();
  private anchorObjectId = '';
  private traveled = 0;
  private targetDistance = 0;
  private willAttach = false;
  private ropeLength = 0;

  constructor(scene: THREE.Scene, color: number) {
    this.projectile = new THREE.Mesh(
      new THREE.SphereGeometry(0.105, 10, 7),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    const geometry = new THREE.BufferGeometry();
    this.linePositions = new THREE.BufferAttribute(new Float32Array(6), 3);
    geometry.setAttribute('position', this.linePositions);
    this.line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.92, toneMapped: false }));
    this.projectile.visible = false;
    this.line.visible = false;
    scene.add(this.projectile, this.line);
  }

  fire(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    targets: THREE.Object3D[],
    bodyPosition: THREE.Vector3,
  ): void {
    this.release();
    this.start.copy(origin);
    const normalizedDirection = direction.clone().normalize();
    this.raycaster.set(origin, normalizedDirection);
    this.raycaster.near = 0.15;
    this.raycaster.far = traversalConfig.rope.maxRange;
    const directHit = this.raycaster.intersectObjects(targets, true)[0];
    // Aim assist: when the centre ray misses (or hits a non-swingable
    // blocker), sweep a small cone of neighbouring rays so near-miss shots
    // still find the building edge the player clearly meant to hit.
    let hit = directHit;
    if (
      !hit
      || (() => {
        let swingObject: THREE.Object3D | null = hit!.object;
        while (swingObject && swingObject.userData.swingable !== true) {
          swingObject = swingObject.parent;
        }
        return !(swingObject && hit!.distance >= traversalConfig.rope.minimumAnchorDistance);
      })()
    ) {
      const assist = traversalConfig.targeting;
      if (assist.assistEnabled) {
        const coneRadians = THREE.MathUtils.degToRad(assist.assistConeAngleDegrees);
        const ringCount = assist.maximumAssistRays >= 9 ? 2 : 1;
        const raysPerRing = Math.max(4, Math.floor(assist.maximumAssistRays / ringCount));
        const up = Math.abs(normalizedDirection.y) < 0.9
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0);
        const right = new THREE.Vector3().crossVectors(normalizedDirection, up).normalize();
        const trueUp = new THREE.Vector3().crossVectors(right, normalizedDirection).normalize();
        outer: for (let ring = 1; ring <= ringCount; ring += 1) {
          const angle = coneRadians * (ring / ringCount);
          for (let ray = 0; ray < raysPerRing; ray += 1) {
            const theta = (ray / raysPerRing) * Math.PI * 2;
            const offsetDirection = normalizedDirection.clone()
              .addScaledVector(right, Math.cos(theta) * Math.sin(angle))
              .addScaledVector(trueUp, Math.sin(theta) * Math.sin(angle))
              .normalize();
            this.raycaster.set(origin, offsetDirection);
            const assistedHit = this.raycaster.intersectObjects(targets, true)[0];
            if (!assistedHit) continue;
            let swingObject: THREE.Object3D | null = assistedHit.object;
            while (swingObject && swingObject.userData.swingable !== true) {
              swingObject = swingObject.parent;
            }
            if (swingObject && assistedHit.distance >= traversalConfig.rope.minimumAnchorDistance) {
              hit = assistedHit;
              break outer;
            }
          }
        }
      }
    }
    if (hit) {
      this.target.copy(hit.point);
      let swingObject: THREE.Object3D | null = hit.object;
      while (swingObject && swingObject.userData.swingable !== true) swingObject = swingObject.parent;
      if (swingObject && hit.distance >= 2) {
        this.anchorObjectId = String(swingObject.userData.swingObjectId ?? swingObject.uuid);
        this.anchorLocalPoint.copy(hit.point);
        swingObject.worldToLocal(this.anchorLocalPoint);
        if (hit.face) {
          this.normalMatrix.getNormalMatrix(hit.object.matrixWorld);
          this.anchorNormal.copy(hit.face.normal).applyMatrix3(this.normalMatrix).normalize();
        } else {
          this.anchorNormal.copy(normalizedDirection).multiplyScalar(-1);
        }
        this.willAttach = true;
      } else {
        this.anchorObjectId = '';
        this.willAttach = false;
      }
    } else {
      this.target.copy(origin).addScaledVector(normalizedDirection, 80);
      this.anchorObjectId = '';
      this.willAttach = false;
    }
    this.targetDistance = origin.distanceTo(this.target);
    this.traveled = 0;
    this.mode = 'flying';
    this.ropeLength = THREE.MathUtils.clamp(bodyPosition.distanceTo(this.target) * 0.94, 3.5, 70);
    this.projectile.position.copy(origin);
    this.projectile.visible = true;
    this.line.visible = true;
    this.updateLine(origin, origin);
  }

  update(deltaSeconds: number, handPosition: THREE.Vector3): TetherEvent | undefined {
    if (this.mode === 'idle') return undefined;
    if (this.mode === 'flying') {
      const travel = advanceTetherProjectile(this.traveled, 46, this.targetDistance, deltaSeconds);
      this.traveled = travel.distance;
      this.projectile.position.lerpVectors(this.start, this.target, this.targetDistance > 0 ? this.traveled / this.targetDistance : 1);
      this.updateLine(handPosition, this.projectile.position);
      if (travel.reached) {
        if (this.willAttach) {
          this.mode = 'attached';
          this.anchor.copy(this.target);
          this.projectile.position.copy(this.anchor);
          return 'attached';
        }
        this.release();
        return 'missed';
      }
      return undefined;
    }
    this.projectile.position.copy(this.anchor);
    this.updateLine(handPosition, this.anchor);
    return undefined;
  }

  release(): boolean {
    const wasActive = this.mode !== 'idle';
    this.mode = 'idle';
    this.projectile.visible = false;
    this.line.visible = false;
    return wasActive;
  }

  isAttached(): boolean {
    return this.mode === 'attached';
  }

  getAttachment(): RopeAttachment | undefined {
    if (!this.isAttached()) return undefined;
    return {
      point: { x: this.anchor.x, y: this.anchor.y, z: this.anchor.z },
      normal: { x: this.anchorNormal.x, y: this.anchorNormal.y, z: this.anchorNormal.z },
      objectId: this.anchorObjectId,
      localPoint: {
        x: this.anchorLocalPoint.x,
        y: this.anchorLocalPoint.y,
        z: this.anchorLocalPoint.z,
      },
    };
  }

  getConstraint(): TetherConstraint | undefined {
    if (!this.isAttached()) return undefined;
    return {
      anchor: { x: this.anchor.x, y: this.anchor.y, z: this.anchor.z },
      length: this.ropeLength,
    };
  }

  setRopeLength(length: number): void {
    this.ropeLength = length;
  }

  private updateLine(from: THREE.Vector3, to: THREE.Vector3): void {
    this.linePositions.setXYZ(0, from.x, from.y, from.z);
    this.linePositions.setXYZ(1, to.x, to.y, to.z);
    this.linePositions.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
  }
}
