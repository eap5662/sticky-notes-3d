import { useMemo } from 'react';
import * as THREE from 'three';
import { Line, useGLTF } from '@react-three/drei';

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
  gltf.scene.updateMatrixWorld(true, true);
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
      corners = points2D.map(([u, v]) => new THREE.Vector3(
        origin[0] + uAxis[0] * u + vAxis[0] * v,
        origin[1] + uAxis[1] * u + vAxis[1] * v,
        origin[2] + uAxis[2] * u + vAxis[2] * v,
      ));
      corners.push(corners[0].clone());
    }

    // Apply the desk prop's transform to match GLTFProp rendering
    // NOTE: Surface metadata is re-extracted when desk rotates (transformKey dependency),
    // so rotation is already baked into origin/uAxis/vAxis via node.matrixWorld!
    // We only need to translate by position, NOT rotate again (would cause double-rotation)
    const position = new THREE.Vector3(...deskProp.position);
    corners = corners.map(corner => corner.clone().add(position));

    return corners.length > 0 ? corners : null;
  }, [meta, label, deskProp]);

  const rotation = useMemo(() => {
    if (!points || points.length < 4) return new THREE.Euler(0, 0, 0);

    // Compute rotation from the actual corner points (which are correctly positioned)
    // This ensures the plane rotation matches the outline exactly
    const corner0 = points[0];
    const corner1 = points[1];
    const corner3 = points[3];

    // Compute surface axes from corners
    const uDir = new THREE.Vector3().subVectors(corner1, corner0).normalize();
    const vDir = new THREE.Vector3().subVectors(corner3, corner0).normalize();
    const normal = new THREE.Vector3().crossVectors(uDir, vDir).normalize();

    // PlaneGeometry: X is width (uDir), Y is height (vDir), Z is normal
    const rotMatrix = new THREE.Matrix4();
    rotMatrix.makeBasis(uDir, vDir, normal);

    const euler = new THREE.Euler();
    euler.setFromRotationMatrix(rotMatrix);

    return euler;
  }, [points]);

  // Lift the plane visualization up by 2cm along the normal for better visibility
  const liftedCenter = useMemo(() => {
    if (!deskProp) return null;

    const lift = 0.02; // 2cm
    // Center and normal already include desk rotation (from node.matrixWorld)
    const center = new THREE.Vector3(meta.center[0], meta.center[1], meta.center[2]);
    const normal = new THREE.Vector3(meta.normal[0], meta.normal[1], meta.normal[2]);

    // Just translate to world position (rotation already in metadata)
    const position = new THREE.Vector3(...deskProp.position);
    center.add(position);

    // Lift along normal (which is already rotated)
    center.add(normal.multiplyScalar(lift));

    return [center.x, center.y, center.z] as [number, number, number];
  }, [meta.center, meta.normal, deskProp]);

  if (!points || !liftedCenter) {
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
        position={liftedCenter}
        rotation={rotation}
        raycast={() => null}
      >
        <planeGeometry args={[meta.extents.u, meta.extents.v]} />
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
