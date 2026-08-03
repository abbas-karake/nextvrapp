import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { GameAudio } from './audio';
import { CITY_LIMIT, CITY_SPAWN, createCityWorld, type CityRuntime } from './city';
import { createControllerHand, visualHandednessForController, type ControllerHand } from './hands';
import {
  createControllerMotionState,
  createPullGestureState,
  ignorePullGestureSample,
  sampleControllerLocalMotion,
  updatePullGesture,
  worldToPlayerLocalPosition,
  type ControllerMotionSampleResult,
  type ControllerMotionState,
  type PullGestureResult,
  type PullGestureState,
} from './hand-pull';
import { getHandPose, isJumpPressed, readThumbstick, ropeButtonAction, type GamepadLike, type RopeButtonAction } from './input';
import { applyDeadzone, moveFromViewDirection } from './locomotion';
import { shouldUseGroundLocomotion } from './swing';
import { resolveTraversalGrounded, stepTraversalPhysics, type TraversalPhysicsState } from './rope-physics';
import { traversalConfig } from './traversal-config';
import {
  attachRope,
  beginRopeFlight,
  createRopeState,
  discardSlackPullImpulse,
  queueRopePull,
  releaseRope,
  ropeAcceptsPullInput,
} from './traversal-controller';
import type { RopeState } from './traversal-types';
import { VisualTether } from './tether';
import { moveBodyWithCollisionsSubstepped, moveRigWithTrackedCollision } from './world';
import './styles.css';

const MOVE_SPEED = 3.4;
const TURN_SPEED = 1.8;
const POWER_JUMP_SPEED = 10.5;
const PLAYER_RADIUS = 0.32;
const BODY_OFFSET_Y = 1.1;

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('App root not found');

root.innerHTML = `
  <div id="hud">
    <div class="brand">NEXT <strong>VR</strong></div>
    <h1>Open City</h1>
    <p id="status">Building the city…</p>
    <div class="controls">
      <div><span>MOVE</span> Left stick · Right stick turn</div>
      <div><span>POWER JUMP</span> A/X or press either stick</div>
      <div><span>TETHER</span> Hold either trigger · release to fly</div>
      <div><span>DESKTOP</span> WASD · mouse · Space</div>
    </div>
    <p class="hint">Aim a hand at a building, hold its trigger, pull and swing, then release with your momentum.</p>
  </div>
  <div id="crosshair" aria-hidden="true"></div>
`;

const status = document.querySelector<HTMLParagraphElement>('#status');
THREE.Cache.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x93c8e5);
scene.fog = new THREE.Fog(0x93c8e5, 82, 205);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 300);
const player = new THREE.Group();
camera.position.set(0, 1.65, 0);
player.position.set(CITY_SPAWN.x, 0, CITY_SPAWN.z);
player.add(camera);
scene.add(player);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
root.prepend(renderer.domElement);

const vrButton = VRButton.createButton(renderer);
vrButton.id = 'vr-button';
document.body.appendChild(vrButton);

scene.add(new THREE.AmbientLight(0xffffff, 1.65));
scene.add(new THREE.HemisphereLight(0xe9f7ff, 0x64745d, 1.35));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.85);
sun.position.set(-55, 90, 34);
scene.add(sun);
const warmFill = new THREE.DirectionalLight(0xffc58f, 0.55);
warmFill.position.set(70, 24, -80);
scene.add(warmFill);

let city: CityRuntime = {
  colliders: [],
  swingTargets: [],
  ropeRaycastTargets: [],
  update: () => undefined,
  counts: { buildings: 0, vehicles: 0, pedestrians: 0 },
};
try {
  city = await createCityWorld(scene, (message) => {
    if (status) status.textContent = message;
  });
  if (status) {
    status.textContent = `${city.counts.buildings} buildings · ${city.counts.vehicles} vehicles · ${city.counts.pedestrians} pedestrians · swing power ready`;
  }
} catch (error) {
  if (status) status.textContent = 'Some city assets could not load — reload to retry';
  console.error('City asset loading failed', error);
}

const pointerControls = new PointerLockControls(camera, renderer.domElement);
const gameAudio = new GameAudio();
addEventListener('pointerdown', () => void gameAudio.unlock(), { passive: true });
renderer.domElement.addEventListener('click', () => {
  if (!renderer.xr.isPresenting) pointerControls.lock();
});

const keys = new Set<string>();
let desktopJumpQueued = false;
addEventListener('keydown', (event) => {
  keys.add(event.code);
  if (event.code === 'Space' && !event.repeat) desktopJumpQueued = true;
});
addEventListener('keyup', (event) => keys.delete(event.code));

interface ControllerState {
  targetRay: THREE.Group;
  grip: THREE.Group;
  tether: VisualTether;
  inputSource?: XRInputSource;
  hand?: ControllerHand;
  rope?: RopeState;
  buttonHeld: boolean;
  pendingActions: RopeButtonAction[];
  worldHandPosition: THREE.Vector3;
  localHandPosition: THREE.Vector3;
  controllerMotion: ControllerMotionState;
  controllerMotionResult: ControllerMotionSampleResult;
  pullGesture: PullGestureState;
  pullGestureResult: PullGestureResult;
}

const ropeStates: Record<'left' | 'right', RopeState> = {
  left: createRopeState('left', traversalConfig.rope.minimumLength, traversalConfig.rope.maximumLength),
  right: createRopeState('right', traversalConfig.rope.minimumLength, traversalConfig.rope.maximumLength),
};
const activeRopes = [ropeStates.left, ropeStates.right];

function releaseControllerTether(state: ControllerState, clearPending = false): void {
  const visualReleased = state.tether.release();
  const ropeReleased = state.rope ? releaseRope(state.rope) : false;
  if (visualReleased || ropeReleased) gameAudio.play('release');
  state.buttonHeld = false;
  state.pullGesture.phase = 'idle';
  state.pullGesture.accumulatedPullDistance = 0;
  state.pullGesture.accumulatedImpulse = 0;
  state.pullGesture.pendingShortenDistance = 0;
  state.pullGesture.recoveryDistance = 0;
  if (clearPending) {
    state.pendingActions.length = 0;
    state.controllerMotion.initialized = false;
  }
}

function createController(index: number): ControllerState {
  const targetRay = renderer.xr.getController(index);
  const grip = renderer.xr.getControllerGrip(index);
  const state: ControllerState = {
    targetRay,
    grip,
    tether: new VisualTether(scene, index === 0 ? 0x67e8f9 : 0xf0abfc),
    buttonHeld: false,
    pendingActions: [],
    worldHandPosition: new THREE.Vector3(),
    localHandPosition: new THREE.Vector3(),
    controllerMotion: createControllerMotionState(),
    controllerMotionResult: {
      velocity: { x: 0, y: 0, z: 0 },
      speed: 0,
      trackingSpikeRejected: false,
    },
    pullGesture: createPullGestureState(),
    pullGestureResult: {
      inwardSpeed: 0,
      acceptedPullDistance: 0,
      impulseMagnitude: 0,
      pullStarted: false,
      phaseChanged: false,
    },
  };

  targetRay.addEventListener('connected', (event) => {
    const source = (event as unknown as { data: XRInputSource }).data;
    releaseControllerTether(state, true);
    state.inputSource = source;
    state.rope = source.handedness === 'left' || source.handedness === 'right'
      ? ropeStates[source.handedness]
      : undefined;
    if (state.hand) grip.remove(state.hand.object);
    if (source.handedness === 'left' || source.handedness === 'right') {
      state.hand = createControllerHand(visualHandednessForController(source.handedness));
      state.hand.object.visible = true;
      grip.add(state.hand.object);
    }
  });
  targetRay.addEventListener('selectstart', () => {
    state.pendingActions.push('fire');
  });
  targetRay.addEventListener('selectend', () => {
    state.pendingActions.push('release');
  });
  targetRay.addEventListener('disconnected', () => {
    state.inputSource = undefined;
    releaseControllerTether(state, true);
    state.rope = undefined;
    if (state.hand) {
      grip.remove(state.hand.object);
      state.hand = undefined;
    }
  });

  player.add(targetRay, grip);
  return state;
}

const controllers = [createController(0), createController(1)];
let jumpWasPressed = false;
let motionState: TraversalPhysicsState = {
  position: { x: CITY_SPAWN.x, y: 0, z: CITY_SPAWN.z },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  physicsRemainder: 0,
};
const viewForward = new THREE.Vector3();
const trackedHeadWorld = new THREE.Vector3();
const chestLocalPosition = new THREE.Vector3();
const leftRopeOffset = new THREE.Vector3(0, BODY_OFFSET_Y, 0);
const rightRopeOffset = new THREE.Vector3(0, BODY_OFFSET_Y, 0);
const aimDirection = new THREE.Vector3();
const bodyWorld = new THREE.Vector3();

function getDesktopStick(): { x: number; y: number } {
  return {
    x: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
    y: Number(keys.has('KeyS')) - Number(keys.has('KeyW')),
  };
}

function beginControllerTether(state: ControllerState): void {
  if (!state.rope) return;
  state.targetRay.updateWorldMatrix(true, false);
  state.grip.updateWorldMatrix(true, false);
  state.grip.getWorldPosition(state.worldHandPosition);
  aimDirection.set(0, 0, -1).transformDirection(state.targetRay.matrixWorld);
  bodyWorld.set(player.position.x, player.position.y + BODY_OFFSET_Y, player.position.z);
  beginRopeFlight(state.rope);
  state.tether.fire(state.worldHandPosition, aimDirection, city.ropeRaycastTargets, bodyWorld);
  state.buttonHeld = true;
  gameAudio.play('shoot');
}

function updatePlayer(deltaSeconds: number): void {
  let moveStick = getDesktopStick();
  let turnInput = 0;
  let jumpPressed = desktopJumpQueued;
  desktopJumpQueued = false;

  if (renderer.xr.isPresenting) {
    moveStick = { x: 0, y: 0 };
    for (const controller of controllers) {
      const source = controller.inputSource;
      const gamepad = source?.gamepad as unknown as GamepadLike | undefined;
      controller.hand?.update(getHandPose(gamepad), deltaSeconds);
      if (!source || !gamepad) continue;
      const stick = readThumbstick(gamepad);
      if (source.handedness === 'left') moveStick = stick;
      if (source.handedness === 'right') turnInput = applyDeadzone(stick.x);
      jumpPressed ||= isJumpPressed(gamepad);
    }
  }

  player.rotation.y -= turnInput * TURN_SPEED * deltaSeconds;
  player.updateMatrixWorld(true);
  if (renderer.xr.isPresenting) {
    const xrCamera = renderer.xr.getCamera();
    viewForward.set(0, 0, -1).applyQuaternion(xrCamera.quaternion).transformDirection(player.matrixWorld);
    trackedHeadWorld.copy(xrCamera.position).applyMatrix4(player.matrixWorld);
  } else {
    camera.getWorldDirection(viewForward);
    camera.getWorldPosition(trackedHeadWorld);
  }
  viewForward.y = 0;
  if (viewForward.lengthSq() < 1e-6) viewForward.set(0, 0, -1);
  viewForward.normalize();

  worldToPlayerLocalPosition(
    trackedHeadWorld,
    player.position,
    player.rotation.y,
    chestLocalPosition,
  );
  chestLocalPosition.y -= 0.25;
  leftRopeOffset.set(0, BODY_OFFSET_Y, 0);
  rightRopeOffset.set(0, BODY_OFFSET_Y, 0);
  for (const controller of controllers) {
    const source = controller.inputSource;
    const nativeGamepad = source?.gamepad;
    const queuedActionCount = controller.pendingActions.length;
    for (let actionIndex = 0; actionIndex < queuedActionCount; actionIndex += 1) {
      const action = controller.pendingActions[actionIndex];
      if (action === 'fire' && !controller.buttonHeld) beginControllerTether(controller);
      if (action === 'release') releaseControllerTether(controller);
    }
    controller.pendingActions.length = 0;

    if (queuedActionCount === 0 && nativeGamepad?.mapping === 'xr-standard' && nativeGamepad.buttons[0]) {
      const action = ropeButtonAction(controller.buttonHeld, nativeGamepad.buttons[0].value);
      if (action === 'fire' && !controller.buttonHeld) beginControllerTether(controller);
      if (action === 'release') releaseControllerTether(controller);
    }

    controller.grip.updateWorldMatrix(true, false);
    controller.grip.getWorldPosition(controller.worldHandPosition);
    if (source?.handedness === 'left') {
      leftRopeOffset.set(
        controller.worldHandPosition.x - player.position.x,
        controller.worldHandPosition.y - player.position.y,
        controller.worldHandPosition.z - player.position.z,
      );
    } else if (source?.handedness === 'right') {
      rightRopeOffset.set(
        controller.worldHandPosition.x - player.position.x,
        controller.worldHandPosition.y - player.position.y,
        controller.worldHandPosition.z - player.position.z,
      );
    }

    worldToPlayerLocalPosition(
      controller.worldHandPosition,
      player.position,
      player.rotation.y,
      controller.localHandPosition,
    );
    sampleControllerLocalMotion(
      controller.controllerMotion,
      controller.localHandPosition,
      deltaSeconds,
      {
        smoothingRate: traversalConfig.pull.controllerVelocitySmoothing,
        maximumTrackedSpeed: traversalConfig.pull.maximumTrackedSpeed,
      },
      controller.controllerMotionResult,
    );
    const rope = controller.rope;
    const anchor = rope?.anchorPoint;
    const ropeNearTaut = Boolean(
      rope?.active
      && anchor
      && Math.hypot(
        anchor.x - controller.worldHandPosition.x,
        anchor.y - controller.worldHandPosition.y,
        anchor.z - controller.worldHandPosition.z,
      ) >= rope.currentLength - traversalConfig.rope.slackTolerance,
    );
    if (rope) discardSlackPullImpulse(rope, ropeNearTaut);
    const pullInputActive = rope ? ropeAcceptsPullInput(rope) : false;
    const pullInputNearTaut = rope?.lifecycle === 'flying' || ropeNearTaut;
    if (controller.controllerMotionResult.trackingSpikeRejected) {
      ignorePullGestureSample(controller.pullGesture, controller.pullGestureResult);
    } else {
      updatePullGesture(
        controller.pullGesture,
        {
          ropeActive: pullInputActive,
          ropeNearTaut: pullInputNearTaut,
          controllerPosition: controller.localHandPosition,
          controllerVelocity: controller.controllerMotionResult.velocity,
          chestPosition: chestLocalPosition,
          deltaSeconds,
        },
        {
          deadZoneSpeed: traversalConfig.pull.deadZoneSpeed,
          activationSpeed: traversalConfig.pull.activationSpeed,
          minimumArmExtension: traversalConfig.pull.minimumArmExtension,
          recoveryDistance: traversalConfig.pull.recoveryDistance,
          maximumPendingDistance: traversalConfig.pull.maximumPendingDistance,
          maximumTrackedSpeed: traversalConfig.pull.maximumTrackedSpeed,
          baseForce: traversalConfig.pull.baseForce,
          additionalForce: traversalConfig.pull.additionalForce,
          maxImpulsePerPull: traversalConfig.pull.maxImpulsePerPull,
        },
        controller.pullGestureResult,
      );
    }
    if (rope) {
      rope.previousControllerPosition.x = controller.localHandPosition.x;
      rope.previousControllerPosition.y = controller.localHandPosition.y;
      rope.previousControllerPosition.z = controller.localHandPosition.z;
      rope.filteredControllerVelocity.x = controller.controllerMotionResult.velocity.x;
      rope.filteredControllerVelocity.y = controller.controllerMotionResult.velocity.y;
      rope.filteredControllerVelocity.z = controller.controllerMotionResult.velocity.z;
      rope.accumulatedPullDistance = controller.pullGesture.accumulatedPullDistance;
      rope.pullPhase = controller.pullGesture.phase;
      queueRopePull(
        rope,
        controller.pullGestureResult.acceptedPullDistance,
        controller.pullGestureResult.impulseMagnitude,
        traversalConfig.rope.reelSensitivity,
        traversalConfig.pull.maximumPendingDistance,
        traversalConfig.pull.maxImpulsePerPull,
      );
      if (controller.pullGestureResult.pullStarted) rope.lastFullPullAtTime = performance.now();
    }

    const tetherEvent = controller.tether.update(deltaSeconds, controller.worldHandPosition);
    if (tetherEvent === 'attached' && controller.rope) {
      const attachment = controller.tether.getAttachment();
      if (attachment) {
        attachRope(
          controller.rope,
          attachment,
          controller.worldHandPosition,
          performance.now(),
          traversalConfig.rope.attachmentPreload,
        );
        queueRopePull(
          controller.rope,
          controller.pullGesture.pendingShortenDistance,
          controller.pullGesture.accumulatedImpulse,
          traversalConfig.rope.reelSensitivity,
          traversalConfig.pull.maximumPendingDistance,
          traversalConfig.pull.maxImpulsePerPull,
        );
        controller.pullGesture.pendingShortenDistance = 0;
        gameAudio.play('attach');
      }
    } else if (tetherEvent === 'missed' && controller.rope) {
      releaseRope(controller.rope);
    }
  }

  const tethered = activeRopes.some((rope) => rope.active);

  const jumpStarted = jumpPressed && !jumpWasPressed && motionState.grounded;
  if (jumpStarted) {
    motionState.velocity.y = POWER_JUMP_SPEED;
    motionState.grounded = false;
    gameAudio.play('jump');
  }
  jumpWasPressed = jumpPressed;

  const walkingMovement = moveFromViewDirection(
    moveStick.x,
    moveStick.y,
    viewForward.x,
    viewForward.z,
    MOVE_SPEED,
    deltaSeconds,
  );
  const controlDirection = moveFromViewDirection(
    moveStick.x,
    moveStick.y,
    viewForward.x,
    viewForward.z,
    1,
    1,
  );
  const wasGrounded = motionState.grounded;

  if (shouldUseGroundLocomotion(motionState, tethered, jumpStarted)) {
    const next = moveRigWithTrackedCollision(
      { x: player.position.x, z: player.position.z },
      {
        x: trackedHeadWorld.x - player.position.x,
        z: trackedHeadWorld.z - player.position.z,
      },
      walkingMovement,
      PLAYER_RADIUS,
      city.colliders,
      CITY_LIMIT,
      trackedHeadWorld.y,
    );
    player.position.x = next.x;
    player.position.z = next.z;
    player.position.y = 0;
    motionState.position.x = next.x;
    motionState.position.y = 0;
    motionState.position.z = next.z;
    motionState.velocity.x = 0;
    motionState.velocity.y = 0;
    motionState.velocity.z = 0;
    motionState.grounded = true;
  } else {
    const previousX = motionState.position.x;
    const previousY = motionState.position.y;
    const previousZ = motionState.position.z;
    const physicsSteps = stepTraversalPhysics(
      motionState,
      activeRopes,
      {
        x: controlDirection.x,
        z: controlDirection.z,
        leftRopeOffset,
        rightRopeOffset,
      },
      deltaSeconds,
      traversalConfig,
    );
    const desired = motionState.position;
    const collision = moveBodyWithCollisionsSubstepped(
      { x: trackedHeadWorld.x, y: previousY, z: trackedHeadWorld.z },
      {
        x: desired.x - previousX,
        y: desired.y - previousY,
        z: desired.z - previousZ,
      },
      PLAYER_RADIUS,
      BODY_OFFSET_Y * 2,
      city.colliders,
      CITY_LIMIT,
    );
    desired.x = previousX + collision.position.x - trackedHeadWorld.x;
    desired.y = collision.position.y;
    desired.z = previousZ + collision.position.z - trackedHeadWorld.z;
    if (collision.collidedX) motionState.velocity.x = 0;
    if (collision.collidedZ) motionState.velocity.z = 0;
    if (collision.collidedY) motionState.velocity.y = 0;
    motionState.grounded = resolveTraversalGrounded(wasGrounded, physicsSteps, collision.landed);
    player.position.set(desired.x, desired.y, desired.z);
    for (const controller of controllers) {
      if (controller.rope?.active) controller.tether.setRopeLength(controller.rope.currentLength);
    }
  }

  if (!wasGrounded && motionState.grounded) gameAudio.play('land');
  const speed = Math.hypot(motionState.velocity.x, motionState.velocity.y, motionState.velocity.z);
  gameAudio.update(Math.hypot(walkingMovement.x, walkingMovement.z) > 0.002, motionState.grounded, deltaSeconds);
  gameAudio.setSwingSpeed(!motionState.grounded || tethered ? speed : 0);
}

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-vr');
  void gameAudio.unlock();
  renderer.xr.setFoveation(0.65);
  if (status) status.textContent = 'VR active — aim at a building and hold either trigger';
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-vr');
  controllers.forEach((controller) => releaseControllerTether(controller, true));
  gameAudio.setSwingSpeed(0);
  if (status) status.textContent = 'VR session ended — ready to re-enter';
});

if ('xr' in navigator && navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (status && city.counts.buildings === 0) {
      status.textContent = supported ? 'Headset detected — city is loading' : 'Desktop preview — city is loading';
    }
  }).catch(() => undefined);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const timer = new THREE.Timer();
timer.connect(document);
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const deltaSeconds = Math.min(timer.getDelta(), 0.05);
  city.update(deltaSeconds, player.position);
  updatePlayer(deltaSeconds);
  renderer.render(scene, camera);
});
