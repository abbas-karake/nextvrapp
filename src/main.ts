import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { CITY_LIMIT, CITY_SPAWN, createCityWorld, type CityRuntime } from './city';
import { createControllerHand, type ControllerHand } from './hands';
import { getHandPose, isJumpPressed, readThumbstick, type GamepadLike } from './input';
import { applyDeadzone, moveFromStick, startJump, stepVertical, type VerticalState } from './locomotion';
import { moveRigWithTrackedCollision } from './world';
import './styles.css';

const MOVE_SPEED = 3.4;
const TURN_SPEED = 1.8;
const JUMP_SPEED = 5.2;
const GRAVITY = -12;
const PLAYER_RADIUS = 0.32;

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('App root not found');

root.innerHTML = `
  <div id="hud">
    <div class="brand">NEXT <strong>VR</strong></div>
    <h1>Open City</h1>
    <p id="status">Building the city…</p>
    <div class="controls">
      <div><span>MOVE</span> Left stick · Right stick turn</div>
      <div><span>JUMP</span> A/X or press either stick</div>
      <div><span>HANDS</span> Trigger points · Grip closes fingers</div>
      <div><span>DESKTOP</span> WASD · mouse · Space</div>
    </div>
    <p class="hint">Explore downtown, suburbs, traffic, pedestrians, and the central fountain plaza.</p>
  </div>
  <div id="crosshair" aria-hidden="true"></div>
`;

const status = document.querySelector<HTMLParagraphElement>('#status');
THREE.Cache.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x93c8e5);
scene.fog = new THREE.Fog(0x93c8e5, 82, 205);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 280);
const player = new THREE.Group();
camera.position.set(0, 1.65, 0);
player.position.set(CITY_SPAWN.x, 0, CITY_SPAWN.z);
player.add(camera);
scene.add(player);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
root.prepend(renderer.domElement);

const vrButton = VRButton.createButton(renderer);
vrButton.id = 'vr-button';
document.body.appendChild(vrButton);

scene.add(new THREE.HemisphereLight(0xe9f7ff, 0x506247, 2.35));
const sun = new THREE.DirectionalLight(0xffedc8, 2.75);
sun.position.set(-55, 90, 34);
scene.add(sun);
const warmFill = new THREE.DirectionalLight(0xffc58f, 0.55);
warmFill.position.set(70, 24, -80);
scene.add(warmFill);

let city: CityRuntime = {
  colliders: [],
  update: () => undefined,
  counts: { buildings: 0, vehicles: 0, pedestrians: 0 },
};
try {
  city = await createCityWorld(scene, (message) => {
    if (status) status.textContent = message;
  });
  if (status) {
    status.textContent = `${city.counts.buildings} buildings · ${city.counts.vehicles} vehicles · ${city.counts.pedestrians} pedestrians`;
  }
} catch (error) {
  if (status) status.textContent = 'Some city assets could not load — reload to retry';
  console.error('City asset loading failed', error);
}

const pointerControls = new PointerLockControls(camera, renderer.domElement);
renderer.domElement.addEventListener('click', () => {
  if (!renderer.xr.isPresenting) pointerControls.lock();
});

const keys = new Set<string>();
let verticalState: VerticalState = { height: 0, velocity: 0, grounded: true };
let desktopJumpQueued = false;

addEventListener('keydown', (event) => {
  keys.add(event.code);
  if (event.code === 'Space' && !event.repeat) desktopJumpQueued = true;
});
addEventListener('keyup', (event) => keys.delete(event.code));

interface ControllerState {
  targetRay: THREE.Group;
  grip: THREE.Group;
  inputSource?: XRInputSource;
  hand?: ControllerHand;
}

function createController(index: number): ControllerState {
  const targetRay = renderer.xr.getController(index);
  const grip = renderer.xr.getControllerGrip(index);
  const state: ControllerState = { targetRay, grip };

  targetRay.addEventListener('connected', (event) => {
    const source = (event as unknown as { data: XRInputSource }).data;
    state.inputSource = source;
    if (state.hand) grip.remove(state.hand.object);
    if (source.handedness === 'left' || source.handedness === 'right') {
      state.hand = createControllerHand(source.handedness);
      state.hand.object.visible = true;
      grip.add(state.hand.object);
    }
  });
  targetRay.addEventListener('disconnected', () => {
    state.inputSource = undefined;
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
const facing = new THREE.Vector3();
const trackedHeadWorld = new THREE.Vector3();

function getFacingYaw(): number {
  camera.getWorldDirection(facing);
  return Math.atan2(-facing.x, -facing.z);
}

function getDesktopStick(): { x: number; y: number } {
  return {
    x: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
    y: Number(keys.has('KeyS')) - Number(keys.has('KeyW')),
  };
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
  const movement = moveFromStick(moveStick.x, moveStick.y, getFacingYaw(), MOVE_SPEED, deltaSeconds);
  player.updateMatrixWorld(true);
  const trackedCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  trackedCamera.getWorldPosition(trackedHeadWorld);
  const next = moveRigWithTrackedCollision(
    { x: player.position.x, z: player.position.z },
    {
      x: trackedHeadWorld.x - player.position.x,
      z: trackedHeadWorld.z - player.position.z,
    },
    movement,
    PLAYER_RADIUS,
    city.colliders,
    CITY_LIMIT,
  );
  player.position.x = next.x;
  player.position.z = next.z;

  if (jumpPressed && !jumpWasPressed) verticalState = startJump(verticalState, JUMP_SPEED);
  jumpWasPressed = jumpPressed;
  verticalState = stepVertical(verticalState, deltaSeconds, GRAVITY);
  player.position.y = verticalState.height;
}

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-vr');
  renderer.xr.setFoveation(1);
  if (status) status.textContent = 'VR active — explore the open city';
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-vr');
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
