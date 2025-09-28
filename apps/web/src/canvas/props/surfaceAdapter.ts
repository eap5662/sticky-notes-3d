
import * as THREE from 'three';
import type { Surface, Vec3 } from '@/canvas/surfaces';

/** Convert a THREE.Vector3 to our [x,y,z] tuple */
function toVec3(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

/** Extract world-space basis columns (scaled) and translation from a node */
function extractBasis(m: THREE.Matrix4) {
  const U = new THREE.Vector3().setFromMatrixColumn(m, 0); // world X
  const V = new THREE.Vector3().setFromMatrixColumn(m, 1); // world Y
  const N = new THREE.Vector3().setFromMatrixColumn(m, 2); // world Z (normal)
  const O = new THREE.Vector3().setFromMatrixPosition(m);  // translation
  return { U, V, N, O };
}

/**
 * Adapt a GLTF node into our Surface.
 * Rule: col0=X→U, col1=Y→V, col2=Z→N; units in meters; right-handed.
 * `kind` is metadata ("desk" | "monitor"), used by your code elsewhere.
 */
export function surfaceFromNode(node: THREE.Object3D, id: Surface['id'], kind: Surface['kind']): Surface {
  // Ensure the matrixWorld is current
  node.updateWorldMatrix(true, true);
  const { U, V, O } = extractBasis(node.matrixWorld);
  return {
    id,
    kind,
    origin: toVec3(O),
    uAxis: toVec3(U),   // scaled directions (length encodes width/height in meters)
    vAxis: toVec3(V),
    zLift: 0,
    // clip rectangle optional; omit here
  };
}

/** World-space point from a node (e.g., socket point anchors) */
export function pointFromNode(node: THREE.Object3D): THREE.Vector3 {
  node.updateWorldMatrix(true, true);
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
}
