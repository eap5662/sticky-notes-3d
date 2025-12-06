import { useMemo } from 'react';
import * as THREE from 'three';
import { Line, useGLTF } from '@react-three/drei';
import earcut from 'earcut';

import { useSurfacesByKind } from '@/canvas/hooks/useSurfaces';
import { useGenericProps } from '@/canvas/hooks/useGenericProps';
import type { SurfaceMeta } from '@/state/surfaceMetaStore';
import { PROP_CATALOG } from '@/data/propCatalog';
import type { AnchorConfig } from '@/canvas/props/GLTFProp';
import { getSurfaceShapeInfo, unprojectFromSurface, type SurfaceShapeInfo } from '@/canvas/math/surfaceFrame';

function lerpRange(value: number, range: { min: number; max: number }) {
  const span = range.max - range.min;
  if (Math.abs(span) < 1e-8) {
    return range.min;
  }
  return range.min + value * span;
}

const COLORS = [
  '#ff0000', // Red
  '#00ff00', // Green
  '#0000ff', // Blue
  '#ffff00', // Yellow
];

// Configuration for vertex markers
const SHOW_VERTEX_MARKERS = false; // Toggle to enable/disable vertex visualization
const VERTEX_DECIMATION = 10; // Only show every Nth vertex (1 = all, 10 = every 10th)

/**
 * Create triangulated BufferGeometry from polygon points using earcut.
 * Returns rect geometry if shape is not polygon.
 *
 * Polygon points coming from `SurfaceShapeInfo` are expressed in surface-space
 * coordinates (fractions along the U and V axes). We build geometry in that
 * space and let the mesh transform scale/rotate it into world space.
 */
function createShapeGeometry(meta: SurfaceMeta, shapeInfo: SurfaceShapeInfo | null): THREE.BufferGeometry {
  if (!meta.shape || meta.shape.type === 'rect' || !shapeInfo || shapeInfo.type === 'rect') {
    // Fallback to plane geometry for rect
    return new THREE.PlaneGeometry(meta.extents.u, meta.extents.v);
  }

  if (meta.shape.type === 'polygon' && shapeInfo.type === 'polygon') {
    const normalizedRing = shapeInfo.normalizedPoints;

    const usableCount = normalizedRing.length > 1 ? normalizedRing.length - 1 : normalizedRing.length;
    const flat: number[] = [];
    const positions: number[] = [];
    for (let i = 0; i < usableCount; i += 1) {
      const [u, v] = normalizedRing[i];
      flat.push(u, v);
      positions.push(u, v, 0);
    }

    const indices = earcut(flat);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  return new THREE.PlaneGeometry(meta.extents.u, meta.extents.v);
}

type BoundsMarkerProps = {
  meta: SurfaceMeta;
  color: string;
  label: string;
};

// Helper to compute anchor from config
function computeAnchor(gltf: { scene: THREE.Object3D }, config?: AnchorConfig): THREE.Vector3 {
  if (!config) return new THREE.Vector3(0, 0, 0);
  if (config.type === 'vector') return new THREE.Vector3(...config.value);

  // Compute bbox anchor
  gltf.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  if (bounds.isEmpty()) return new THREE.Vector3(0, 0, 0);

  const pickAxis = (axis: 'x' | 'y' | 'z', mode: 'min' | 'center' | 'max') => {
    const min = bounds.min[axis];
    const max = bounds.max[axis];
    if (mode === 'min') return min;
    if (mode === 'max') return max;
    return (min + max) / 2;
  };

  return new THREE.Vector3(
    pickAxis('x', config.align.x),
    pickAxis('y', config.align.y),
    pickAxis('z', config.align.z),
  );
}

function BoundsMarker({ meta, color, label }: BoundsMarkerProps) {
  const genericProps = useGenericProps();
  const deskProp = useMemo(() => {
    return genericProps.find((p) => p.id === meta.ownerId);
  }, [genericProps, meta.ownerId]);

  // Always call hooks (Rules of Hooks), but use fallback URL if desk not found
  const url = deskProp?.url || '/models/Tan-Desk.glb'; // Fallback to avoid empty string
  const gltf = useGLTF(url);

  const shapeInfo = useMemo(() => getSurfaceShapeInfo(meta), [meta]);

  const points = useMemo(() => {
    if (!deskProp) return null;
    if (!shapeInfo) return null;

    const ring = shapeInfo.normalizedPoints;
    const normal = new THREE.Vector3(...meta.normal).normalize().multiplyScalar(0.02);

    const worldPoints: THREE.Vector3[] = [];
    for (const [nu, nv] of ring) {
      const projU =
        shapeInfo.type === 'polygon' ? lerpRange(nu, shapeInfo.projectedURange) : nu;
      const projV =
        shapeInfo.type === 'polygon' ? lerpRange(nv, shapeInfo.projectedVRange) : nv;
      const world = unprojectFromSurface(meta, projU, projV, 0);
      if (!world) {
        return null;
      }
      const vector = new THREE.Vector3(world[0], world[1], world[2]);
      vector.add(normal);
      worldPoints.push(vector);
    }

    return worldPoints.length > 0 ? worldPoints : null;
  }, [deskProp, meta, shapeInfo]);

  const rotation = useMemo(() => {
    if (!meta.uDir || !meta.vDir || !meta.normal) return new THREE.Euler(0, 0, 0);

    // Use metadata axes directly (already in world space from surfaceAdapter)
    // For rect shapes, we previously computed from corners, but for polygons with 35+ vertices,
    // corners[0], [1], [3] are arbitrary boundary points, not axis-aligned corners!
    const uDir = new THREE.Vector3(...meta.uDir).normalize();
    const vDir = new THREE.Vector3(...meta.vDir).normalize();
    const normal = new THREE.Vector3(...meta.normal).normalize();

    // Verify chirality: normal should equal uDir × vDir
    // PlaneGeometry: X is width (uDir), Y is height (vDir), Z is normal
    const rotMatrix = new THREE.Matrix4();
    rotMatrix.makeBasis(uDir, vDir, normal);

    const euler = new THREE.Euler();
    euler.setFromRotationMatrix(rotMatrix);

    return euler;
  }, [meta.uDir, meta.vDir, meta.normal, label]);

  // Compute transform for the shape mesh
  // For polygons: geometry is in UV space, need to transform to world space
  // For rects: centered plane geometry, position at center
  const shapeTransform = useMemo(() => {
    if (!points || points.length < 4) return null;

    const lift = 0.02; // 2cm lift for visibility
    const normal = new THREE.Vector3(...meta.normal).normalize();

    let scale: [number, number, number];
    let basePosition: THREE.Vector3;

    const uAxisLength =
      meta.uAxis && meta.uAxis.length === 3 ? new THREE.Vector3(...meta.uAxis).length() : Math.abs(meta.extents.u);
    const vAxisLength =
      meta.vAxis && meta.vAxis.length === 3 ? new THREE.Vector3(...meta.vAxis).length() : Math.abs(meta.extents.v);

    if (shapeInfo?.type === 'polygon') {
      const projectedMin = { u: shapeInfo.projectedURange.min, v: shapeInfo.projectedVRange.min };
      const minWorld = unprojectFromSurface(meta, projectedMin.u, projectedMin.v, 0);
      basePosition = minWorld ? new THREE.Vector3(...minWorld) : new THREE.Vector3(...(meta.origin || meta.center));
      scale = [Math.max(uAxisLength, 1e-6), Math.max(vAxisLength, 1e-6), 1];
    } else {
      basePosition = new THREE.Vector3(...meta.center);
      scale = [Math.max(uAxisLength, 1e-6), Math.max(vAxisLength, 1e-6), 1];
    }

    basePosition.add(normal.clone().multiplyScalar(lift));

    return {
      position: [basePosition.x, basePosition.y, basePosition.z] as [number, number, number],
      rotation,
      scale,
    };
  }, [meta.origin, meta.center, meta.normal, points, rotation, shapeInfo, meta.uAxis, meta.vAxis, meta.extents.u, meta.extents.v]);

  const shapeGeometry = useMemo(() => {
    return createShapeGeometry(meta, shapeInfo);
  }, [meta, shapeInfo]);

  if (!points || !shapeTransform) {
    return null;
  }

  return (
    <>
      <Line
        points={points}
        color={color}
        lineWidth={3}
        dashed={false}
        raycast={() => null}
      />
      {/* Add a semi-transparent fill to visualize the surface area, lifted up slightly */}
      <mesh
        position={shapeTransform.position}
        rotation={shapeTransform.rotation}
        scale={shapeTransform.scale}
        geometry={shapeGeometry}
        raycast={() => null}
      >
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Render actual GLTF mesh vertices (optional, can be performance-intensive) */}
      {SHOW_VERTEX_MARKERS && (
        <ActualVertexMarkers ownerId={meta.ownerId} color={color} deskProp={deskProp} />
      )}
    </>
  );
}

type ActualVertexMarkersProps = {
  ownerId?: string;
  color: string;
  deskProp: ReturnType<typeof useGenericProps>[number] | undefined;
};

function ActualVertexMarkers({ ownerId, color, deskProp }: ActualVertexMarkersProps) {
  if (!ownerId || !deskProp) return null;

  const catalogEntry = PROP_CATALOG.find((e) => e.id === deskProp.catalogId);
  if (!catalogEntry?.surfaces?.[0]) return null;

  const surfaceConfig = catalogEntry.surfaces[0];
  const nodeName = surfaceConfig.nodeName;

  const gltf = useGLTF(deskProp.url);

  const vertexPositions = useMemo(() => {
    let targetNode: THREE.Object3D | null = null;

    gltf.scene.traverse((node) => {
      if (node.name === nodeName) {
        targetNode = node;
      }
    });

    if (!targetNode) return null;

    const mesh = targetNode as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh.isMesh || !mesh.geometry) return null;

    const position = mesh.geometry.attributes.position;
    if (!position) return null;

    const worldPositions: THREE.Vector3[] = [];

    // Get desk transform components
    const deskPosition = new THREE.Vector3(...deskProp.position);

    // Apply the desk prop's transform to match GLTFProp rendering
    // NOTE: mesh.matrixWorld is re-computed when desk rotates (transformKey dependency),
    // and already includes the desk's rotation via the parent group hierarchy!
    // We only need to translate by position, NOT rotate again (would cause double-rotation)

    for (let i = 0; i < position.count; i += VERTEX_DECIMATION) {
      const vertex = new THREE.Vector3();
      vertex.fromBufferAttribute(position, i);

      // Transform from mesh-local to world space (rotation already in matrixWorld)
      vertex.applyMatrix4(mesh.matrixWorld);

      // Just translate to world position (rotation already applied)
      vertex.add(deskPosition);

      worldPositions.push(vertex);
    }

    return worldPositions;
  }, [gltf, deskProp, nodeName]);

  if (!vertexPositions) return null;

  return (
    <>
      {vertexPositions.map((pos, i) => (
        <mesh key={`vertex-${ownerId}-${i}`} position={pos.toArray()} raycast={() => null}>
          <sphereGeometry args={[0.02, 8, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </>
  );
}

export default function DeskSurfaceBoundsMarkers() {
  const deskSurfaces = useSurfacesByKind('desk');

  if (deskSurfaces.length === 0) {
    return null;
  }

  return (
    <group name="desk-surface-bounds-markers">
      {deskSurfaces.map((surface, index) => {
        const color = COLORS[index % COLORS.length];
        const label = surface.meta.baseSurfaceId || `desk-${index}`;

        return (
          <BoundsMarker
            key={surface.id}
            meta={surface.meta}
            color={color}
            label={label}
          />
        );
      })}
    </group>
  );
}
