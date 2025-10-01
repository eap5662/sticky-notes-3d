import * as THREE from 'three';
import type { Surface } from '@/canvas/surfaces';
import { uvToWorld } from '@/canvas/math/plane';

export { uvToWorld }; // re-export so callers have one public entry

export function basisFromSurface(surface: Surface) {
  const U = new THREE.Vector3().fromArray(surface.uAxis);
  const V = new THREE.Vector3().fromArray(surface.vAxis);
  const N = U.clone().cross(V).normalize();
  const O = new THREE.Vector3().fromArray(surface.origin);
  const M = new THREE.Matrix4().makeBasis(U, V, N);
  return new THREE.Matrix4().makeTranslation(O.x, O.y, O.z).multiply(M);
}

export function getBasis(surface: Surface) {
  const M = basisFromSurface(surface);
  const U = new THREE.Vector3().setFromMatrixColumn(M, 0).normalize();
  const V = new THREE.Vector3().setFromMatrixColumn(M, 1).normalize();
  const N = new THREE.Vector3().setFromMatrixColumn(M, 2).normalize();
  return { U, V, N, M };
}
