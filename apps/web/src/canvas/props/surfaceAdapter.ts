import * as THREE from 'three';
import type { Surface, Vec3 } from '@/canvas/surfaces';

type AxisKey = 'x' | 'y' | 'z';

export type SurfaceExtractOptions = {
  /**
   * Pick which parallel plane to treat as the active surface.
   * - 'positive' (default): use the face in the normal direction (e.g., desk top).
   * - 'negative': use the opposing face (e.g., desk underside).
   * - 'center': use the mid-plane between both faces.
   */
  normalSide?: 'positive' | 'negative' | 'center';
};

export type SurfaceDebugInfo = {
  center: THREE.Vector3;
  extents: { u: number; v: number; thickness: number };
  normal: THREE.Vector3;
  uDir: THREE.Vector3;
  vDir: THREE.Vector3;
  localBounds: THREE.Box3;
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
): SurfaceExtractResult {
  const { normalSide = 'positive' } = opts;

  node.updateWorldMatrix(true, true);

  const boundsLocal = computeLocalBounds(node);
  const { sorted, extents } = sortAxesByExtent(boundsLocal);

  if (sorted[2].extent <= 1e-6) {
    throw new Error(`surfaceFromNode: Node "${node.name}" is degenerate (no thickness axis)`);
  }

  const [uAxisKey, vAxisKey, thicknessKey] = sorted;
  const { xDir, yDir, zDir } = getAxisVectors(node.matrixWorld);
  const axisDirs: Record<AxisKey, THREE.Vector3> = { x: xDir, y: yDir, z: zDir };

  const uDir = axisDirs[uAxisKey.axis].clone();
  const vDir = axisDirs[vAxisKey.axis].clone();
  const normalDir = uDir.clone().cross(vDir).normalize();
  const thicknessDir = axisDirs[thicknessKey.axis].clone();

  const alignSign = Math.sign(normalDir.dot(thicknessDir)) || 1;
  if (alignSign < 0) {
    normalDir.multiplyScalar(-1);
  }

  const uLength = extents[uAxisKey.axis];
  const vLength = extents[vAxisKey.axis];
  const thickness = extents[thicknessKey.axis];

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

  const originWorld = localOrigin.clone().applyMatrix4(node.matrixWorld);

  const uAxis = uDir.clone().setLength(uLength);
  const vAxis = vDir.clone().setLength(vLength);

  const centerLocal = new THREE.Vector3(
    boundsLocal.min.x + extents.x / 2,
    boundsLocal.min.y + extents.y / 2,
    boundsLocal.min.z + extents.z / 2,
  );
  const centerWorld = centerLocal.clone().applyMatrix4(node.matrixWorld);

  const surface: Surface = {
    id,
    kind,
    origin: toVec3(originWorld),
    uAxis: toVec3(uAxis),
    vAxis: toVec3(vAxis),
    zLift: 0,
  };

  const debug: SurfaceDebugInfo = {
    center: centerWorld,
    extents: { u: uLength, v: vLength, thickness },
    normal: normalDir,
    uDir,
    vDir,
    localBounds: boundsLocal.clone(),
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

