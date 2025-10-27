import { useMemo } from 'react';
import * as THREE from 'three';
import { Line, useGLTF } from '@react-three/drei';
import earcut from 'earcut';

import { useSurfacesByKind } from '@/canvas/hooks/useSurfaces';
import { useGenericProps } from '@/canvas/hooks/useGenericProps';
import type { SurfaceMeta } from '@/state/surfaceMetaStore';
import { PROP_CATALOG } from '@/data/propCatalog';
import type { AnchorConfig } from '@/canvas/props/GLTFProp';

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
function createShapeGeometry(meta: SurfaceMeta): THREE.BufferGeometry {
  console.log('[createShapeGeometry] Called with meta.shape:', meta.shape);

  if (!meta.shape || meta.shape.type === 'rect') {
    console.log('[createShapeGeometry] Using PlaneGeometry for rect:', meta.extents);
    // Fallback to plane geometry for rect
    return new THREE.PlaneGeometry(meta.extents.u, meta.extents.v);
  }

  if (meta.shape.type === 'polygon') {
    const { points } = meta.shape;
    console.log('[createShapeGeometry] Creating polygon geometry with points:', points);
    console.log('[createShapeGeometry] Extents for normalization:', meta.extents);

    // Normalize points by extents (convert meters to 0-1 coefficients)
    // Points are currently in world-space meters, need to divide by axis lengths
    const normalizedPoints = points.map(([u, v]) => [
      u / meta.extents.u,
      v / meta.extents.v,
    ] as [number, number]);

    console.log('[createShapeGeometry] Sample normalized points:', normalizedPoints.slice(0, 3));

    // Flatten normalized points for earcut
    const vertices: number[] = [];
    for (const [u, v] of normalizedPoints) {
      vertices.push(u, v);
    }

    // Triangulate using earcut
    const indices = earcut(vertices);
    console.log('[createShapeGeometry] Earcut produced indices:', indices.length, 'triangles:', indices.length / 3);

    // Create BufferGeometry
    const geometry = new THREE.BufferGeometry();

    // Convert 2D UV points to 3D positions (in local UV space, normalized 0-1)
    const positions: number[] = [];
    for (const [u, v] of normalizedPoints) {
      positions.push(u, v, 0); // Z=0 in local UV plane
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    console.log('[createShapeGeometry] Created geometry with', positions.length / 3, 'vertices');
    return geometry;
  }

  // Fallback
  console.log('[createShapeGeometry] Fallback to rect');
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

  const points = useMemo(() => {
    if (!deskProp) return null;

    const { origin, uAxis, vAxis, shape } = meta;

    if (!origin || !uAxis || !vAxis || !shape) {
      console.warn(`[BoundsMarker] Missing data for ${label}`, { origin, uAxis, vAxis, shape });
      return null;
    }

    // Build the corner points in GLTF-local space first
    let corners: THREE.Vector3[] = [];

    if (shape.type === 'rect') {
      corners = [
        new THREE.Vector3(origin[0], origin[1], origin[2]),
        new THREE.Vector3(origin[0] + uAxis[0], origin[1] + uAxis[1], origin[2] + uAxis[2]),
        new THREE.Vector3(origin[0] + uAxis[0] + vAxis[0], origin[1] + uAxis[1] + vAxis[1], origin[2] + uAxis[2] + vAxis[2]),
        new THREE.Vector3(origin[0] + vAxis[0], origin[1] + vAxis[1], origin[2] + vAxis[2]),
        new THREE.Vector3(origin[0], origin[1], origin[2]),
      ];
    } else if (shape.type === 'polygon') {
      const { points: points2D } = shape;
      if (!points2D || points2D.length === 0) {
        console.warn(`[BoundsMarker] Empty polygon for ${label}`);
        return null;
      }
      console.log('[BoundsMarker] Polygon points:', {
        points: points2D.slice(0, 3),
        origin,
        uAxis,
        vAxis,
        extents: meta.extents
      });

      // IMPORTANT: Polygon points are in world-space meters from polygon extraction,
      // but uAxis/vAxis are full-length vectors (not unit vectors).
      // We need to normalize the points by dividing by extents to get 0-1 coefficients.
      corners = points2D.map(([u, v]) => {
        const uCoeff = u / meta.extents.u;  // Normalize to 0-1 range
        const vCoeff = v / meta.extents.v;
        return new THREE.Vector3(
          origin[0] + uAxis[0] * uCoeff + vAxis[0] * vCoeff,
          origin[1] + uAxis[1] * uCoeff + vAxis[1] * vCoeff,
          origin[2] + uAxis[2] * uCoeff + vAxis[2] * vCoeff,
        );
      });
      corners.push(corners[0].clone());
    }

    return corners.length > 0 ? corners : null;
  }, [meta, label, deskProp]);

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
    const normal = new THREE.Vector3(...meta.normal);

    if (meta.shape?.type === 'polygon') {
      // Polygon geometry vertices are in UV space: (u, v, 0)
      // We need to position at origin and apply rotation that maps UV axes to world uAxis/vAxis.
      // Origin/uAxis/vAxis are already in world space from surfaceAdapter.
      const origin = new THREE.Vector3(...(meta.origin || meta.center));
      origin.add(normal.clone().multiplyScalar(lift)); // Lift up

      // Use the same rotation as the outline (computed from corners)
      return {
        position: [origin.x, origin.y, origin.z] as [number, number, number],
        rotation,
      };
    } else {
      // Rect: PlaneGeometry is centered at origin, so position at center
      const center = new THREE.Vector3(...meta.center);
      center.add(normal.clone().multiplyScalar(lift));

      return {
        position: [center.x, center.y, center.z] as [number, number, number],
        rotation,
      };
    }
  }, [meta.origin, meta.center, meta.normal, meta.shape, points, rotation]);

  const shapeGeometry = useMemo(() => {
    console.log('[DeskSurfaceBoundsMarkers] Creating geometry for shape:', {
      type: meta.shape?.type,
      points: meta.shape?.type === 'polygon' ? meta.shape.points.length : 'N/A',
      extents: meta.extents,
    });
    return createShapeGeometry(meta);
  }, [meta.shape, meta.extents]);

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
        scale={meta.shape?.type === 'polygon' ? [meta.extents.u, meta.extents.v, 1] : 1}
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
