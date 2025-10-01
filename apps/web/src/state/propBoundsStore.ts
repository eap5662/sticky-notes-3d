import type { Vec3 } from '@/canvas/surfaces';

export type PropId = 'desk' | 'monitor1';

export type PropBounds = {
  min: Vec3;
  max: Vec3;
};

const registry = new Map<PropId, PropBounds>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function vecEquals(a: Vec3, b: Vec3) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function boundsEqual(a: PropBounds | undefined, b: PropBounds) {
  if (!a) return false;
  return vecEquals(a.min, b.min) && vecEquals(a.max, b.max);
}

export function setPropBounds(id: PropId, bounds: PropBounds) {
  const prev = registry.get(id);
  registry.set(id, bounds);
  if (!boundsEqual(prev, bounds)) {
    notify();
  }
}

export function clearPropBounds(id: PropId) {
  if (registry.delete(id)) {
    notify();
  }
}

export function getPropBounds(id: PropId): PropBounds | null {
  return registry.get(id) ?? null;
}

export function getAllPropBounds(): [PropId, PropBounds][] {
  return Array.from(registry.entries());
}

export function subscribePropBounds(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
