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

type AnchorAxis = 'min' | 'center' | 'max';

type VectorAnchor = {
  type: 'vector';
  value: [number, number, number];
};

type BoundingBoxAnchor = {
  type: 'bbox';
  align: {
    x: AnchorAxis;
    y: AnchorAxis;
    z: AnchorAxis;
  };
  offset?: [number, number, number];
};

export type AnchorConfig = VectorAnchor | BoundingBoxAnchor;

type Props = {
  url: string;
  registerSurfaces?: SurfaceReg[];
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  anchor?: AnchorConfig;
  onLoaded?: (root: THREE.Object3D, nodes: Record<string, THREE.Object3D>) => void;
  propId?: PropId;
};

function pickAxisValue(bounds: THREE.Box3, axis: 'x' | 'y' | 'z', mode: AnchorAxis) {
  const min = bounds.min[axis];
  const max = bounds.max[axis];
  if (mode === 'min') return min;
  if (mode === 'max') return max;
  return (min + max) / 2;
}

function computeAnchor(scene: THREE.Object3D, config?: AnchorConfig): THREE.Vector3 | null {
  if (!config) return null;

  if (config.type === 'vector') {
    const [x, y, z] = config.value;
    return new THREE.Vector3(x, y, z);
  }

  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  if (bounds.isEmpty()) {
    return new THREE.Vector3(0, 0, 0);
  }

  const anchor = new THREE.Vector3(
    pickAxisValue(bounds, 'x', config.align.x),
    pickAxisValue(bounds, 'y', config.align.y),
    pickAxisValue(bounds, 'z', config.align.z),
  );

  if (config.offset) {
    anchor.add(new THREE.Vector3(config.offset[0], config.offset[1], config.offset[2]));
  }

  return anchor;
}

export default function GLTFProp({
  url,
  registerSurfaces = [],
  position,
  rotation,
  scale,
  anchor,
  onLoaded,
  propId,
}: Props) {
  const { scene } = useGLTF(url);
  const groupRef = React.useRef<THREE.Group>(null);
  const didNotifyLoaded = React.useRef(false);

  const anchorVector = React.useMemo(() => computeAnchor(scene, anchor), [scene, anchor]);
  const anchorTuple = React.useMemo<[number, number, number]>(() => {
    if (!anchorVector) return [0, 0, 0];
    return [anchorVector.x, anchorVector.y, anchorVector.z];
  }, [anchorVector]);
  const negativeAnchorTuple = React.useMemo<[number, number, number]>(
    () => [-anchorTuple[0], -anchorTuple[1], -anchorTuple[2]],
    [anchorTuple],
  );

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
  }, [propId, scene.uuid, position, rotation, scale, anchorTuple]);

  React.useEffect(() => {
    if (!propId) return;
    return () => {
      clearPropBounds(propId);
    };
  }, [propId]);

  const appliedScale = scale ?? 1;

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      <group position={anchorTuple}>
        <group scale={appliedScale}>
          <group position={negativeAnchorTuple}>
            <primitive object={scene} />
          </group>
        </group>
      </group>
    </group>
  );
}

export const preloadGLTF: (url: string) => void = useGLTF.preload;
