import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

import type { PropCatalogEntry } from '@/data/propCatalog';
import type { Vec3 } from '@/state/genericPropsStore';
import { extractSurfaceFromNode } from '@/canvas/props/surfaceAdapter';
import type { SurfaceMeta } from '@/state/surfaceMetaStore';

type PrefetchSurface = {
  baseSurfaceId: string;
  meta: SurfaceMeta | null;
};

type PrefetchParams = {
  entry: PropCatalogEntry;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

const loader = new GLTFLoader();

type AnchorConfig = PropCatalogEntry['anchor'];

function pickAxisValue(bounds: THREE.Box3, axis: 'x' | 'y' | 'z', mode: 'min' | 'center' | 'max') {
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

  scene.updateWorldMatrix(true, true);
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

export async function prefetchDeskSurfaces({ entry, position, rotation, scale }: PrefetchParams): Promise<PrefetchSurface[]> {
  let gltf;
  try {
    gltf = await loader.loadAsync(entry.url);
  } catch (error) {
    console.warn(`[DeskSurfacePrefetch] Failed to load GLTF for ${entry.id}`, error);
    return [];
  }

  const sceneClone = gltf.scene.clone(true);
  const anchor = computeAnchor(sceneClone, entry.anchor);

  const nodes = new Map<string, THREE.Object3D>();
  sceneClone.traverse((node) => {
    if (node.name) {
      nodes.set(node.name, node);
    }
  });

  const propTransform = {
    position: position as [number, number, number] | undefined,
    rotation: rotation as [number, number, number] | undefined,
    anchor,
  };

  const previewSurfaces: PrefetchSurface[] = [];

  (entry.surfaces ?? []).forEach((surfaceConfig) => {
    const baseSurfaceId = String(surfaceConfig.id).split(':').pop() ?? String(surfaceConfig.id);
    const node = nodes.get(surfaceConfig.nodeName);
    if (!node) {
      console.warn(`[DeskSurfacePrefetch] node "${surfaceConfig.nodeName}" missing in ${entry.id}`);
      previewSurfaces.push({ baseSurfaceId, meta: null });
      return;
    }

    try {
      const { surface, debug } = extractSurfaceFromNode(
        node,
        surfaceConfig.id,
        surfaceConfig.kind,
        surfaceConfig.options,
        scale,
        propTransform,
      );

      previewSurfaces.push({
        baseSurfaceId,
        meta: {
          center: [debug.center.x, debug.center.y, debug.center.z],
          normal: [debug.normal.x, debug.normal.y, debug.normal.z],
          uDir: [debug.uDir.x, debug.uDir.y, debug.uDir.z],
          vDir: [debug.vDir.x, debug.vDir.y, debug.vDir.z],
          extents: debug.extents,
          kind: surfaceConfig.kind,
          origin: surface.origin,
          uAxis: surface.uAxis,
          vAxis: surface.vAxis,
          baseSurfaceId: surfaceConfig.id,
          shape: debug.shape,
          quality: debug.quality,
        },
      });
    } catch (error) {
      console.warn(`[DeskSurfacePrefetch] surface extraction failed for ${surfaceConfig.nodeName}`, error);
      previewSurfaces.push({ baseSurfaceId, meta: null });
    }
  });

  return previewSurfaces;
}
