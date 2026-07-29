export interface Vector3Value {
  x: number;
  y: number;
  z: number;
}

export interface SwingState {
  position: Vector3Value;
  velocity: Vector3Value;
  grounded: boolean;
  fixedStepRemainder?: number;
}

export interface TetherConstraint {
  anchor: Vector3Value;
  length: number;
}

export interface SwingInput {
  x: number;
  z: number;
  reel: boolean;
}

export interface SwingConfig {
  gravity?: number;
  airAcceleration?: number;
  drag?: number;
  maxSpeed?: number;
  reelSpeed?: number;
  minimumRopeLength?: number;
  bodyOffsetY?: number;
}

export interface SwingStepResult {
  state: SwingState;
  tethers: TetherConstraint[];
}

function keepTetherLengthsFeasible(tethers: TetherConstraint[]): void {
  for (let first = 0; first < tethers.length; first += 1) {
    for (let second = first + 1; second < tethers.length; second += 1) {
      const a = tethers[first];
      const b = tethers[second];
      const anchorDistance = Math.hypot(
        b.anchor.x - a.anchor.x,
        b.anchor.y - a.anchor.y,
        b.anchor.z - a.anchor.z,
      );
      const deficit = anchorDistance - (a.length + b.length);
      if (deficit > 0) {
        a.length += deficit * 0.5;
        b.length += deficit * 0.5;
      }
    }
  }
}

function tetherExcess(state: SwingState, tether: TetherConstraint, bodyOffsetY: number): number {
  return Math.hypot(
    state.position.x - tether.anchor.x,
    state.position.y + bodyOffsetY - tether.anchor.y,
    state.position.z - tether.anchor.z,
  ) - tether.length;
}

function removeOutwardVelocity(state: SwingState, tether: TetherConstraint, bodyOffsetY: number): void {
  const dx = state.position.x - tether.anchor.x;
  const dy = state.position.y + bodyOffsetY - tether.anchor.y;
  const dz = state.position.z - tether.anchor.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-8) return;
  const nx = dx / distance;
  const ny = dy / distance;
  const nz = dz / distance;
  const outwardSpeed = state.velocity.x * nx + state.velocity.y * ny + state.velocity.z * nz;
  if (outwardSpeed > 0) {
    state.velocity.x -= nx * outwardSpeed;
    state.velocity.y -= ny * outwardSpeed;
    state.velocity.z -= nz * outwardSpeed;
  }
}

export function constrainTetherVelocity(
  sourceVelocity: Vector3Value,
  bodyPosition: Vector3Value,
  tethers: readonly TetherConstraint[],
  bodyOffsetY: number,
  tolerance = 1e-5,
): Vector3Value {
  const normals = tethers.flatMap((tether) => {
    const dx = bodyPosition.x - tether.anchor.x;
    const dy = bodyPosition.y + bodyOffsetY - tether.anchor.y;
    const dz = bodyPosition.z - tether.anchor.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < Math.max(1e-8, tether.length - 1e-4)) return [];
    return [{ x: dx / distance, y: dy / distance, z: dz / distance }];
  });
  const dot = (a: Vector3Value, b: Vector3Value): number => a.x * b.x + a.y * b.y + a.z * b.z;
  const projectSingle = (velocity: Vector3Value, normal: Vector3Value): Vector3Value => {
    const outwardSpeed = Math.max(0, dot(velocity, normal));
    return {
      x: velocity.x - normal.x * outwardSpeed,
      y: velocity.y - normal.y * outwardSpeed,
      z: velocity.z - normal.z * outwardSpeed,
    };
  };
  const satisfiesAll = (velocity: Vector3Value): boolean =>
    normals.every((normal) => dot(velocity, normal) <= tolerance);

  if (normals.length === 0 || satisfiesAll(sourceVelocity)) return { ...sourceVelocity };
  if (normals.length === 1) return projectSingle(sourceVelocity, normals[0]);
  if (normals.length === 2) {
    const [first, second] = normals;
    const candidates = [projectSingle(sourceVelocity, first), projectSingle(sourceVelocity, second)]
      .filter(satisfiesAll);
    const normalDot = dot(first, second);
    const orthogonalSecond = {
      x: second.x - normalDot * first.x,
      y: second.y - normalDot * first.y,
      z: second.z - normalDot * first.z,
    };
    const orthogonalLength = Math.hypot(
      orthogonalSecond.x,
      orthogonalSecond.y,
      orthogonalSecond.z,
    );
    if (orthogonalLength > 1e-12) {
      const secondBasis = {
        x: orthogonalSecond.x / orthogonalLength,
        y: orthogonalSecond.y / orthogonalLength,
        z: orthogonalSecond.z / orthogonalLength,
      };
      const firstComponent = dot(sourceVelocity, first);
      const secondComponent = dot(sourceVelocity, secondBasis);
      const bothActive = {
        x: sourceVelocity.x - firstComponent * first.x - secondComponent * secondBasis.x,
        y: sourceVelocity.y - firstComponent * first.y - secondComponent * secondBasis.y,
        z: sourceVelocity.z - firstComponent * first.z - secondComponent * secondBasis.z,
      };
      if (satisfiesAll(bothActive)) candidates.push(bothActive);
    }
    if (candidates.length > 0) {
      return candidates.reduce((closest, candidate) => {
        const closestChange = Math.hypot(
          closest.x - sourceVelocity.x,
          closest.y - sourceVelocity.y,
          closest.z - sourceVelocity.z,
        );
        const candidateChange = Math.hypot(
          candidate.x - sourceVelocity.x,
          candidate.y - sourceVelocity.y,
          candidate.z - sourceVelocity.z,
        );
        return candidateChange < closestChange ? candidate : closest;
      });
    }
  }

  const velocity = { ...sourceVelocity };
  for (let iteration = 0; iteration < 24; iteration += 1) {
    for (const normal of normals) {
      const constrained = projectSingle(velocity, normal);
      velocity.x = constrained.x;
      velocity.y = constrained.y;
      velocity.z = constrained.z;
    }
    if (satisfiesAll(velocity)) break;
  }
  return velocity;
}

function projectOntoDualIntersection(
  state: SwingState,
  tethers: readonly TetherConstraint[],
  bodyOffsetY: number,
): boolean {
  if (tethers.length !== 2) return false;
  const [first, second] = tethers;
  const dx = second.anchor.x - first.anchor.x;
  const dy = second.anchor.y - first.anchor.y;
  const dz = second.anchor.z - first.anchor.z;
  const anchorDistance = Math.hypot(dx, dy, dz);
  if (
    anchorDistance < 1e-8
    || anchorDistance > first.length + second.length + 1e-8
    || anchorDistance < Math.abs(first.length - second.length) - 1e-8
  ) return false;

  const nx = dx / anchorDistance;
  const ny = dy / anchorDistance;
  const nz = dz / anchorDistance;
  const along = (
    anchorDistance * anchorDistance
    + first.length * first.length
    - second.length * second.length
  ) / (2 * anchorDistance);
  const circleX = first.anchor.x + nx * along;
  const circleY = first.anchor.y + ny * along;
  const circleZ = first.anchor.z + nz * along;
  const circleRadius = Math.sqrt(Math.max(0, first.length * first.length - along * along));
  const bodyX = state.position.x;
  const bodyY = state.position.y + bodyOffsetY;
  const bodyZ = state.position.z;
  const fromCircleX = bodyX - circleX;
  const fromCircleY = bodyY - circleY;
  const fromCircleZ = bodyZ - circleZ;
  const axial = fromCircleX * nx + fromCircleY * ny + fromCircleZ * nz;
  let perpendicularX = fromCircleX - axial * nx;
  let perpendicularY = fromCircleY - axial * ny;
  let perpendicularZ = fromCircleZ - axial * nz;
  let perpendicularLength = Math.hypot(perpendicularX, perpendicularY, perpendicularZ);

  if (circleRadius > 1e-8 && perpendicularLength < 1e-8) {
    if (Math.abs(nx) < 0.9) {
      perpendicularX = 0;
      perpendicularY = nz;
      perpendicularZ = -ny;
    } else {
      perpendicularX = -nz;
      perpendicularY = 0;
      perpendicularZ = nx;
    }
    perpendicularLength = Math.hypot(perpendicularX, perpendicularY, perpendicularZ);
  }
  const scale = perpendicularLength > 1e-8 ? circleRadius / perpendicularLength : 0;
  state.position.x = circleX + perpendicularX * scale;
  state.position.y = circleY + perpendicularY * scale - bodyOffsetY;
  state.position.z = circleZ + perpendicularZ * scale;
  return true;
}

export function shouldUseGroundLocomotion(
  state: SwingState,
  tethered: boolean,
  jumpStarted: boolean,
  momentumThreshold = 0.35,
): boolean {
  const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
  return state.grounded && !tethered && !jumpStarted && horizontalSpeed <= momentumThreshold;
}

export function stepSwingPhysics(
  sourceState: SwingState,
  sourceTethers: readonly TetherConstraint[],
  input: SwingInput,
  deltaSeconds: number,
  options: SwingConfig = {},
): SwingStepResult {
  const config = {
    gravity: options.gravity ?? -11.5,
    airAcceleration: options.airAcceleration ?? 7.5,
    drag: options.drag ?? 0.11,
    maxSpeed: options.maxSpeed ?? 28,
    reelSpeed: options.reelSpeed ?? 3,
    minimumRopeLength: options.minimumRopeLength ?? 3.5,
    bodyOffsetY: options.bodyOffsetY ?? 1.1,
  };
  const state: SwingState = {
    position: { ...sourceState.position },
    velocity: { ...sourceState.velocity },
    grounded: sourceState.grounded,
    fixedStepRemainder: sourceState.fixedStepRemainder ?? 0,
  };
  const tethers = sourceTethers.map((tether) => ({ anchor: { ...tether.anchor }, length: tether.length }));
  keepTetherLengthsFeasible(tethers);
  const fixedStep = 1 / 90;
  const totalDelta = Math.max(0, Math.min(deltaSeconds, 0.1));
  const accumulated = (state.fixedStepRemainder ?? 0) + totalDelta;
  const substeps = Math.floor((accumulated + 1e-12) / fixedStep);
  state.fixedStepRemainder = Math.max(0, accumulated - substeps * fixedStep);
  const step = fixedStep;

  for (let substep = 0; substep < substeps; substep += 1) {
    state.velocity.x += input.x * config.airAcceleration * step;
    state.velocity.z += input.z * config.airAcceleration * step;
    state.velocity.y += config.gravity * step;
    const damping = Math.exp(-config.drag * step);
    state.velocity.x *= damping;
    state.velocity.y *= damping;
    state.velocity.z *= damping;
    const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
    if (speed > config.maxSpeed) {
      const scale = config.maxSpeed / speed;
      state.velocity.x *= scale;
      state.velocity.y *= scale;
      state.velocity.z *= scale;
    }
    state.position.x += state.velocity.x * step;
    state.position.y += state.velocity.y * step;
    state.position.z += state.velocity.z * step;

    if (input.reel) {
      for (const tether of tethers) {
        tether.length = Math.max(config.minimumRopeLength, tether.length - config.reelSpeed * step);
      }
    }
    keepTetherLengthsFeasible(tethers);

    const constraintTolerance = 1e-4;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      for (const tether of tethers) {
        const dx = state.position.x - tether.anchor.x;
        const dy = state.position.y + config.bodyOffsetY - tether.anchor.y;
        const dz = state.position.z - tether.anchor.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance <= tether.length || distance < 1e-6) continue;
        const excess = distance - tether.length;
        state.position.x -= (dx / distance) * excess;
        state.position.y -= (dy / distance) * excess;
        state.position.z -= (dz / distance) * excess;
        removeOutwardVelocity(state, tether, config.bodyOffsetY);
      }
      const maximumExcess = tethers.reduce(
        (maximum, tether) => Math.max(maximum, tetherExcess(state, tether, config.bodyOffsetY)),
        0,
      );
      if (maximumExcess <= constraintTolerance) break;
    }
    const remainingExcess = tethers.reduce(
      (maximum, tether) => Math.max(maximum, tetherExcess(state, tether, config.bodyOffsetY)),
      0,
    );
    if (remainingExcess > constraintTolerance) {
      projectOntoDualIntersection(state, tethers, config.bodyOffsetY);
    }
    state.velocity = constrainTetherVelocity(
      state.velocity,
      state.position,
      tethers,
      config.bodyOffsetY,
    );

    if (state.position.y <= 0) {
      state.position.y = 0;
      if (state.velocity.y < 0) state.velocity.y = 0;
      state.grounded = true;
    } else {
      state.grounded = false;
    }
  }

  return { state, tethers };
}
