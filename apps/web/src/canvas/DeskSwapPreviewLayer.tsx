import { useEffect, useMemo, useRef, Fragment } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

import type { PropCatalogEntry } from '@/data/propCatalog';
import { PROP_CATALOG } from '@/data/propCatalog';
import { extractSurfaceFromNode } from '@/canvas/props/surfaceAdapter';
import { useGenericProps } from '@/canvas/hooks/useGenericProps';
import type { GenericProp, Vec3 } from '@/state/genericPropsStore';
import type { AnchorConfig } from '@/canvas/props/GLTFProp';
import { useDeskSwapStore, setDeskSwapPreviewSurfaces, type DeskSwapAttachmentPreviewStatus, type DeskSwapPreviewSurface } from '@/state/deskSwapStore';

type GhostGLTFProps = {
  entry: PropCatalogEntry;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

const DEFAULT_ANCHOR: AnchorConfig = { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } };

function toVec3(vec: THREE.Vector3): [number, number, number] {
  return [vec.x, vec.y, vec.z];
}

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

function GhostGLTF({ entry, position, rotation, scale }: GhostGLTFProps) {
  const gltf = useGLTF(entry.url);
  const sceneClone = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  const groupRef = useRef<THREE.Group>(null);
  const surfaceHashRef = useRef<string | null>(null);

  const anchor = useMemo(
    () => computeAnchor(sceneClone, entry.anchor ?? DEFAULT_ANCHOR),
    [sceneClone, entry.anchor],
  );

  const anchorTuple = useMemo<[number, number, number]>(() => {
    if (!anchor) return [0, 0, 0];
    return [anchor.x, anchor.y, anchor.z];
  }, [anchor]);

  const negativeAnchorTuple = useMemo<[number, number, number]>(
    () => [-anchorTuple[0], -anchorTuple[1], -anchorTuple[2]],
    [anchorTuple],
  );

  const propTransform = useMemo(() => ({
    position: position as [number, number, number] | undefined,
    rotation: rotation as [number, number, number] | undefined,
    anchor,
  }), [position, rotation, anchor]);

  useEffect(() => {
    const materials: THREE.Material[] = [];
    sceneClone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;

      const baseMaterial = mesh.material;
      const applyMaterial = (material: THREE.Material) => {
        const ghostMaterial = material.clone();
        if ('transparent' in ghostMaterial) {
          ghostMaterial.transparent = true;
        }
        if ('opacity' in ghostMaterial) {
          ghostMaterial.opacity = 0.35;
        }
        if ('color' in ghostMaterial) {
          (ghostMaterial as THREE.MeshStandardMaterial).color = new THREE.Color(0x4ade80);
        }
        if ('depthWrite' in ghostMaterial) {
          ghostMaterial.depthWrite = false;
        }
        materials.push(ghostMaterial);
        return ghostMaterial;
      };

      if (Array.isArray(baseMaterial)) {
        mesh.material = baseMaterial.map((mat) => applyMaterial(mat)) as THREE.Material[];
      } else if (baseMaterial) {
        mesh.material = applyMaterial(baseMaterial);
      }
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });

    return () => {
      materials.forEach((material) => material.dispose());
    };
  }, [sceneClone]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const surfaces = entry.surfaces ?? [];

    group.updateWorldMatrix(true, true);
    sceneClone.updateWorldMatrix(true, true);

    const nodes = new Map<string, THREE.Object3D>();
    sceneClone.traverse((node) => {
      if (node.name) {
        nodes.set(node.name, node);
      }
    });

    const previewSurfaces: DeskSwapPreviewSurface[] = surfaces.map((surfaceConfig) => {
      const baseSurfaceId = String(surfaceConfig.id).split(':').pop() ?? String(surfaceConfig.id);
      const node = nodes.get(surfaceConfig.nodeName);
      if (!node) {
        console.warn(`[DeskSwapPreview] node "${surfaceConfig.nodeName}" missing in ${entry.id}`);
        return { baseSurfaceId, meta: null };
      }
      try {
        const { surface, debug } = extractSurfaceFromNode(node, surfaceConfig.id, surfaceConfig.kind, surfaceConfig.options, scale, propTransform);
        return {
          baseSurfaceId,
          meta: {
            center: toVec3(debug.center),
            normal: toVec3(debug.normal),
            uDir: toVec3(debug.uDir),
            vDir: toVec3(debug.vDir),
            extents: debug.extents,
            kind: surfaceConfig.kind,
            origin: surface.origin,
            uAxis: surface.uAxis,
            vAxis: surface.vAxis,
            baseSurfaceId: surfaceConfig.id,
            shape: debug.shape,
          },
        };
      } catch (err) {
        console.warn(`[DeskSwapPreview] surface extraction failed for ${surfaceConfig.nodeName}`, err);
        return { baseSurfaceId, meta: null };
      }
    });

    const nextHash = previewSurfaces
      .map((surface) => {
        if (!surface.meta) {
          return `${surface.baseSurfaceId}:missing`;
        }
        const meta = surface.meta;
        const center = meta.center.join(',');
        const origin = meta.origin ? meta.origin.join(',') : '';
        const uAxis = meta.uAxis ? meta.uAxis.join(',') : '';
        const vAxis = meta.vAxis ? meta.vAxis.join(',') : '';
        const shape =
          meta.shape?.type === 'rect'
            ? `rect:${meta.shape.width},${meta.shape.height}`
            : meta.shape?.type === 'polygon'
              ? `poly:${meta.shape.points.length}`
              : 'shape:unknown';
        return [
          surface.baseSurfaceId,
          center,
          origin,
          uAxis,
          vAxis,
          `${meta.extents.u},${meta.extents.v},${meta.extents.thickness}`,
          shape,
        ].join('|');
      })
      .join('||');

    if (surfaceHashRef.current === nextHash) {
      return;
    }
    surfaceHashRef.current = nextHash;
    setDeskSwapPreviewSurfaces(entry.id, previewSurfaces);
  }, [entry, sceneClone, scale, propTransform]);

  const appliedScale = useMemo(() => {
    if (!scale) return [1, 1, 1] as Vec3;
    return [scale[0], scale[1], scale[2]] as Vec3;
  }, [scale]);

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      <group position={anchorTuple}>
        <group scale={appliedScale}>
          <group position={negativeAnchorTuple} raycast={() => null}>
            <primitive object={sceneClone} />
          </group>
        </group>
      </group>
    </group>
  );
}

function computeHighlight(prop: GenericProp) {
  if (!prop.bounds) {
    return {
      center: [prop.position[0], prop.position[1], prop.position[2]] as [number, number, number],
      minorRadius: 0.12,
      majorRadius: 0.18,
    };
  }

  const { min, max } = prop.bounds;
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    min[1] + 0.002,
    (min[2] + max[2]) / 2,
  ];
  const sizeX = Math.max(Math.abs(max[0] - min[0]), 0.001);
  const sizeZ = Math.max(Math.abs(max[2] - min[2]), 0.001);
  const baseRadius = Math.max(sizeX, sizeZ) / 2;
  const majorRadius = baseRadius === 0 ? 0.18 : baseRadius * 1.1;
  const minorRadius = majorRadius * 0.55;
  return { center, minorRadius, majorRadius };
}

const STATUS_COLORS: Record<DeskSwapAttachmentPreviewStatus | 'pending', string> = {
  ok: '#2dd4bf',
  clamped: '#fbbf24',
  failed: '#f87171',
  pending: '#93c5fd',
};

type AttachmentHighlightsProps = {
  props: GenericProp[];
  statusMap: Map<string, DeskSwapAttachmentPreviewStatus>;
  analysisReady: boolean;
};

function AttachmentHighlights({ props, statusMap, analysisReady }: AttachmentHighlightsProps) {
  if (props.length === 0) return null;

  return (
    <Fragment>
      {props.map((prop) => {
        const status = statusMap.get(prop.id) ?? (analysisReady ? 'ok' : 'pending');
        const highlight = computeHighlight(prop);
        const color = STATUS_COLORS[status];

        return (
          <mesh
            key={`swap-preview-${prop.id}`}
            position={highlight.center}
            rotation={[-Math.PI / 2, 0, 0]}
            raycast={() => null}
          >
            <ringGeometry args={[highlight.minorRadius, highlight.majorRadius, 48]} />
            <meshBasicMaterial color={color} transparent opacity={0.45} />
          </mesh>
        );
      })}
    </Fragment>
  );
}

export default function DeskSwapPreviewLayer() {
  const active = useDeskSwapStore((state) => state.active);
  const targetDeskId = useDeskSwapStore((state) => state.targetDeskId);
  const previewEntry = useDeskSwapStore((state) => state.previewEntry);
  const previewAnalysis = useDeskSwapStore((state) => state.previewAnalysis);
  const props = useGenericProps();

  const statusMap = useMemo(() => {
    const map = new Map<string, DeskSwapAttachmentPreviewStatus>();
    (previewAnalysis?.attachments ?? []).forEach((attachment) => {
      map.set(attachment.propId, attachment.status);
    });
    return map;
  }, [previewAnalysis]);

  if (!active || !targetDeskId || !previewEntry) {
    return null;
  }

  const deskProp = props.find((prop) => prop.id === targetDeskId);
  if (!deskProp) {
    return null;
  }

  const oldCatalogEntry = deskProp.catalogId
    ? PROP_CATALOG.find((item) => item.id === deskProp.catalogId)
    : null;
  const oldDefaultScale = oldCatalogEntry?.defaultScale ?? 1;
  const userScaleMultiplier =
    oldDefaultScale > 0 ? deskProp.scale[0] / oldDefaultScale : 1;
  const previewDefaultScale = previewEntry.defaultScale ?? 1;
  const previewScaleValue = previewDefaultScale * userScaleMultiplier;
  const previewScale: Vec3 = [
    previewScaleValue,
    previewScaleValue,
    previewScaleValue,
  ];

  const attachedProps = props.filter((prop) => {
    if (prop.id === targetDeskId) return false;
    if (!prop.docked || prop.dockState !== 'attached') return false;
    if (prop.dockAttachment && prop.dockAttachment.deskInstanceId !== targetDeskId) return false;
    return true;
  });

  return (
    <>
      <GhostGLTF entry={previewEntry} position={deskProp.position} rotation={deskProp.rotation} scale={previewScale} />
      <AttachmentHighlights props={attachedProps} statusMap={statusMap} analysisReady={!!previewAnalysis} />
    </>
  );
}
