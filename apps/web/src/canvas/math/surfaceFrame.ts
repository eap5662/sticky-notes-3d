import * as THREE from 'three';

import type { Vec3 } from '@/canvas/surfaces';
import type { SurfaceMeta } from '@/state/surfaceMetaStore';

const TMP_ORIGIN = new THREE.Vector3();
const TMP_POINT = new THREE.Vector3();
const TMP_U = new THREE.Vector3();
const TMP_V = new THREE.Vector3();
const TMP_NORMAL = new THREE.Vector3();
const TMP_PO = new THREE.Vector3();

function buildFrame(meta: SurfaceMeta | null) {
  if (!meta) return null;

  const uAxis = meta.uAxis
    ? TMP_U.fromArray(meta.uAxis)
    : TMP_U.fromArray(meta.uDir).multiplyScalar(meta.extents.u);
  const vAxis = meta.vAxis
    ? TMP_V.fromArray(meta.vAxis)
    : TMP_V.fromArray(meta.vDir).multiplyScalar(meta.extents.v);

  const origin = meta.origin
    ? TMP_ORIGIN.fromArray(meta.origin)
    : TMP_ORIGIN.fromArray(meta.center)
        .sub(TMP_U.clone().multiplyScalar(0.5))
        .sub(TMP_V.clone().multiplyScalar(0.5));

  const normal = TMP_NORMAL.copy(uAxis).cross(vAxis);
  if (normal.lengthSq() < 1e-8) {
    return null;
  }
  normal.normalize();

  return {
    origin: origin.clone(),
    uAxis: uAxis.clone(),
    vAxis: vAxis.clone(),
    normal: normal.clone(),
  };
}

export function projectPointToSurface(meta: SurfaceMeta | null, point: Vec3): { u: number; v: number; lift: number } | null {
  const frame = buildFrame(meta);
  if (!frame) return null;

  const pointVec = TMP_POINT.fromArray(point);
  const PO = TMP_PO.copy(pointVec).sub(frame.origin);

  const uLenSq = frame.uAxis.lengthSq();
  const vLenSq = frame.vAxis.lengthSq();
  if (uLenSq < 1e-8 || vLenSq < 1e-8) {
    return null;
  }

  const u = PO.dot(frame.uAxis) / uLenSq;
  const v = PO.dot(frame.vAxis) / vLenSq;
  const lift = PO.dot(frame.normal);

  return { u, v, lift };
}

export function unprojectFromSurface(meta: SurfaceMeta | null, u: number, v: number, lift: number): Vec3 | null {
  const frame = buildFrame(meta);
  if (!frame) return null;

  const point = frame.origin
    .clone()
    .add(frame.uAxis.clone().multiplyScalar(u))
    .add(frame.vAxis.clone().multiplyScalar(v))
    .add(frame.normal.clone().multiplyScalar(lift));

  return [point.x, point.y, point.z];
}

export function clampUVToShape(meta: SurfaceMeta | null, u: number, v: number): { u: number; v: number } {
  if (!meta || !meta.shape) {
    return { u, v };
  }

  if (meta.shape.type === 'rect') {
    return {
      u: Math.min(1, Math.max(0, u)),
      v: Math.min(1, Math.max(0, v)),
    };
  }

  // Polygon support TBD – fall back to basic clamp
  return {
    u: Math.min(1, Math.max(0, u)),
    v: Math.min(1, Math.max(0, v)),
  };
}
