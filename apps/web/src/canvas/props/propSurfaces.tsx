// apps/web/src/canvas/props/propSurfaces.tsx
import * as React from 'react';
import * as THREE from 'three';
import { surfaceFromNode } from './surfaceAdapter';
import type { Surface } from '@/canvas/surfaces';
import { getSurface as baseGetSurface } from '@/canvas/surfaces';

const overrides = new Map<Surface['id'], Surface>();

/** Register or replace a surface override (from a prop) */
export function registerSurface(s: Surface) {
  overrides.set(s.id, s);
}
/** Remove an override (prop unloaded) */
export function unregisterSurface(id: Surface['id']) {
  overrides.delete(id);
}
/** Public getter: prefer prop override; fallback to JSON registry */
export function getSurface(id: Surface['id']): Surface {
  return overrides.get(id) ?? baseGetSurface(id);
}

/**
 * Hook: given a node (e.g., from GLTF) register/update a Surface override.
 * Call this inside the component that owns the GLTF node.
 */
export function useRegisterSurface(params: {
  id: Surface['id'];
  kind: Surface['kind'];
  node: THREE.Object3D | null;
  deps?: React.DependencyList; // pass if node’s transform can change over time
}) {
  const { id, kind, node, deps = [] } = params;

  // Register once when node arrives (and on deps changes)
  React.useEffect(() => {
    if (!node) return;
    // Build surface from node and register
    const s = surfaceFromNode(node, id, kind);
    registerSurface(s);
    return () => unregisterSurface(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, id, kind, ...deps]);

  // Optional: if the node moves over time, refresh on animation frames
  // Minimal & cheap: re-register every 2nd frame when node exists
  React.useEffect(() => {
    if (!node) return;
    let raf = 0;
    let tick = 0;
    const loop = () => {
      tick = (tick + 1) & 1;
      if (tick === 0) {
        const s = surfaceFromNode(node, id, kind);
        registerSurface(s);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [node, id, kind]);
}
