import { useSyncExternalStore, useMemo } from 'react';
import { subscribe as subscribeSurfaces, getSurfaceOrNull, type SurfaceId, type Surface } from '@/canvas/surfaces';
import { subscribeSurfaceMeta, getSurfaceMeta, getSurfacesByKind, type SurfaceMeta } from '@/state/surfaceMetaStore';
import type { SurfaceKind } from '@/data/propCatalog';

export function useSurface(id: SurfaceId | ''): Surface | null {
  return useSyncExternalStore(
    subscribeSurfaces,
    () => (id ? getSurfaceOrNull(id) : null),
    () => (id ? getSurfaceOrNull(id) : null)
  );
}

export function useSurfaceMeta(id: SurfaceId | ''): SurfaceMeta | null {
  return useSyncExternalStore(
    subscribeSurfaceMeta,
    () => (id ? getSurfaceMeta(id) : null),
    () => (id ? getSurfaceMeta(id) : null)
  );
}

// Cache for server snapshot (must be stable across renders)
const serverSnapshotCache = new Map<SurfaceKind, Array<{ id: SurfaceId; meta: SurfaceMeta }>>();

export function useSurfacesByKind(kind: SurfaceKind): Array<{ id: SurfaceId; meta: SurfaceMeta }> {
  // Memoize the snapshot getter to return stable references when content hasn't changed
  const getSnapshot = useMemo(() => {
    let lastSnapshot: Array<{ id: SurfaceId; meta: SurfaceMeta }> | null = null;
    let lastSerializedSnapshot: string | null = null;

    return () => {
      const current = getSurfacesByKind(kind);
      const serialized = JSON.stringify(current);

      if (serialized === lastSerializedSnapshot && lastSnapshot) {
        return lastSnapshot;
      }

      lastSnapshot = current;
      lastSerializedSnapshot = serialized;
      return current;
    };
  }, [kind]);

  const getServerSnapshot = useMemo(() => {
    return () => {
      if (!serverSnapshotCache.has(kind)) {
        serverSnapshotCache.set(kind, []);
      }
      return serverSnapshotCache.get(kind)!;
    };
  }, [kind]);

  return useSyncExternalStore(
    subscribeSurfaceMeta,
    getSnapshot,
    getServerSnapshot
  );
}
