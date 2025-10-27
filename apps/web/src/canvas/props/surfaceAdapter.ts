import * as THREE from 'three';
import type { Surface, Vec3 } from '@/canvas/surfaces';
import type { SurfaceShape } from '@/state/surfaceMetaStore';
import { extractPolygonFromNode, DEFAULT_EXTRACTION_PARAMS, type ExtractionParams } from '@/canvas/math/polygonGeometry';

type AxisKey = 'x' | 'y' | 'z';

export type SurfaceExtractOptions = {
  /**
   * Pick which parallel plane to treat as the active surface.
   * - 'positive' (default): use the face in the normal direction (e.g., desk top).
   * - 'negative': use the opposing face (e.g., desk underside).
   * - 'center': use the mid-plane between both faces.
   */
  normalSide?: 'positive' | 'negative' | 'center';
  /**
   * Enable polygon boundary extraction (default: true for desk surfaces).
   * When true, attempts to extract precise polygon shape from geometry.
   * When false or extraction fails, falls back to rect from extents.
   */
  extractPolygon?: boolean;
  /**
   * Parameters for polygon extraction algorithm.
   */
  polygonParams?: Partial<ExtractionParams>;
};

export type PropTransform = {
  position?: [number, number, number];
  rotation?: [number, number, number];
  anchor?: THREE.Vector3;
};

export type SurfaceDebugInfo = {
  center: THREE.Vector3;
  extents: { u: number; v: number; thickness: number };
  normal: THREE.Vector3;
  uDir: THREE.Vector3;
  vDir: THREE.Vector3;
  localBounds: THREE.Box3;
  shape: SurfaceShape;
};

export type SurfaceExtractResult = {
  surface: Surface;
  debug: SurfaceDebugInfo;
};

/** Convert a THREE.Vector3 to our [x, y, z] tuple */
function toVec3(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

const AXIS_INDICES: Record<AxisKey, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

function ensureBoundingBox(obj: THREE.Object3D) {
  const mesh = obj as THREE.Mesh<THREE.BufferGeometry>;
  if (mesh.isMesh && mesh.geometry) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  }
}

function computeLocalBounds(node: THREE.Object3D) {
  const box = new THREE.Box3();
  box.makeEmpty();

  // First, check if the node itself is a mesh with geometry
  // This prevents including child meshes (like desk drawers/legs) in surface bounds
  const nodeMesh = node as THREE.Mesh<THREE.BufferGeometry>;
  if (nodeMesh.isMesh && nodeMesh.geometry) {
    const geometry = nodeMesh.geometry;

    // Compute bounds from actual vertex positions for accuracy
    const position = geometry.attributes.position;
    if (position) {
      const vertex = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i);
        box.expandByPoint(vertex);
      }

      if (!box.isEmpty()) {
        console.log(`[surfaceAdapter] Node "${node.name}" bounds from vertices:`, {
          min: box.min.toArray(),
          max: box.max.toArray(),
          size: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z],
          vertexCount: position.count
        });
        return box;
      }
    }

    // Fallback to bounding box if no position attribute
    ensureBoundingBox(nodeMesh);
    if (nodeMesh.geometry.boundingBox) {
      console.log(`[surfaceAdapter] Node "${node.name}" using geometry.boundingBox (no vertices)`);
      return nodeMesh.geometry.boundingBox.clone();
    }
  }

  // Fallback: traverse children if node itself has no mesh geometry
  console.log(`[surfaceAdapter] Node "${node.name}" is not a mesh, traversing children...`);
  const invNodeWorld = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const corner = new THREE.Vector3();

  node.traverse((obj) => {
    ensureBoundingBox(obj);
    const mesh = obj as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh.isMesh || !mesh.geometry.boundingBox) return;

    // Transform mesh-local bounding box corners into node-local space.
    rel.multiplyMatrices(invNodeWorld, mesh.matrixWorld);
    const bb = mesh.geometry.boundingBox;

    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? bb.max.x : bb.min.x,
        i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z,
      );
      corner.applyMatrix4(rel);
      box.expandByPoint(corner);
    }
  });

  if (box.isEmpty()) {
    throw new Error('surfaceFromNode: node has no geometry to derive bounds from');
  }

  console.log(`[surfaceAdapter] Node "${node.name}" bounds from children:`, {
    min: box.min.toArray(),
    max: box.max.toArray(),
    size: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]
  });

  return box;
}

function getAxisVectors(matrixWorld: THREE.Matrix4) {
  const xDir = new THREE.Vector3();
  const yDir = new THREE.Vector3();
  const zDir = new THREE.Vector3();
  matrixWorld.extractBasis(xDir, yDir, zDir);
  return { xDir: xDir.normalize(), yDir: yDir.normalize(), zDir: zDir.normalize() };
}

function sortAxesByExtent(bounds: THREE.Box3) {
  const extents = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  } as Record<AxisKey, number>;

  const sorted = (Object.keys(extents) as AxisKey[])
    .map((axis) => ({ axis, extent: extents[axis] }))
    .sort((a, b) => b.extent - a.extent);

  return { sorted, extents };
}

export function extractSurfaceFromNode(
  node: THREE.Object3D,
  id: Surface['id'],
  kind: Surface['kind'],
  opts: SurfaceExtractOptions = {},
  propScale?: number | [number, number, number],
  propTransform?: PropTransform,
): SurfaceExtractResult {
  const { normalSide = 'positive' } = opts;

  // Parse scale into components
  const scaleX = Array.isArray(propScale) ? propScale[0] : (propScale ?? 1);
  const scaleY = Array.isArray(propScale) ? propScale[1] : (propScale ?? 1);
  const scaleZ = Array.isArray(propScale) ? propScale[2] : (propScale ?? 1);
  const scaleVec = new THREE.Vector3(scaleX, scaleY, scaleZ);

  node.updateWorldMatrix(true, true);

  const boundsLocal = computeLocalBounds(node);
  const { sorted, extents } = sortAxesByExtent(boundsLocal);

  const [uAxisKey, vAxisKey, thicknessKey] = sorted;
  const rawThickness = extents[thicknessKey.axis];
  const THIN_SURFACE_EPS = 1e-5;
  const isThinSurface = rawThickness <= 1e-6;
  const thickness = isThinSurface ? THIN_SURFACE_EPS : rawThickness; // Synthesize a tiny thickness so single-face planes still work.
  const { xDir, yDir, zDir } = getAxisVectors(node.matrixWorld);
  const axisDirs: Record<AxisKey, THREE.Vector3> = { x: xDir, y: yDir, z: zDir };

  const uDir = axisDirs[uAxisKey.axis].clone();
  let vDir = axisDirs[vAxisKey.axis].clone();
  const normalDir = uDir.clone().cross(vDir).normalize();
  const thicknessDir = axisDirs[thicknessKey.axis].clone();

  const alignSign = Math.sign(normalDir.dot(thicknessDir)) || 1;
  if (alignSign < 0) {
    // Flip normal to align with desired thickness direction
    normalDir.multiplyScalar(-1);
    // IMPORTANT: Also flip vDir to maintain right-handed coordinate system
    // (so that uDir × vDir = normalDir remains true)
    vDir.multiplyScalar(-1);
  }

  const uLength = extents[uAxisKey.axis];
  const vLength = extents[vAxisKey.axis];

  const localOrigin = new THREE.Vector3();
  localOrigin.setComponent(AXIS_INDICES[uAxisKey.axis], boundsLocal.min[uAxisKey.axis]);
  localOrigin.setComponent(AXIS_INDICES[vAxisKey.axis], boundsLocal.min[vAxisKey.axis]);

  if (normalSide === 'center') {
    localOrigin.setComponent(
      AXIS_INDICES[thicknessKey.axis],
      (boundsLocal.min[thicknessKey.axis] + boundsLocal.max[thicknessKey.axis]) / 2,
    );
  } else if (normalSide === 'negative') {
    localOrigin.setComponent(AXIS_INDICES[thicknessKey.axis], boundsLocal.min[thicknessKey.axis]);
    if (alignSign > 0) {
      // If the computed normal points toward positive thickness, flip so we target the negative face.
      normalDir.multiplyScalar(-1);
    }
  } else {
    // positive – use the face in the positive normal direction.
    localOrigin.setComponent(AXIS_INDICES[thicknessKey.axis], boundsLocal.max[thicknessKey.axis]);
  }

  // Get positions in GLTF-local space (these stay in GLTF space, not world space!)
  const originWorld = localOrigin.clone().applyMatrix4(node.matrixWorld);
  const centerLocal = new THREE.Vector3(
    boundsLocal.min.x + extents.x / 2,
    boundsLocal.min.y + extents.y / 2,
    boundsLocal.min.z + extents.z / 2,
  );
  const centerWorld = centerLocal.clone().applyMatrix4(node.matrixWorld);

  // Apply uniform scale to dimensions ONLY
  const uniformScale = (scaleX + scaleY + scaleZ) / 3;
  const uAxis = uDir.clone().setLength(uLength * uniformScale);
  const vAxis = vDir.clone().setLength(vLength * uniformScale);

  // NOTE: We do NOT apply propTransform to positions!
  // The positions are in GLTF-local space, and the React component's transform hierarchy
  // (in GLTFProp) will handle positioning/scaling/rotation when rendering.
  // We ONLY scale the surface dimensions (uAxis, vAxis) so they match the visual size.

  const surface: Surface = {
    id,
    kind,
    origin: toVec3(originWorld),
    uAxis: toVec3(uAxis),
    vAxis: toVec3(vAxis),
    zLift: 0,
  };

  // Default shape is the rect from extents; upgrade to polygon when extraction succeeds.
  let shape: SurfaceShape = {
    type: 'rect',
    width: uLength * uniformScale,
    height: vLength * uniformScale,
  };

  // Attempt automatic polygon extraction from geometry.
  if (opts.extractPolygon !== false) {
    const params = { ...DEFAULT_EXTRACTION_PARAMS, ...opts.polygonParams };
    const polygonRings = extractPolygonFromNode(
      node,
      originWorld,
      normalDir,
      uAxis,
      vAxis,
      params
    );

    if (polygonRings && polygonRings.outer.length >= 3) {
      console.log('[surfaceAdapter] polygon extraction succeeded:', {
        outerPoints: polygonRings.outer.length,
        holes: polygonRings.holes.length,
      });
      shape = {
        type: 'polygon',
        points: polygonRings.outer,
      };
    } else {
      console.log('[surfaceAdapter] polygon extraction failed, using rect fallback', {
        outerPoints: polygonRings?.outer.length ?? 0,
      });
    }
  }

  const debug: SurfaceDebugInfo = {
    center: centerWorld,
    extents: { u: uLength * uniformScale, v: vLength * uniformScale, thickness: thickness * uniformScale },
    normal: normalDir,
    uDir,
    vDir,
    localBounds: boundsLocal.clone(),
    shape,
  };

  return { surface, debug };
}

/** Adapt a GLTF node into our Surface and discard debug metadata for legacy call sites. */
export function surfaceFromNode(
  node: THREE.Object3D,
  id: Surface['id'],
  kind: Surface['kind'],
  opts?: SurfaceExtractOptions,
): Surface {
  return extractSurfaceFromNode(node, id, kind, opts).surface;
}

/** World-space point from a node (e.g., socket point anchors) */
export function pointFromNode(node: THREE.Object3D): THREE.Vector3 {
  node.updateWorldMatrix(true, true);
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
}
