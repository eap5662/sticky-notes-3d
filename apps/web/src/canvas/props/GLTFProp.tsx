import * as React from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { extractSurfaceFromNode, type SurfaceExtractOptions } from './surfaceAdapter';
import { registerSurface, unregisterSurface, type Surface } from '@/canvas/surfaces';
import { setSurfaceMeta, clearSurfaceMeta } from '@/state/surfaceMetaStore';
import { setPropBounds, clearPropBounds, type PropId } from '@/state/propBoundsStore';

const toVec3 = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];

type SurfaceReg = {
  id: Surface['id'];
  kind: Surface['kind'];
  nodeName: string;
  options?: SurfaceExtractOptions;
  onExtract?: (info: ReturnType<typeof extractSurfaceFromNode>['debug']) => void;
};

type Props = {
  url: string;
  registerSurfaces?: SurfaceReg[];
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  onLoaded?: (root: THREE.Object3D, nodes: Record<string, THREE.Object3D>) => void;
  propId?: PropId;
};

export default function GLTFProp({
  url,
  registerSurfaces = [],
  position,
  rotation,
  scale,
  onLoaded,
  propId,
}: Props) {
  const { scene } = useGLTF(url);
  const groupRef = React.useRef<THREE.Group>(null);
  const didNotifyLoaded = React.useRef(false);

  const nodes = React.useMemo(() => {
    const map: Record<string, THREE.Object3D> = {};
    scene.traverse((o) => (map[o.name] = o));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.uuid]);

  const transformKey = React.useMemo(() => {
    const posKey = position ? position.join(',') : 'p';
    const rotKey = rotation ? rotation.join(',') : 'r';
    const scaleKey = Array.isArray(scale)
      ? scale.join(',')
      : typeof scale === 'number'
      ? `s:${scale}`
      : 's';
    return `${posKey}|${rotKey}|${scaleKey}`;
  }, [position, rotation, scale]);

  React.useEffect(() => {
    if (!scene) return;

    const group = groupRef.current;
    group?.updateWorldMatrix(true, true);
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

    if (!didNotifyLoaded.current) {
      onLoaded?.(scene, nodes);
      didNotifyLoaded.current = true;
    }

    return () => {
      regs.forEach((id) => {
        unregisterSurface(id);
        clearSurfaceMeta(id);
      });
    };
  }, [scene, nodes, registerSurfaces, url, onLoaded, transformKey]);

  React.useEffect(() => {
    if (!propId) return;
    const group = groupRef.current;
    if (!group) return;

    group.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(group);
    if (bounds.isEmpty()) return;

    setPropBounds(propId, { min: toVec3(bounds.min), max: toVec3(bounds.max) });
  }, [propId, scene.uuid, position, rotation, scale]);

  React.useEffect(() => {
    if (!propId) return;
    return () => {
      clearPropBounds(propId);
    };
  }, [propId]);

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale}>
      <primitive object={scene} />
    </group>
  );
}

export const preloadGLTF: (url: string) => void = useGLTF.preload;
