import surfacesJson from "@/data/surfaces.json";

export type SurfaceId = "desk" | "monitor1" | "monitor2";
export type Vec3 = [number, number, number];

export type Surface = {
  id: SurfaceId;
  kind: "desk" | "monitor";
  origin: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
  zLift: number;
  clip?: [number, number, number, number];
};

const baseRegistry = new Map<SurfaceId, Surface>();
const surfacesFile = surfacesJson as { surfaces?: Surface[] };
for (const surface of surfacesFile.surfaces ?? []) {
  baseRegistry.set(surface.id, surface);
}

const overrides = new Map<SurfaceId, Surface>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function registerSurface(surface: Surface) {
  const prev = overrides.get(surface.id);
  overrides.set(surface.id, surface);
  if (!prev || !surfacesEqual(prev, surface)) {
    notify();
  }
}

export function unregisterSurface(id: SurfaceId) {
  if (overrides.delete(id)) {
    notify();
  }
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSurface(id: SurfaceId): Surface {
  const surface = overrides.get(id) ?? baseRegistry.get(id);
  if (!surface) {
    throw new Error(`Surface not found: ${id}`);
  }
  return surface;
}

export function getSurfaceOrNull(id: SurfaceId): Surface | null {
  return overrides.get(id) ?? baseRegistry.get(id) ?? null;
}

export function getAllSurfaces(): Surface[] {
  const ids = new Set<SurfaceId>([
    ...Array.from(baseRegistry.keys()),
    ...Array.from(overrides.keys()),
  ]);
  return Array.from(ids).map((id) => getSurface(id));
}

export function hasSurface(id: SurfaceId) {
  return overrides.has(id) || baseRegistry.has(id);
}

function surfacesEqual(a: Surface, b: Surface) {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    tupleEqual(a.origin, b.origin) &&
    tupleEqual(a.uAxis, b.uAxis) &&
    tupleEqual(a.vAxis, b.vAxis) &&
    a.zLift === b.zLift &&
    tupleEqual(a.clip ?? null, b.clip ?? null)
  );
}

function tupleEqual(
  a: ReadonlyArray<number> | null,
  b: ReadonlyArray<number> | null
) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
