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
 * IMPORTANT: Polygon points are in world-space meters (from polygon extraction),
 * but we need normalized 0-1 coefficients for the geometry. We scale the geometry
 * by extents during rendering, so vertices should be normalized here.
 */
function createShapeGeometry(meta: SurfaceMeta, shapeInfo: SurfaceShapeInfo | null): THREE.BufferGeometry {
  console.log('[createShapeGeometry] Called with meta.shape:', meta.shape);

  if (!meta.shape || meta.shape.type === 'rect' || !shapeInfo || shapeInfo.type === 'rect') {
    console.log('[createShapeGeometry] Using PlaneGeometry for rect:', meta.extents);
    // Fallback to plane geometry for rect
    return new THREE.PlaneGeometry(meta.extents.u, meta.extents.v);
  }

  if (meta.shape.type === 'polygon' && shapeInfo.type === 'polygon') {
    const rawRing = shapeInfo.rawPoints;
    console.log('[createShapeGeometry] Creating polygon geometry with raw points:', rawRing);

    // Earcut expects polygons without duplicated closing vertex
    const usableCount = rawRing.length > 1 ? rawRing.length - 1 : rawRing.length;
    const flat: number[] = [];
    const positions: number[] = [];
    for (let i = 0; i < usableCount; i += 1) {
      const [u, v] = rawRing[i];
      const localU = u * shapeInfo.uOrientation;
      const localV = v * shapeInfo.vOrientation;
      flat.push(localU, localV);
      positions.push(localU, localV, 0);
    }

    const indices = earcut(flat);
    console.log('[createShapeGeometry] Earcut produced indices:', indices.length, 'triangles:', indices.length / 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    console.log('[createShapeGeometry] Created geometry with', positions.length / 3, 'vertices');
    return geometry;
  }

  console.log('[createShapeGeometry] Fallback to rect (unexpected)');
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
      const world = unprojectFromSurface(meta, nu, nv, 0);
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
    const computedNormal = uDir.clone().cross(vDir);
    const chiralityCheck = normal.dot(computedNormal);
    console.log('[BoundsMarker rotation] Chirality check:', {
      label,
      uDir: meta.uDir,
      vDir: meta.vDir,
      normal: meta.normal,
      computedNormal: [computedNormal.x, computedNormal.y, computedNormal.z],
      dotProduct: chiralityCheck,
      isRightHanded: chiralityCheck > 0.99,
    });

    // PlaneGeometry: X is width (uDir), Y is height (vDir), Z is normal
    const rotMatrix = new THREE.Matrix4();
    rotMatrix.makeBasis(uDir, vDir, normal);

    const euler = new THREE.Euler();
    euler.setFromRotationMatrix(rotMatrix);

    console.log('[BoundsMarker rotation] Euler angles:', {
      label,
      euler: [euler.x, euler.y, euler.z],
      order: euler.order,
    });

    return euler;
  }, [meta.uDir, meta.vDir, meta.normal, label]);

  // Compute transform for the shape mesh
  // For polygons: geometry is in UV space, need to transform to world space
  // For rects: centered plane geometry, position at center
  const shapeTransform = useMemo(() => {
    if (!points || points.length < 4) return null;

    const lift = 0.02; // 2cm lift for visibility
    const normal = new THREE.Vector3(...meta.normal).normalize();

    if (shapeInfo?.type === 'polygon') {
      const origin = new THREE.Vector3(...(meta.origin || meta.center));
      origin.add(normal.clone().multiplyScalar(lift));
      return {
        position: [origin.x, origin.y, origin.z] as [number, number, number],
        rotation,
      };
    }

    const center = new THREE.Vector3(...meta.center);
    center.add(normal.clone().multiplyScalar(lift));

    return {
      position: [center.x, center.y, center.z] as [number, number, number],
      rotation,
    };
  }, [meta.origin, meta.center, meta.normal, points, rotation, shapeInfo]);

  const shapeGeometry = useMemo(() => {
    console.log('[DeskSurfaceBoundsMarkers] Creating geometry for shape:', {
      type: meta.shape?.type,
      points: meta.shape?.type === 'polygon' ? meta.shape.points.length : 'N/A',
      extents: meta.extents,
    });
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
      <mesh position={shapeTransform.position} rotation={shapeTransform.rotation} geometry={shapeGeometry} raycast={() => null}>
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
