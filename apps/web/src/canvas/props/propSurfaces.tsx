// apps/web/src/canvas/props/propSurfaces.tsx
import * as React from 'react';
import * as THREE from 'three';
import { extractSurfaceFromNode, type SurfaceExtractOptions } from './surfaceAdapter';
import type { Surface } from '@/canvas/surfaces';
import { registerSurface, unregisterSurface } from '@/canvas/surfaces';
import { setSurfaceMeta, clearSurfaceMeta } from '@/state/surfaceMetaStore';

const toVec3 = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];

/**
 * Hook: given a node (e.g., from GLTF) register/update a Surface override.
 * Call this inside the component that owns the GLTF node.
 */
export function useRegisterSurface(params: {
  id: Surface['id'];
  kind: Surface['kind'];
  node: THREE.Object3D | null;
  deps?: React.DependencyList; // pass if node's transform can change over time
  options?: SurfaceExtractOptions;
  onExtract?: (info: ReturnType<typeof extractSurfaceFromNode>['debug']) => void;
}) {
  const { id, kind, node, deps = [], options, onExtract } = params;

  // Register once when node arrives (and on deps changes)
  React.useEffect(() => {
    if (!node) return;
    try {
      const { surface, debug } = extractSurfaceFromNode(node, id, kind, options);
      registerSurface(surface);
      setSurfaceMeta(id, {
        center: toVec3(debug.center),
        normal: toVec3(debug.normal),
        uDir: toVec3(debug.uDir),
        vDir: toVec3(debug.vDir),
        extents: debug.extents,
      });
      onExtract?.(debug);
    } catch (err) {
      console.error(`[useRegisterSurface] failed to derive surface ${id}`, err);
    }
    return () => {
      unregisterSurface(id);
      clearSurfaceMeta(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, id, kind, options, onExtract, ...deps]);

  // Optional: if the node moves over time, refresh on animation frames
  React.useEffect(() => {
    if (!node) return;
    let raf = 0;
    let tick = 0;
    const loop = () => {
      tick = (tick + 1) & 1;
      if (tick === 0) {
        try {
          const { surface, debug } = extractSurfaceFromNode(node, id, kind, options);
          registerSurface(surface);
          setSurfaceMeta(id, {
            center: toVec3(debug.center),
            normal: toVec3(debug.normal),
            uDir: toVec3(debug.uDir),
            vDir: toVec3(debug.vDir),
            extents: debug.extents,
          });
          onExtract?.(debug);
        } catch (err) {
          console.error(`[useRegisterSurface] failed to refresh surface ${id}`, err);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [node, id, kind, options, onExtract]);
}
