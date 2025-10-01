import { useSyncExternalStore } from 'react';
import { subscribe as subscribeSurfaces, getSurfaceOrNull, type SurfaceId, type Surface } from '@/canvas/surfaces';
import { subscribeSurfaceMeta, getSurfaceMeta, type SurfaceMeta } from '@/state/surfaceMetaStore';

export function useSurface(id: SurfaceId): Surface | null {
  return useSyncExternalStore(
    subscribeSurfaces,
    () => getSurfaceOrNull(id),
    () => getSurfaceOrNull(id)
  );
}

export function useSurfaceMeta(id: SurfaceId): SurfaceMeta | null {
  return useSyncExternalStore(
    subscribeSurfaceMeta,
    () => getSurfaceMeta(id),
    () => getSurfaceMeta(id)
  );
}
