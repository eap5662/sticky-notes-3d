import { SurfaceId } from '@/canvas/surfaces';
import type { Vec3 } from '@/canvas/surfaces';

export type SurfaceMeta = {
  center: Vec3;
  normal: Vec3;
  uDir: Vec3;
  vDir: Vec3;
  extents: { u: number; v: number; thickness: number };
};

const metaRegistry = new Map<SurfaceId, SurfaceMeta>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function vecEquals(a: Vec3, b: Vec3) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
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
    a.extents.thickness === b.extents.thickness
  );
}

export function setSurfaceMeta(id: SurfaceId, meta: SurfaceMeta) {
  const existing = metaRegistry.get(id);
  metaRegistry.set(id, meta);
  if (!metaEquals(existing, meta)) {
    notify();
  }
}

export function clearSurfaceMeta(id: SurfaceId) {
  if (metaRegistry.delete(id)) {
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
