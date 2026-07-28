import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { isJumpPressed, readThumbstick, type GamepadLike } from './input';
import {
  applyDeadzone,
  getTerrainHeight,
  moveFromStick,
  startJump,
  stepVertical,
  type VerticalState,
} from './locomotion';
import './styles.css';

const MOVE_SPEED = 3.2;
const TURN_SPEED = 1.8;
const JUMP_SPEED = 5.2;
const GRAVITY = -12;
const WORLD_LIMIT = 46;

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('App root not found');

root.innerHTML = `
  <div id="hud">
    <div class="brand">NEXT <strong>VR</strong></div>
    <h1>Terrain Walk</h1>
    <p id="status">Preparing WebXR…</p>
    <div class="controls">
      <div><span>VR</span> Left stick move · Right stick turn</div>
      <div><span>JUMP</span> A/X or press either stick</div>
      <div><span>DESKTOP</span> WASD · mouse · Space</div>
    </div>
    <p class="hint">Look around naturally with your headset. Smooth turning is intentionally gentle.</p>
  </div>
  <div id="crosshair" aria-hidden="true"></div>
`;

const status = document.querySelector<HTMLParagraphElement>('#status');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec9e8);
scene.fog = new THREE.Fog(0x8ec9e8, 32, 92);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 140);
const player = new THREE.Group();
camera.position.set(0, 1.65, 0);
player.position.set(0, getTerrainHeight(0, 0), 8);
player.add(camera);
scene.add(player);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
root.prepend(renderer.domElement);

const vrButton = VRButton.createButton(renderer);
vrButton.id = 'vr-button';
document.body.appendChild(vrButton);

scene.add(new THREE.HemisphereLight(0xe8f7ff, 0x334522, 2.1));
const sun = new THREE.DirectionalLight(0xfff0c2, 2.2);
sun.position.set(-18, 28, 12);
scene.add(sun);

function createTerrain(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(100, 100, 80, 80);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;

  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, getTerrainHeight(positions.getX(index), positions.getZ(index)));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x5f8f46,
    roughness: 0.95,
    metalness: 0,
    flatShading: false,
  });
  return new THREE.Mesh(geometry, material);
}
scene.add(createTerrain());

function addLandmarks(): void {
  const trunkGeometry = new THREE.CylinderGeometry(0.11, 0.16, 1.25, 6);
  const crownGeometry = new THREE.ConeGeometry(0.65, 1.8, 7);
  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    new THREE.MeshStandardMaterial({ color: 0x5b3926, roughness: 1 }),
    34,
  );
  const crowns = new THREE.InstancedMesh(
    crownGeometry,
    new THREE.MeshStandardMaterial({ color: 0x245d35, roughness: 1 }),
    34,
  );
  const matrix = new THREE.Matrix4();

  for (let index = 0; index < 34; index += 1) {
    const angle = index * 2.399;
    const radius = 12 + ((index * 7) % 27);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const ground = getTerrainHeight(x, z);
    matrix.makeTranslation(x, ground + 0.625, z);
    trunks.setMatrixAt(index, matrix);
    matrix.makeTranslation(x, ground + 1.9, z);
    crowns.setMatrixAt(index, matrix);
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  scene.add(trunks, crowns);

  const beacon = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.25, 1),
    new THREE.MeshStandardMaterial({ color: 0xffc857, emissive: 0x7a3d00, emissiveIntensity: 0.45 }),
  );
  beacon.position.set(0, getTerrainHeight(0, -18) + 2.3, -18);
  scene.add(beacon);
}
addLandmarks();

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
  object: THREE.Group;
  inputSource?: XRInputSource;
}

function createController(index: number): ControllerState {
  const object = renderer.xr.getController(index);
  const rayGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -0.55),
  ]);
  object.add(new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({ color: 0xc8f7ff })));
  const state: ControllerState = { object };

  object.addEventListener('connected', (event) => {
    state.inputSource = (event as unknown as { data: XRInputSource }).data;
  });
  object.addEventListener('disconnected', () => {
    state.inputSource = undefined;
  });
  player.add(object);
  return state;
}

const controllers = [createController(0), createController(1)];
let jumpWasPressed = false;

function getFacingYaw(): number {
  const facing = new THREE.Vector3();
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
      if (!source?.gamepad) continue;
      const gamepad = source.gamepad as unknown as GamepadLike;
      const stick = readThumbstick(gamepad);
      if (source.handedness === 'left') moveStick = stick;
      if (source.handedness === 'right') turnInput = applyDeadzone(stick.x);
      jumpPressed ||= isJumpPressed(gamepad);
    }
  }

  player.rotation.y -= turnInput * TURN_SPEED * deltaSeconds;
  const movement = moveFromStick(moveStick.x, moveStick.y, getFacingYaw(), MOVE_SPEED, deltaSeconds);
  player.position.x = THREE.MathUtils.clamp(player.position.x + movement.x, -WORLD_LIMIT, WORLD_LIMIT);
  player.position.z = THREE.MathUtils.clamp(player.position.z + movement.z, -WORLD_LIMIT, WORLD_LIMIT);

  if (jumpPressed && !jumpWasPressed) verticalState = startJump(verticalState, JUMP_SPEED);
  jumpWasPressed = jumpPressed;
  verticalState = stepVertical(verticalState, deltaSeconds, GRAVITY);
  player.position.y = getTerrainHeight(player.position.x, player.position.z) + verticalState.height;
}

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-vr');
  if (status) status.textContent = 'VR active — explore the terrain';
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-vr');
  if (status) status.textContent = 'VR session ended — ready to re-enter';
});

if ('xr' in navigator && navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (status) status.textContent = supported ? 'Headset detected — press ENTER VR' : 'Desktop preview — open this link in Quest Browser';
  }).catch(() => {
    if (status) status.textContent = 'WebXR check unavailable — desktop preview active';
  });
} else if (status) {
  status.textContent = 'Desktop preview — open this HTTPS link in Quest Browser';
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
  updatePlayer(deltaSeconds);
  renderer.render(scene, camera);
});
