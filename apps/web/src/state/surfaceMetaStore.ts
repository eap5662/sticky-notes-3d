import { SurfaceId } from '@/canvas/surfaces';
import type { Vec3 } from '@/canvas/surfaces';
import type { SurfaceKind } from '@/data/propCatalog';
import { clearCanonicalSampler } from '@/canvas/math/canonicalSampler';

export type RectShape = {
  type: 'rect';
  width: number;
  height: number;
};

export type PolygonShape = {
  type: 'polygon';
  points: Array<[number, number]>;
};

export type SurfaceShape = RectShape | PolygonShape;

export type SurfaceMeta = {
  center: Vec3;
  normal: Vec3;
  uDir: Vec3;
  vDir: Vec3;
  extents: { u: number; v: number; thickness: number };
  kind?: SurfaceKind;
  ownerId?: string;
  baseSurfaceId?: SurfaceId;
  origin?: Vec3;
  uAxis?: Vec3;
  vAxis?: Vec3;
  shape?: SurfaceShape;
  quality?: 'provisional' | 'confirmed';
};

const metaRegistry = new Map<SurfaceId, SurfaceMeta>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function vecEquals(a: Vec3, b: Vec3) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function optionalVecEquals(a: Vec3 | undefined, b: Vec3 | undefined) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return vecEquals(a, b);
}

function shapeEquals(a: SurfaceShape | undefined, b: SurfaceShape | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.type === 'rect' && b.type === 'rect') {
    return a.width === b.width && a.height === b.height;
  }
  if (a.type === 'polygon' && b.type === 'polygon') {
    if (a.points.length !== b.points.length) return false;
    for (let i = 0; i < a.points.length; i++) {
      const [ax, ay] = a.points[i];
      const [bx, by] = b.points[i];
      if (ax !== bx || ay !== by) return false;
    }
    return true;
  }
  return false;
}

function metaEquals(a: SurfaceMeta | undefined, b: SurfaceMeta) {
  if (!a) return false;
  return (
    vecEquals(a.center, b.center) &&
    vecEquals(a.normal, b.normal) &&
    vecEquals(a.uDir, b.uDir) &&
    vecEquals(a.vDir, b.vDir) &&
    a.extents.u === b.extents.u &&
    a.extents.v === b.extents.v &&
    a.extents.thickness === b.extents.thickness &&
    a.kind === b.kind &&
    a.ownerId === b.ownerId &&
    a.baseSurfaceId === b.baseSurfaceId &&
    optionalVecEquals(a.origin, b.origin) &&
    optionalVecEquals(a.uAxis, b.uAxis) &&
    optionalVecEquals(a.vAxis, b.vAxis) &&
    shapeEquals(a.shape, b.shape) &&
    a.quality === b.quality
  );
}

export function setSurfaceMeta(id: SurfaceId, meta: SurfaceMeta) {
  const existing = metaRegistry.get(id);
  const logPrefix = `[surfaceMetaStore:set] ${String(id)} owner=${meta.ownerId ?? 'none'} base=${meta.baseSurfaceId ?? 'none'}`;
  console.info(logPrefix, {
    incomingQuality: meta.quality ?? 'unknown',
    incomingShape: meta.shape?.type ?? 'none',
    existingQuality: existing?.quality ?? 'none',
    existingShape: existing?.shape?.type ?? 'none',
  });
  const shouldReplace =
    !existing ||
    existing.quality !== 'confirmed' ||
    meta.quality === 'confirmed';

  if (!shouldReplace) {
    console.info(`${logPrefix} :: SKIP (existing confirmed, incoming provisional)`);
    return;
  }

  if (existing) {
    clearCanonicalSampler(existing);
  }

  metaRegistry.set(id, meta);
  console.info(`${logPrefix} :: APPLIED`, {
    storedQuality: meta.quality ?? 'unknown',
    storedShape: meta.shape?.type ?? 'none',
  });
  if (!metaEquals(existing, meta)) {
    notify();
  }
}

export function clearSurfaceMeta(id: SurfaceId) {
  const existing = metaRegistry.get(id);
  if (existing) {
    clearCanonicalSampler(existing);
    metaRegistry.delete(id);
    notify();
  }
}

export function getSurfaceMeta(id: SurfaceId): SurfaceMeta | null {
  return metaRegistry.get(id) ?? null;
}

export function subscribeSurfaceMeta(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAllSurfaceMeta(): [SurfaceId, SurfaceMeta][] {
  return Array.from(metaRegistry.entries());
}

export function getSurfacesByKind(kind: SurfaceKind): Array<{ id: SurfaceId; meta: SurfaceMeta }> {
  const results: Array<{ id: SurfaceId; meta: SurfaceMeta }> = [];
  metaRegistry.forEach((meta, id) => {
    if (meta.kind === kind) {
      results.push({ id, meta });
    }
  });
  return results;
}

export function getSurfaceById(id: SurfaceId): SurfaceMeta | null {
  return metaRegistry.get(id) ?? null;
}
