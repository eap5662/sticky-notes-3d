
import * as React from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { extractSurfaceFromNode, type SurfaceExtractOptions } from './surfaceAdapter';
import { registerSurface, unregisterSurface } from '@/canvas/surfaces';
import { setSurfaceMeta, clearSurfaceMeta } from '@/state/surfaceMetaStore';
import type { Surface } from '@/canvas/surfaces';

type SurfaceReg = {
  id: Surface['id'];
  kind: Surface['kind'];
  nodeName: string;
  options?: SurfaceExtractOptions;
  onExtract?: (info: ReturnType<typeof extractSurfaceFromNode>['debug']) => void;
};

const toVec3 = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];

type Props = {
  url: string;
  /** Optional: map named nodes to Surface ids/kinds (e.g., desk / monitor1) */
  registerSurfaces?: SurfaceReg[];
  /** Optional transforms on the whole prop */
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  /** Callback with the root + a lookup of child nodes by name */
  onLoaded?: (root: THREE.Object3D, nodes: Record<string, THREE.Object3D>) => void;
};

export default function GLTFProp({ url, registerSurfaces = [], position, rotation, scale, onLoaded }: Props) {
  // Load once; drei caches by URL. The `scene` is a ready-to-insert Object3D tree.
  const { scene } = useGLTF(url);

  // Build a name->node lookup for convenience
  const nodes = React.useMemo(() => {
    const map: Record<string, THREE.Object3D> = {};
    scene.traverse((o) => (map[o.name] = o));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.uuid]); // stable across re-renders

  // Register requested surfaces (desk/monitor planes) from named nodes
  React.useEffect(() => {
    if (!scene) return;
    // Ensure world matrices are up-to-date before sampling
    scene.updateWorldMatrix(true, true);

    const regs = registerSurfaces
      .map(({ id, kind, nodeName, options, onExtract }) => {
        const node = nodes[nodeName];
        if (!node) {
          console.warn(`[GLTFProp] node "${nodeName}" not found in ${url} for surface ${id}`);
          return null;
        }
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
          console.error(`[GLTFProp] failed to derive surface ${id} from node "${nodeName}"`, err);
          return null;
        }
        return id;
      })
      .filter(Boolean) as Surface['id'][];

    onLoaded?.(scene, nodes);

    return () => {
      regs.forEach((id) => {
        unregisterSurface(id);
        clearSurfaceMeta(id);
      });
    };
  }, [scene, nodes, registerSurfaces, url, onLoaded]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Render the GLTF content */}
      <primitive object={scene} />
    </group>
  );
}

// drei needs this for TS; optional preloading utility
export const preloadGLTF: (url: string) => void = useGLTF.preload;

