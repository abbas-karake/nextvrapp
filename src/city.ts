import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { filterAnimationClipToObject, retargetClipToBindPose } from './animation';
import { configureQuestVisibleModel, createSharedAtlasMaterial } from './lighting';
import {
  advanceRouteDistance,
  getClosedRouteLength,
  loadAvailable,
  sampleClosedRoute,
  routeAgentVisualRotation,
  updateRouteAgentCollider,
  type Collider2D,
  type RoutePoint,
  type RouteSample,
} from './world';

export const CITY_LIMIT = 116;
export const CITY_SPAWN = { x: 18, z: 8 };

interface BuildingPlacement {
  model: string;
  family: 'city' | 'suburban';
  x: number;
  z: number;
  footprint: number;
  rotation: number;
}

interface RouteAgent {
  object: THREE.Group;
  route: readonly RoutePoint[];
  routeLength: number;
  distance: number;
  speed: number;
  sample: RouteSample;
  collider?: Collider2D;
  mixer?: THREE.AnimationMixer;
  visibilityRange: number;
}

export interface CityRuntime {
  colliders: Collider2D[];
  swingTargets: THREE.Object3D[];
  ropeRaycastTargets: THREE.Object3D[];
  update: (deltaSeconds: number, playerPosition: THREE.Vector3) => void;
  counts: {
    buildings: number;
    vehicles: number;
    pedestrians: number;
  };
}

const BASE = `${import.meta.env.BASE_URL}assets/models/`;
const blockCenters = [-60, -20, 20, 60] as const;
const roadCenters = [-80, -40, 0, 40, 80] as const;

function fallbackColorForAsset(path: string): number {
  const palettes = path.startsWith('cars/')
    ? [0xe63946, 0x457b9d, 0xf4a261, 0x2a9d8f, 0xf1c40f, 0xe76f51]
    : path.startsWith('suburban/')
      ? [0xe9c46a, 0xa8dadc, 0xf4a261, 0x90be6d, 0xd4a5a5]
      : [0xd9e6f2, 0xf2d0a7, 0xb8d8ba, 0xc9c3e6, 0xe7b8a2, 0xa9c8e8];
  let hash = 0;
  for (const character of path) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return palettes[hash % palettes.length];
}

function configureModel(
  object: THREE.Object3D,
  color = 0xb8cad8,
  sharedMaterial?: THREE.Material,
): void {
  configureQuestVisibleModel(object, color, sharedMaterial);
}

function configurePedestrianModel(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const name = child.name.toLowerCase();
    const color = name.includes('head') ? 0xd9a17c
      : name.includes('feet') ? 0x293241
        : name.includes('legs') ? 0x52677d
          : 0x3f83d4;
    configureQuestVisibleModel(child, color);
  });
}

function addGroundAndRoads(scene: THREE.Scene): void {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(250, 250),
    new THREE.MeshLambertMaterial({ color: 0x769d61 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMaterial = new THREE.MeshLambertMaterial({ color: 0x4a535d });
  for (const coordinate of roadCenters) {
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 240), roadMaterial);
    vertical.position.set(coordinate, 0.025, 0);
    const horizontal = new THREE.Mesh(new THREE.BoxGeometry(240, 0.08, 9), roadMaterial);
    horizontal.position.set(0, 0.025, coordinate);
    scene.add(vertical, horizontal);
  }

  const sidewalkGeometry = new THREE.BoxGeometry(31, 0.18, 31);
  const sidewalks = new THREE.InstancedMesh(
    sidewalkGeometry,
    new THREE.MeshLambertMaterial({ color: 0xd0d4d2 }),
    blockCenters.length ** 2,
  );
  const matrix = new THREE.Matrix4();
  let sidewalkIndex = 0;
  for (const x of blockCenters) {
    for (const z of blockCenters) {
      matrix.makeTranslation(x, 0.09, z);
      sidewalks.setMatrixAt(sidewalkIndex, matrix);
      sidewalkIndex += 1;
    }
  }
  sidewalks.instanceMatrix.needsUpdate = true;
  scene.add(sidewalks);

  const markerGeometry = new THREE.BoxGeometry(0.14, 0.018, 2.8);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xf6d66a });
  const markerCount = roadCenters.length * 58;
  const markers = new THREE.InstancedMesh(markerGeometry, markerMaterial, markerCount);
  let markerIndex = 0;
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  for (const road of roadCenters) {
    for (let along = -112; along <= 112; along += 8) {
      matrix.compose(new THREE.Vector3(road, 0.078, along), rotation, scale);
      markers.setMatrixAt(markerIndex, matrix);
      markerIndex += 1;
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      matrix.compose(new THREE.Vector3(along, 0.078, road), rotation, scale);
      markers.setMatrixAt(markerIndex, matrix);
      markerIndex += 1;
      rotation.identity();
    }
  }
  markers.count = markerIndex;
  markers.instanceMatrix.needsUpdate = true;
  scene.add(markers);

  const crosswalkGeometry = new THREE.BoxGeometry(0.55, 0.022, 3.2);
  const crosswalks = new THREE.InstancedMesh(
    crosswalkGeometry,
    new THREE.MeshBasicMaterial({ color: 0xf0f1ed }),
    48,
  );
  let crosswalkIndex = 0;
  for (const x of [-2.8, 2.8]) {
    for (let offset = -3; offset <= 3; offset += 1.2) {
      matrix.makeTranslation(x + offset * 0.13, 0.082, 6 + offset);
      crosswalks.setMatrixAt(crosswalkIndex++, matrix);
      matrix.makeTranslation(6 + offset, 0.082, x + offset * 0.13);
      matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
      crosswalks.setMatrixAt(crosswalkIndex++, matrix);
    }
  }
  crosswalks.count = crosswalkIndex;
  crosswalks.instanceMatrix.needsUpdate = true;
  scene.add(crosswalks);
}

function addStreetlights(scene: THREE.Scene, colliders: Collider2D[]): void {
  const positions: Array<{ x: number; z: number }> = [];
  for (const x of blockCenters) {
    for (const z of blockCenters) {
      positions.push({ x: x - 14.6, z: z - 14.6 }, { x: x + 14.6, z: z + 14.6 });
    }
  }

  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.075, 0.11, 3.4, 7),
    new THREE.MeshStandardMaterial({ color: 0x26313a, roughness: 0.7, metalness: 0.35 }),
    positions.length,
  );
  const lamps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.18, 8, 6),
    new THREE.MeshStandardMaterial({
      color: 0xffe6a3,
      emissive: 0xffb534,
      emissiveIntensity: 1.2,
      roughness: 0.5,
    }),
    positions.length,
  );
  const matrix = new THREE.Matrix4();
  positions.forEach((position, index) => {
    matrix.makeTranslation(position.x, 1.79, position.z);
    poles.setMatrixAt(index, matrix);
    matrix.makeTranslation(position.x, 3.52, position.z);
    lamps.setMatrixAt(index, matrix);
    colliders.push({
      minX: position.x - 0.2,
      maxX: position.x + 0.2,
      minZ: position.z - 0.2,
      maxZ: position.z + 0.2,
      minY: 0,
      maxY: 3.8,
    });
  });
  poles.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
  scene.add(poles, lamps);
}

function addPlaza(scene: THREE.Scene, colliders: Collider2D[]): void {
  const plaza = new THREE.Group();
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.8, 0.6, 20),
    new THREE.MeshStandardMaterial({ color: 0x8c969b, roughness: 0.8 }),
  );
  basin.position.y = 0.42;
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(2.15, 2.15, 0.08, 20),
    new THREE.MeshStandardMaterial({ color: 0x42a9c9, emissive: 0x0c4054, emissiveIntensity: 0.35, roughness: 0.25 }),
  );
  water.position.y = 0.75;
  const sculpture = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.55, 0.16, 48, 8),
    new THREE.MeshStandardMaterial({ color: 0xe2a94f, metalness: 0.55, roughness: 0.28 }),
  );
  sculpture.position.y = 1.75;
  plaza.add(basin, water, sculpture);
  plaza.position.set(20, 0, 20);
  scene.add(plaza);
  colliders.push({ minX: 17.1, maxX: 22.9, minZ: 17.1, maxZ: 22.9, minY: 0, maxY: 2.5 });
}

function createPlacements(): BuildingPlacement[] {
  const placements: BuildingPlacement[] = [];
  const cityModels = Array.from({ length: 14 }, (_, index) => `building-${String.fromCharCode(97 + index)}.glb`);
  const towers = Array.from({ length: 5 }, (_, index) => `building-skyscraper-${String.fromCharCode(97 + index)}.glb`);
  const homes = Array.from('acegikmoqsu', (letter) => `building-type-${letter}.glb`);
  let cityIndex = 0;
  let homeIndex = 0;
  let towerIndex = 0;

  for (const x of blockCenters) {
    for (const z of blockCenters) {
      if (x === 20 && z === 20) continue;
      const central = Math.abs(x) === 20 && Math.abs(z) === 20;
      const suburban = Math.abs(x) === 60 && Math.abs(z) === 60;
      const slots = [
        { dx: -8.1, dz: -7.7, rotation: 0 },
        { dx: 8.1, dz: -7.2, rotation: Math.PI / 2 },
        { dx: 0, dz: 8.4, rotation: cityIndex % 2 ? Math.PI : 0 },
      ];
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        const slot = slots[slotIndex];
        if (central && slotIndex === 2) {
          placements.push({
            model: towers[towerIndex++ % towers.length],
            family: 'city',
            x: x + slot.dx,
            z: z + slot.dz,
            footprint: 13,
            rotation: slot.rotation,
          });
        } else if (suburban) {
          placements.push({
            model: homes[homeIndex++ % homes.length],
            family: 'suburban',
            x: x + slot.dx,
            z: z + slot.dz,
            footprint: 11.5,
            rotation: slot.rotation,
          });
        } else {
          placements.push({
            model: cityModels[cityIndex++ % cityModels.length],
            family: 'city',
            x: x + slot.dx,
            z: z + slot.dz,
            footprint: central ? 12.5 : 11.8,
            rotation: slot.rotation,
          });
        }
      }
    }
  }
  return placements;
}

async function loadGltfTemplates(paths: readonly string[]): Promise<Map<string, THREE.Group>> {
  const loader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const unique = [...new Set(paths)];
  const families = [...new Set(unique.map((path) => path.split('/')[0]))];
  const atlasMaterials = await loadAvailable(
    families,
    async (family) => createSharedAtlasMaterial(
      await textureLoader.loadAsync(`${BASE}${family}/Textures/colormap.png`),
    ),
    (family, error) => console.warn(`Atlas unavailable for ${family}; using model material.`, error),
  );
  return loadAvailable(
    unique,
    async (path) => {
      const gltf = await loader.loadAsync(`${BASE}${path}`);
      configureModel(
        gltf.scene,
        fallbackColorForAsset(path),
        atlasMaterials.get(path.split('/')[0]),
      );
      return gltf.scene;
    },
    (path, error) => console.warn(`Skipped unavailable city asset: ${path}`, error),
  );
}

function normalizeModel(model: THREE.Object3D, targetSize: number): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = targetSize / Math.max(size.x, size.z, 0.001);
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  model.updateMatrixWorld(true);
}

function normalizeCharacter(model: THREE.Object3D, targetHeight: number): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.multiplyScalar(targetHeight / Math.max(size.y, 0.001));
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  model.updateMatrixWorld(true);
}

function addBuildings(
  scene: THREE.Scene,
  templates: ReadonlyMap<string, THREE.Group>,
  placements: readonly BuildingPlacement[],
  colliders: Collider2D[],
  swingTargets: THREE.Object3D[],
): void {
  for (const placement of placements) {
    const key = `${placement.family}/${placement.model}`;
    const template = templates.get(key);
    if (!template) continue;
    const wrapper = new THREE.Group();
    const model = template.clone(true);
    normalizeModel(model, placement.footprint);
    wrapper.add(model);
    wrapper.position.set(placement.x, 0.18, placement.z);
    wrapper.rotation.y = placement.rotation;
    wrapper.userData.swingable = true;
    wrapper.userData.swingObjectId = `building-${placement.family}-${placement.model}-${placement.x}-${placement.z}`;
    scene.add(wrapper);
    swingTargets.push(wrapper);
    wrapper.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrapper);
    colliders.push({
      minX: box.min.x + 0.08,
      maxX: box.max.x - 0.08,
      minZ: box.min.z + 0.08,
      maxZ: box.max.z - 0.08,
      minY: box.min.y,
      maxY: box.max.y,
    });
  }
}

function addPrefabTrees(scene: THREE.Scene, templates: ReadonlyMap<string, THREE.Group>, colliders: Collider2D[]): void {
  const positions = [
    [11, 11], [29, 11], [11, 29], [29, 29],
    [-74, -74], [-46, -74], [-74, -46], [74, 74], [46, 74], [74, 46],
    [-74, 74], [74, -74],
  ] as const;
  positions.forEach(([x, z], index) => {
    const key = `suburban/${index % 2 ? 'tree-small.glb' : 'tree-large.glb'}`;
    const template = templates.get(key);
    if (!template) return;
    const model = template.clone(true);
    normalizeModel(model, index % 2 ? 2.2 : 3.2);
    model.position.set(x, 0.18, z);
    model.rotation.y = index * 1.7;
    scene.add(model);
    colliders.push({ minX: x - 0.32, maxX: x + 0.32, minZ: z - 0.32, maxZ: z + 0.32, minY: 0, maxY: 4.5 });
  });
}

function createVehicleRoutes(): RoutePoint[][] {
  return [
    [{ x: -80, z: -80 }, { x: 80, z: -80 }, { x: 80, z: 80 }, { x: -80, z: 80 }],
    [{ x: -40, z: -40 }, { x: 40, z: -40 }, { x: 40, z: 40 }, { x: -40, z: 40 }],
    [{ x: -80, z: 0 }, { x: 80, z: 0 }, { x: 80, z: 40 }, { x: -80, z: 40 }],
  ];
}

function addVehicles(
  scene: THREE.Scene,
  templates: ReadonlyMap<string, THREE.Group>,
  colliders: Collider2D[],
): RouteAgent[] {
  const routes = createVehicleRoutes();
  const models = ['sedan.glb', 'sedan-sports.glb', 'suv.glb', 'taxi.glb', 'van.glb', 'delivery.glb', 'ambulance.glb', 'police.glb'];
  const agents: RouteAgent[] = [];
  for (let index = 0; index < 12; index += 1) {
    const template = templates.get(`cars/${models[index % models.length]}`);
    if (!template) continue;
    const route = routes[index % routes.length];
    const routeLength = getClosedRouteLength(route);
    const wrapper = new THREE.Group();
    const model = template.clone(true);
    normalizeModel(model, index % 5 === 0 ? 4.1 : 3.5);
    wrapper.add(model);
    scene.add(wrapper);
    const collider: Collider2D = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    colliders.push(collider);
    agents.push({
      object: wrapper,
      route,
      routeLength,
      distance: (routeLength * index) / 12 + (index % 3) * 7,
      speed: 5.2 + (index % 4) * 0.65,
      sample: { x: 0, z: 0, yaw: 0 },
      collider,
      visibilityRange: 155,
    });
  }
  return agents;
}

function createPedestrianRoutes(): RoutePoint[][] {
  return [
    [{ x: 6, z: 6 }, { x: 34, z: 6 }, { x: 34, z: 34 }, { x: 6, z: 34 }],
    [{ x: -34, z: 6 }, { x: -6, z: 6 }, { x: -6, z: 34 }, { x: -34, z: 34 }],
    [{ x: 46, z: -34 }, { x: 74, z: -34 }, { x: 74, z: -6 }, { x: 46, z: -6 }],
    [{ x: -74, z: 46 }, { x: -46, z: 46 }, { x: -46, z: 74 }, { x: -74, z: 74 }],
    [{ x: 46, z: 46 }, { x: 74, z: 46 }, { x: 74, z: 74 }, { x: 46, z: 74 }],
  ];
}

async function addPedestrians(scene: THREE.Scene, colliders: Collider2D[]): Promise<RouteAgent[]> {
  const loader = new FBXLoader();
  const [source, clipResponse] = await Promise.all([
    loader.loadAsync(`${BASE}people/casual2.fbx`),
    fetch(`${BASE}people/walk.json`),
  ]);
  if (!clipResponse.ok) throw new Error(`Walk animation request failed: ${clipResponse.status}`);
  const parsedWalkClip = THREE.AnimationClip.parse(await clipResponse.json());
  const filteredWalkClip = filterAnimationClipToObject(parsedWalkClip, source);
  const walkClip = retargetClipToBindPose(filteredWalkClip);
  configurePedestrianModel(source);
  const routes = createPedestrianRoutes();
  const agents: RouteAgent[] = [];
  for (let index = 0; index < 10; index += 1) {
    const route = routes[index % routes.length];
    const routeLength = getClosedRouteLength(route);
    const wrapper = new THREE.Group();
    const model = cloneSkeleton(source) as THREE.Group;
    normalizeCharacter(model, 1.72);
    wrapper.add(model);
    scene.add(wrapper);
    const mixer = new THREE.AnimationMixer(model);
    if (walkClip) {
      const action = mixer.clipAction(walkClip);
      action.play();
      action.time = (index * 0.37) % Math.max(walkClip.duration, 0.1);
    }
    const collider: Collider2D = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    colliders.push(collider);
    agents.push({
      object: wrapper,
      route,
      routeLength,
      distance: (routeLength * index) / 10,
      speed: 0.85 + (index % 4) * 0.11,
      sample: { x: 0, z: 0, yaw: 0 },
      collider,
      mixer,
      visibilityRange: 88,
    });
  }
  return agents;
}

function updateAgent(agent: RouteAgent, deltaSeconds: number, playerPosition: THREE.Vector3, isVehicle: boolean): void {
  agent.distance = advanceRouteDistance(agent.distance, agent.speed, deltaSeconds, agent.routeLength);
  sampleClosedRoute(agent.route, agent.distance, agent.sample, agent.routeLength);
  agent.object.position.set(agent.sample.x, isVehicle ? 0.09 : 0.18, agent.sample.z);
  agent.object.rotation.y = routeAgentVisualRotation(agent.sample.yaw, isVehicle ? 'vehicle' : 'pedestrian');
  const dx = agent.sample.x - playerPosition.x;
  const dz = agent.sample.z - playerPosition.z;
  const visible = dx * dx + dz * dz < agent.visibilityRange * agent.visibilityRange;
  agent.object.visible = visible;
  if (visible) agent.mixer?.update(deltaSeconds);

  if (agent.collider) {
    updateRouteAgentCollider(
      agent.collider,
      agent.sample,
      agent.sample.yaw,
      isVehicle ? 'vehicle' : 'pedestrian',
    );
  }
}

export async function createCityWorld(
  scene: THREE.Scene,
  onProgress?: (message: string) => void,
): Promise<CityRuntime> {
  const firstCitySceneChild = scene.children.length;
  const colliders: Collider2D[] = [];
  const swingTargets: THREE.Object3D[] = [];
  addGroundAndRoads(scene);
  addStreetlights(scene, colliders);
  addPlaza(scene, colliders);

  const placements = createPlacements();
  const buildingPaths = placements.map((placement) => `${placement.family}/${placement.model}`);
  buildingPaths.push('suburban/tree-large.glb', 'suburban/tree-small.glb');
  onProgress?.('Loading CC0 city buildings…');
  const buildingTemplates = await loadGltfTemplates(buildingPaths);
  addBuildings(scene, buildingTemplates, placements, colliders, swingTargets);
  addPrefabTrees(scene, buildingTemplates, colliders);

  onProgress?.('Loading CC0 city traffic…');
  const carNames = ['sedan.glb', 'sedan-sports.glb', 'suv.glb', 'taxi.glb', 'van.glb', 'delivery.glb', 'ambulance.glb', 'police.glb'];
  const carTemplates = await loadGltfTemplates(carNames.map((name) => `cars/${name}`));
  const vehicles = addVehicles(scene, carTemplates, colliders);

  onProgress?.('Loading animated pedestrians…');
  let pedestrians: RouteAgent[] = [];
  try {
    pedestrians = await addPedestrians(scene, colliders);
  } catch (error) {
    console.warn('Pedestrian asset unavailable; continuing without pedestrians.', error);
  }

  const update = (deltaSeconds: number, playerPosition: THREE.Vector3): void => {
    for (const vehicle of vehicles) updateAgent(vehicle, deltaSeconds, playerPosition, true);
    for (const pedestrian of pedestrians) updateAgent(pedestrian, deltaSeconds, playerPosition, false);
  };

  return {
    colliders,
    swingTargets,
    ropeRaycastTargets: scene.children.slice(firstCitySceneChild),
    update,
    counts: {
      buildings: placements.length,
      vehicles: vehicles.length,
      pedestrians: pedestrians.length,
    },
  };
}
