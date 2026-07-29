import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { GameAudio } from './audio';
import { CITY_LIMIT, CITY_SPAWN, createCityWorld, type CityRuntime } from './city';
import { createControllerHand, visualHandednessForController, type ControllerHand } from './hands';
import { getHandPose, isJumpPressed, readThumbstick, type GamepadLike } from './input';
import { applyDeadzone, moveFromViewDirection } from './locomotion';
import { shouldUseGroundLocomotion, stepSwingPhysics, type SwingState, type TetherConstraint } from './swing';
import { gripTetherAction, VisualTether } from './tether';
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
      <div><span>TETHER</span> Hold either rear grip · release to fly</div>
      <div><span>DESKTOP</span> WASD · mouse · Space</div>
    </div>
    <p class="hint">Aim a hand at a building, squeeze the rear grip, swing, then release with your momentum.</p>
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
  gripHeld: boolean;
  queuedFire: boolean;
  queuedRelease: boolean;
}

function releaseControllerTether(state: ControllerState): void {
  if (state.tether.release()) gameAudio.play('release');
  state.gripHeld = false;
  state.queuedFire = false;
  state.queuedRelease = false;
}

function createController(index: number): ControllerState {
  const targetRay = renderer.xr.getController(index);
  const grip = renderer.xr.getControllerGrip(index);
  const state: ControllerState = {
    targetRay,
    grip,
    tether: new VisualTether(scene, index === 0 ? 0x67e8f9 : 0xf0abfc),
    gripHeld: false,
    queuedFire: false,
    queuedRelease: false,
  };

  targetRay.addEventListener('connected', (event) => {
    const source = (event as unknown as { data: XRInputSource }).data;
    state.inputSource = source;
    if (state.hand) grip.remove(state.hand.object);
    if (source.handedness === 'left' || source.handedness === 'right') {
      state.hand = createControllerHand(visualHandednessForController(source.handedness));
      state.hand.object.visible = true;
      grip.add(state.hand.object);
    }
  });
  targetRay.addEventListener('squeezestart', () => {
    state.queuedFire = true;
  });
  targetRay.addEventListener('squeezeend', () => {
    state.queuedRelease = true;
  });
  targetRay.addEventListener('disconnected', () => {
    state.inputSource = undefined;
    releaseControllerTether(state);
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
let motionState: SwingState = {
  position: { x: CITY_SPAWN.x, y: 0, z: CITY_SPAWN.z },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
};
const viewForward = new THREE.Vector3();
const trackedHeadWorld = new THREE.Vector3();
const handWorld = new THREE.Vector3();
const aimDirection = new THREE.Vector3();
const bodyWorld = new THREE.Vector3();

function getDesktopStick(): { x: number; y: number } {
  return {
    x: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
    y: Number(keys.has('KeyS')) - Number(keys.has('KeyW')),
  };
}

function beginControllerTether(state: ControllerState): void {
  state.targetRay.updateWorldMatrix(true, false);
  state.grip.updateWorldMatrix(true, false);
  state.grip.getWorldPosition(handWorld);
  aimDirection.set(0, 0, -1).transformDirection(state.targetRay.matrixWorld);
  bodyWorld.set(player.position.x, player.position.y + BODY_OFFSET_Y, player.position.z);
  state.tether.fire(handWorld, aimDirection, city.swingTargets, bodyWorld);
  state.gripHeld = true;
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

  for (const controller of controllers) {
    const source = controller.inputSource;
    const nativeGamepad = source?.gamepad;
    let action = controller.gripHeld ? 'hold' : 'idle';
    if (controller.queuedFire) {
      action = 'fire';
      controller.queuedFire = false;
    } else if (controller.queuedRelease) {
      action = 'release';
      controller.queuedRelease = false;
    } else if (nativeGamepad?.mapping === 'xr-standard' && nativeGamepad.buttons[1]) {
      action = gripTetherAction(controller.gripHeld, nativeGamepad.buttons[1].value);
    }
    if (action === 'fire' && !controller.gripHeld) beginControllerTether(controller);
    if (action === 'release') releaseControllerTether(controller);

    controller.grip.updateWorldMatrix(true, false);
    controller.grip.getWorldPosition(handWorld);
    const tetherEvent = controller.tether.update(deltaSeconds, handWorld);
    if (tetherEvent === 'attached') gameAudio.play('attach');
  }

  const attachedControllers = controllers.filter((controller) => controller.tether.isAttached());
  const constraints = attachedControllers
    .map((controller) => controller.tether.getConstraint())
    .filter((constraint): constraint is TetherConstraint => constraint !== undefined);
  const tethered = constraints.length > 0;

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
    motionState = {
      position: { x: next.x, y: 0, z: next.z },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
    };
  } else {
    const previous = { ...motionState.position };
    const result = stepSwingPhysics(
      motionState,
      constraints,
      { x: controlDirection.x, z: controlDirection.z, reel: tethered },
      deltaSeconds,
      { bodyOffsetY: BODY_OFFSET_Y, reelSpeed: 4.5, minimumRopeLength: 2, maxSpeed: 28 },
    );
    const desired = result.state.position;
    const collision = moveBodyWithCollisionsSubstepped(
      { x: trackedHeadWorld.x, y: previous.y, z: trackedHeadWorld.z },
      {
        x: desired.x - previous.x,
        y: desired.y - previous.y,
        z: desired.z - previous.z,
      },
      PLAYER_RADIUS,
      BODY_OFFSET_Y * 2,
      city.colliders,
      CITY_LIMIT,
    );
    desired.x = previous.x + collision.position.x - trackedHeadWorld.x;
    desired.y = collision.position.y;
    desired.z = previous.z + collision.position.z - trackedHeadWorld.z;
    if (collision.collidedX) result.state.velocity.x = 0;
    if (collision.collidedZ) result.state.velocity.z = 0;
    if (collision.collidedY) result.state.velocity.y = 0;
    if (collision.landed) result.state.grounded = true;
    motionState = result.state;
    motionState.position = desired;
    player.position.set(desired.x, desired.y, desired.z);
    result.tethers.forEach((tether, index) => attachedControllers[index]?.tether.setRopeLength(tether.length));
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
  if (status) status.textContent = 'VR active — aim at a building and hold either rear grip';
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-vr');
  controllers.forEach(releaseControllerTether);
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
