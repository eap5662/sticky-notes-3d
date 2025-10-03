import type { AnchorConfig } from '@/canvas/props/GLTFProp';

export type GenericPropId = string;
export type GenericPropStatus = 'editing' | 'dragging' | 'placed';
export type Vec3 = [number, number, number];

export type GenericPropBounds = {
  min: Vec3;
  max: Vec3;
};

export type GenericProp = {
  id: GenericPropId;
  kind: 'generic';
  catalogId?: string;
  label?: string;
  url: string;
  anchor?: AnchorConfig;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  status: GenericPropStatus;
  bounds?: GenericPropBounds;
};

type GenericPropBlueprint = {
  catalogId: string;
  label?: string;
  url: string;
  anchor?: AnchorConfig;
  position?: Vec3;
  rotation?: Vec3;
};

type Subscriber = () => void;

const listeners = new Set<Subscriber>();
const STAGING_POSITION: Vec3 = [0.6, 0.05, -0.2];
const DEFAULT_ROTATION: Vec3 = [0, 0, 0];
const DEFAULT_SCALE: Vec3 = [1, 1, 1];

let propsState: GenericProp[] = [];
let idCounter = 1;

function cloneVec(vec: Vec3): Vec3 {
  return [vec[0], vec[1], vec[2]];
}

function emit(next: GenericProp[]) {
  propsState = next;
  listeners.forEach((listener) => listener());
}

function nextId(catalogId: string) {
  const suffix = idCounter++;
  return `generic-${catalogId}-${suffix}`;
}

function updateProp(id: GenericPropId, updater: (current: GenericProp) => GenericProp) {
  let changed = false;
  const next = propsState.map((prop) => {
    if (prop.id !== id) return prop;
    const updated = updater(prop);
    if (updated !== prop) {
      changed = true;
    }
    return updated;
  });

  if (changed) {
    emit(next);
  }
}

function normalizeBlueprint(blueprint: GenericPropBlueprint) {
  return {
    catalogId: blueprint.catalogId,
    label: blueprint.label,
    url: blueprint.url,
    anchor: blueprint.anchor,
    position: blueprint.position ? cloneVec(blueprint.position) : cloneVec(STAGING_POSITION),
    rotation: blueprint.rotation ? cloneVec(blueprint.rotation) : cloneVec(DEFAULT_ROTATION),
  };
}

function normalizeUniformScale(raw: number) {
  const normalized = Number(raw.toFixed(4));
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 1;
  }
  return normalized;
}

export function spawnGenericProp(blueprint: GenericPropBlueprint): GenericProp {
  const normalized = normalizeBlueprint(blueprint);
  const id = nextId(normalized.catalogId);

  const newProp: GenericProp = {
    id,
    kind: 'generic',
    catalogId: normalized.catalogId,
    label: normalized.label,
    url: normalized.url,
    anchor: normalized.anchor,
    position: normalized.position,
    rotation: normalized.rotation,
    scale: cloneVec(DEFAULT_SCALE),
    status: 'editing',
  };

  emit([...propsState, newProp]);
  return newProp;
}

export function setGenericPropStatus(id: GenericPropId, status: GenericPropStatus) {
  updateProp(id, (prop) => {
    if (prop.status === status) {
      return prop;
    }
    return { ...prop, status };
  });
}

export function setGenericPropUniformScale(id: GenericPropId, uniformScale: number) {
  const normalized = normalizeUniformScale(uniformScale);
  const nextScale: Vec3 = [normalized, normalized, normalized];

  updateProp(id, (prop) => {
    const [sx, sy, sz] = prop.scale;
    if (sx === nextScale[0] && sy === nextScale[1] && sz === nextScale[2]) {
      return prop;
    }
    return { ...prop, scale: nextScale };
  });
}

export function setGenericPropBounds(id: GenericPropId, bounds: GenericPropBounds) {
  updateProp(id, (prop) => {
    const prev = prop.bounds;
    if (
      prev &&
      prev.min[0] === bounds.min[0] &&
      prev.min[1] === bounds.min[1] &&
      prev.min[2] === bounds.min[2] &&
      prev.max[0] === bounds.max[0] &&
      prev.max[1] === bounds.max[1] &&
      prev.max[2] === bounds.max[2]
    ) {
      return prop;
    }
    return { ...prop, bounds };
  });
}

export function clearGenericPropBounds(id: GenericPropId) {
  updateProp(id, (prop) => {
    if (!prop.bounds) {
      return prop;
    }
    return { ...prop, bounds: undefined };
  });
}

export function setGenericPropPosition(id: GenericPropId, position: Vec3) {
  const nextPosition = cloneVec(position);
  updateProp(id, (prop) => {
    const [px, py, pz] = prop.position;
    if (px === nextPosition[0] && py === nextPosition[1] && pz === nextPosition[2]) {
      return prop;
    }
    return { ...prop, position: nextPosition };
  });
}

export function setGenericPropRotation(id: GenericPropId, rotation: Vec3) {
  const nextRotation = cloneVec(rotation);
  updateProp(id, (prop) => {
    const [rx, ry, rz] = prop.rotation;
    if (rx === nextRotation[0] && ry === nextRotation[1] && rz === nextRotation[2]) {
      return prop;
    }
    return { ...prop, rotation: nextRotation };
  });
}

function wrapRadians(value: number) {
  const wrapped = ((value + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return Math.abs(wrapped) < 1e-6 ? 0 : Number(wrapped.toFixed(6));
}

function radToDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function rotateGenericProp(id: GenericPropId, deltaYDeg: number) {
  updateProp(id, (prop) => {
    const currentYRad = prop.rotation[1];
    const deltaYRad = degToRad(deltaYDeg);
    const nextYRad = wrapRadians(currentYRad + deltaYRad);
    return { ...prop, rotation: [prop.rotation[0], nextYRad, prop.rotation[2]] };
  });
}

export function getGenericPropRotationDeg(id: GenericPropId): number {
  const prop = getGenericProp(id);
  if (!prop) return 0;
  return Number(radToDeg(prop.rotation[1]).toFixed(1));
}

export function getGenericPropsSnapshot(): GenericProp[] {
  return propsState;
}

export function getGenericProp(id: GenericPropId): GenericProp | undefined {
  return propsState.find((prop) => prop.id === id);
}

export function subscribeGenericProps(listener: Subscriber) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearGenericProps() {
  if (propsState.length === 0) {
    return;
  }
  emit([]);
}
