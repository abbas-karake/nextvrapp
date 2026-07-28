export interface Point2D {
  x: number;
  z: number;
}

export interface Collider2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoutePoint extends Point2D {}

export interface RouteSample extends Point2D {
  yaw: number;
}

function circleIntersectsBox(point: Point2D, radius: number, box: Collider2D): boolean {
  const closestX = Math.max(box.minX, Math.min(point.x, box.maxX));
  const closestZ = Math.max(box.minZ, Math.min(point.z, box.maxZ));
  const dx = point.x - closestX;
  const dz = point.z - closestZ;
  return dx * dx + dz * dz < radius * radius;
}

function resolveCircleOverlaps(
  position: Point2D,
  radius: number,
  colliders: readonly Collider2D[],
  worldLimit: number,
): Point2D {
  const limit = Math.max(0, worldLimit - radius);
  const result = {
    x: Math.max(-limit, Math.min(position.x, limit)),
    z: Math.max(-limit, Math.min(position.z, limit)),
  };

  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const box of colliders) {
      const closestX = Math.max(box.minX, Math.min(result.x, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(result.z, box.maxZ));
      const dx = result.x - closestX;
      const dz = result.z - closestZ;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= radius * radius) continue;

      if (distanceSquared > 1e-10) {
        const distance = Math.sqrt(distanceSquared);
        const push = radius - distance;
        result.x += (dx / distance) * push;
        result.z += (dz / distance) * push;
      } else {
        const candidates = [
          { axis: 'x' as const, value: box.minX - radius, distance: Math.abs(result.x - (box.minX - radius)) },
          { axis: 'x' as const, value: box.maxX + radius, distance: Math.abs(result.x - (box.maxX + radius)) },
          { axis: 'z' as const, value: box.minZ - radius, distance: Math.abs(result.z - (box.minZ - radius)) },
          { axis: 'z' as const, value: box.maxZ + radius, distance: Math.abs(result.z - (box.maxZ + radius)) },
        ];
        const nearest = candidates.reduce((best, candidate) =>
          candidate.distance < best.distance ? candidate : best,
        );
        result[nearest.axis] = nearest.value;
      }
      result.x = Math.max(-limit, Math.min(result.x, limit));
      result.z = Math.max(-limit, Math.min(result.z, limit));
      changed = true;
    }
    if (!changed) break;
  }
  return result;
}

export function moveCircleWithCollisions(
  position: Point2D,
  movement: Point2D,
  radius: number,
  colliders: readonly Collider2D[],
  worldLimit: number,
): Point2D {
  const limit = Math.max(0, worldLimit - radius);
  const result = { ...position };
  const candidateX = Math.max(-limit, Math.min(position.x + movement.x, limit));
  const movedX = { x: candidateX, z: result.z };
  if (!colliders.some((box) => circleIntersectsBox(movedX, radius, box))) result.x = candidateX;

  const candidateZ = Math.max(-limit, Math.min(position.z + movement.z, limit));
  const movedZ = { x: result.x, z: candidateZ };
  if (!colliders.some((box) => circleIntersectsBox(movedZ, radius, box))) result.z = candidateZ;
  return result;
}

export function moveRigWithTrackedCollision(
  rigPosition: Point2D,
  trackedOffset: Point2D,
  movement: Point2D,
  radius: number,
  colliders: readonly Collider2D[],
  worldLimit: number,
): Point2D {
  const trackedPosition = {
    x: rigPosition.x + trackedOffset.x,
    z: rigPosition.z + trackedOffset.z,
  };
  const depenetrated = resolveCircleOverlaps(trackedPosition, radius, colliders, worldLimit);
  const moved = moveCircleWithCollisions(depenetrated, movement, radius, colliders, worldLimit);
  return {
    x: rigPosition.x + moved.x - trackedPosition.x,
    z: rigPosition.z + moved.z - trackedPosition.z,
  };
}

export async function loadAvailable<Key, Value>(
  keys: readonly Key[],
  load: (key: Key) => Promise<Value>,
  onError?: (key: Key, error: unknown) => void,
): Promise<Map<Key, Value>> {
  const results = await Promise.all(keys.map(async (key) => {
    try {
      return { key, value: await load(key) };
    } catch (error) {
      onError?.(key, error);
      return undefined;
    }
  }));
  const available = new Map<Key, Value>();
  for (const result of results) {
    if (result) available.set(result.key, result.value);
  }
  return available;
}

export function advanceRouteDistance(
  distance: number,
  speed: number,
  deltaSeconds: number,
  routeLength: number,
): number {
  if (routeLength <= 0) return 0;
  return ((distance + speed * deltaSeconds) % routeLength + routeLength) % routeLength;
}

export function getClosedRouteLength(points: readonly RoutePoint[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    total += Math.hypot(next.x - current.x, next.z - current.z);
  }
  return total;
}

export function sampleClosedRoute(
  points: readonly RoutePoint[],
  distance: number,
  target: RouteSample = { x: 0, z: 0, yaw: 0 },
  cachedLength?: number,
): RouteSample {
  if (points.length === 0) {
    target.x = 0;
    target.z = 0;
    target.yaw = 0;
    return target;
  }
  if (points.length === 1) {
    target.x = points[0].x;
    target.z = points[0].z;
    target.yaw = 0;
    return target;
  }

  const length = cachedLength ?? getClosedRouteLength(points);
  let remaining = ((distance % length) + length) % length;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const dx = next.x - current.x;
    const dz = next.z - current.z;
    const segmentLength = Math.hypot(dx, dz);
    if (remaining <= segmentLength || index === points.length - 1) {
      const t = segmentLength > 0 ? remaining / segmentLength : 0;
      target.x = current.x + dx * t;
      target.z = current.z + dz * t;
      target.yaw = Math.atan2(dz, dx);
      return target;
    }
    remaining -= segmentLength;
  }
  target.x = points[0].x;
  target.z = points[0].z;
  target.yaw = 0;
  return target;
}
