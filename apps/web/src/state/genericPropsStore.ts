import type { AnchorConfig } from '@/canvas/props/GLTFProp';
import type { SurfaceId } from '@/canvas/surfaces';

export type GenericPropId = string;
export type GenericPropStatus = 'editing' | 'dragging' | 'placed';
export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export type GenericPropBounds = {
  min: Vec3;
  max: Vec3;
};

export type DockOffset = {
  lateral: number;  // offset along desk.right axis (meters)
  depth: number;    // offset along desk.forward axis (meters)
  lift: number;     // offset along desk.up axis (meters)
  yaw: number;      // rotation relative to desk.forward (radians)
};

export type DockState = 'free' | 'attached' | 'floating' | 'pending';

export type SurfaceSnapshot =
  | {
      type: 'rect';
      width: number;
      height: number;
    }
  | {
      type: 'polygon';
      points: Vec2[];
      obb?: {
        center: Vec2;
        right: Vec2;
        up: Vec2;
        extents: Vec2;
      };
    };

export type DockAttachment = {
  deskInstanceId: GenericPropId;
  surfaceId: SurfaceId | string;
  offsetUV: { u: number; v: number };
  lift: number;
  yawRel: number;
  sticky?: boolean;
  surfaceSnapshot?: SurfaceSnapshot;
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
  locked: boolean;
  bounds?: GenericPropBounds;
  docked: boolean;
  dockOffset?: DockOffset;
  dockState: DockState;
  dockAttachment?: DockAttachment;
};

type GenericPropBlueprint = {
  catalogId: string;
  label?: string;
  url: string;
  anchor?: AnchorConfig;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  locked?: boolean;
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

function cloneDockAttachmentInternal(attachment: DockAttachment): DockAttachment {
  return {
    ...attachment,
    offsetUV: { ...attachment.offsetUV },
    surfaceSnapshot: attachment.surfaceSnapshot
      ? attachment.surfaceSnapshot.type === 'rect'
        ? { ...attachment.surfaceSnapshot }
        : {
            ...attachment.surfaceSnapshot,
            points: attachment.surfaceSnapshot.points.map(([x, y]) => [x, y] as [number, number]),
            obb: attachment.surfaceSnapshot.obb
              ? {
                  center: [...attachment.surfaceSnapshot.obb.center] as [number, number],
                  right: [...attachment.surfaceSnapshot.obb.right] as [number, number],
                  up: [...attachment.surfaceSnapshot.obb.up] as [number, number],
                  extents: [...attachment.surfaceSnapshot.obb.extents] as [number, number],
                }
              : undefined,
          }
      : undefined,
  };
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
    scale: blueprint.scale ? cloneVec(blueprint.scale) : cloneVec(DEFAULT_SCALE),
    locked: blueprint.locked ?? false,
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
    scale: normalized.scale,
    status: 'dragging',
    locked: normalized.locked,
    docked: false,
    dockOffset: undefined,
    dockState: 'free',
    dockAttachment: undefined,
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

export function setGenericPropLocked(id: GenericPropId, locked: boolean) {
  updateProp(id, (prop) => {
    if (prop.locked === locked) {
      return prop;
    }
    return { ...prop, locked };
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

export function rotateGenericProp(id: GenericPropId, deltaYDeg: number): Vec3 {
  let newRotation: Vec3 = [0, 0, 0];
  updateProp(id, (prop) => {
    const currentYRad = prop.rotation[1];
    const deltaYRad = degToRad(deltaYDeg);
    const nextYRad = wrapRadians(currentYRad + deltaYRad);
    newRotation = [prop.rotation[0], nextYRad, prop.rotation[2]] as Vec3;
    return { ...prop, rotation: newRotation };
  });
  return newRotation;
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

export function dockPropWithOffset(id: GenericPropId, offset: DockOffset) {
  updateProp(id, (prop) => ({
    ...prop,
    docked: true,
    dockOffset: offset,
    dockState: 'attached',
  }));
}

export function undockProp(id: GenericPropId) {
  updateProp(id, (prop) => ({
    ...prop,
    docked: false,
    dockOffset: undefined,
    dockAttachment: undefined,
    dockState: 'free',
  }));
}

export function setDockOffset(id: GenericPropId, offset: DockOffset) {
  updateProp(id, (prop) => {
    if (!prop.docked) return prop;
    const prev = prop.dockOffset;
    if (
      prev &&
      prev.lateral === offset.lateral &&
      prev.depth === offset.depth &&
      prev.lift === offset.lift &&
      prev.yaw === offset.yaw
    ) {
      return prop;
    }
    return { ...prop, dockOffset: offset };
  });
}

export function dockPropWithAttachment(id: GenericPropId, attachment: DockAttachment) {
  updateProp(id, (prop) => ({
    ...prop,
    docked: true,
    dockOffset: prop.dockOffset,
    dockAttachment: cloneDockAttachmentInternal(attachment),
    dockState: 'attached',
  }));
}

export function floatDockedProp(id: GenericPropId) {
  updateProp(id, (prop) => {
    if (prop.dockState === 'floating' && !prop.docked) {
      return prop;
    }
    return {
      ...prop,
      docked: false,
      dockState: 'floating',
    };
  });
}

export function setDockAttachment(id: GenericPropId, attachment: DockAttachment | undefined) {
  updateProp(id, (prop) => {
    if (prop.dockAttachment === attachment) {
      return prop;
    }
    return {
      ...prop,
      dockAttachment: attachment ? cloneDockAttachmentInternal(attachment) : undefined,
      dockState: attachment ? 'attached' : prop.dockState,
    };
  });
}

export function setDockState(id: GenericPropId, state: DockState) {
  updateProp(id, (prop) => {
    if (prop.dockState === state) {
      return prop;
    }
    return { ...prop, dockState: state };
  });
}

export function deleteGenericProp(id: GenericPropId) {
  const next = propsState.filter((prop) => prop.id !== id);
  if (next.length !== propsState.length) {
    emit(next);
  }
}
