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

/**
 * Check if point is inside polygon using winding number algorithm.
 */
function pointInPolygon(u: number, v: number, points: Array<[number, number]>): boolean {
  if (points.length < 3) return false;

  let winding = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];

    if (y1 <= v) {
      if (y2 > v) {
        // Upward crossing
        const cross = (x2 - x1) * (v - y1) - (u - x1) * (y2 - y1);
        if (cross > 0) winding++;
      }
    } else {
      if (y2 <= v) {
        // Downward crossing
        const cross = (x2 - x1) * (v - y1) - (u - x1) * (y2 - y1);
        if (cross < 0) winding--;
      }
    }
  }

  return winding !== 0;
}

/**
 * Find closest point on polygon boundary.
 */
function closestPointOnPolygon(u: number, v: number, points: Array<[number, number]>): { u: number; v: number } {
  let minDist = Infinity;
  let closest = { u, v };

  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 1e-10) {
      // Degenerate segment, check point distance
      const dist = Math.sqrt((u - x1) ** 2 + (v - y1) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closest = { u: x1, v: y1 };
      }
      continue;
    }

    // Project point onto line segment
    const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / lenSq));
    const projU = x1 + t * dx;
    const projV = y1 + t * dy;

    const dist = Math.sqrt((u - projU) ** 2 + (v - projV) ** 2);
    if (dist < minDist) {
      minDist = dist;
      closest = { u: projU, v: projV };
    }
  }

  return closest;
}

const RECT_NORMALIZED_POINTS: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];

type Range = { min: number; max: number };

type RectShapeData = {
  type: 'rect';
  normalizedPoints: Array<[number, number]>;
};

type PolygonShapeData = {
  type: 'polygon';
  rawPoints: Array<[number, number]>;
  projectedURange: Range;
  projectedVRange: Range;
  normalizedPoints: Array<[number, number]>;
};

type SurfaceShapeData = RectShapeData | PolygonShapeData;

function ensureClosed(points: Array<[number, number]>, eps = 1e-6) {
  if (points.length === 0) return points;
  const [fx, fy] = points[0];
  const [lx, ly] = points[points.length - 1];
  if (Math.abs(fx - lx) > eps || Math.abs(fy - ly) > eps) {
    points.push([fx, fy]);
  }
  return points;
}

export function mapProjectedToNormalized(value: number, range: Range) {
  const span = range.max - range.min;
  if (Math.abs(span) < 1e-8) {
    return 0;
  }
  return (value - range.min) / span;
}

export function mapNormalizedToProjected(value: number, range: Range) {
  const span = range.max - range.min;
  if (Math.abs(span) < 1e-8) {
    return range.min;
  }
  return range.min + value * span;
}

const TMP_FRAME_WORLD = new THREE.Vector3();
const TMP_FRAME_U_UNIT = new THREE.Vector3();
const TMP_FRAME_V_UNIT = new THREE.Vector3();

function createPolygonShape(meta: SurfaceMeta): PolygonShapeData | null {
  if (!meta.shape || meta.shape.type !== 'polygon') {
    return null;
  }
  const rawPoints = ensureClosed(meta.shape.points.map(([px, py]) => [px, py]) as Array<[number, number]>);
  if (rawPoints.length < 4) {
    return null;
  }

  const frame = buildFrame(meta);
  if (!frame) {
    return null;
  }

  const uUnit = TMP_FRAME_U_UNIT.copy(frame.uAxis).normalize();
  const vUnit = TMP_FRAME_V_UNIT.copy(frame.vAxis).normalize();
  const origin = frame.origin;

  const projected: Array<[number, number]> = [];

  for (const [ru, rv] of rawPoints) {
    TMP_FRAME_WORLD.copy(origin);
    TMP_FRAME_WORLD.addScaledVector(uUnit, ru);
    TMP_FRAME_WORLD.addScaledVector(vUnit, rv);
    const projection = projectPointToSurface(meta, [TMP_FRAME_WORLD.x, TMP_FRAME_WORLD.y, TMP_FRAME_WORLD.z]);
    if (!projection) {
      return null;
    }
    projected.push([projection.u, projection.v]);
  }

  ensureClosed(projected);

  let projUMin = Number.POSITIVE_INFINITY;
  let projUMax = Number.NEGATIVE_INFINITY;
  let projVMin = Number.POSITIVE_INFINITY;
  let projVMax = Number.NEGATIVE_INFINITY;

  for (const [pu, pv] of projected) {
    if (pu < projUMin) projUMin = pu;
    if (pu > projUMax) projUMax = pu;
    if (pv < projVMin) projVMin = pv;
    if (pv > projVMax) projVMax = pv;
  }

  if (
    !Number.isFinite(projUMin) ||
    !Number.isFinite(projUMax) ||
    !Number.isFinite(projVMin) ||
    !Number.isFinite(projVMax)
  ) {
    return null;
  }

  const uSpan = projUMax - projUMin;
  const vSpan = projVMax - projVMin;
  if (Math.abs(uSpan) < 1e-8 || Math.abs(vSpan) < 1e-8) {
    return null;
  }

  const projectedURange = { min: projUMin, max: projUMax };
  const projectedVRange = { min: projVMin, max: projVMax };

  const normalized = ensureClosed(
    projected.map(([pu, pv]) => [
      mapProjectedToNormalized(pu, projectedURange),
      mapProjectedToNormalized(pv, projectedVRange),
    ]) as Array<[number, number]>
  );

  return {
    type: 'polygon',
    rawPoints,
    projectedURange,
    projectedVRange,
    normalizedPoints: normalized,
  };
}

function getSurfaceShape(meta: SurfaceMeta | null): SurfaceShapeData | null {
  if (!meta || !meta.shape) {
    return null;
  }

  if (meta.shape.type === 'polygon') {
    return createPolygonShape(meta);
  }

  return { type: 'rect', normalizedPoints: RECT_NORMALIZED_POINTS };
}

export type SurfaceShapeInfo = SurfaceShapeData;

export function getSurfaceShapeInfo(meta: SurfaceMeta | null): SurfaceShapeInfo | null {
  return getSurfaceShape(meta);
}

export function projectedUVToNormalized(meta: SurfaceMeta | null, u: number, v: number): { u: number; v: number } {
  const shape = getSurfaceShape(meta);
  if (!shape || shape.type === 'rect') {
    return { u, v };
  }
  return {
    u: mapProjectedToNormalized(u, shape.projectedURange),
    v: mapProjectedToNormalized(v, shape.projectedVRange),
  };
}

export function normalizedUVToProjected(meta: SurfaceMeta | null, u: number, v: number): { u: number; v: number } {
  const shape = getSurfaceShape(meta);
  if (!shape || shape.type === 'rect') {
    return { u, v };
  }
  if (u < -0.5 || u > 1.5 || v < -0.5 || v > 1.5) {
    return { u, v };
  }
  return {
    u: mapNormalizedToProjected(u, shape.projectedURange),
    v: mapNormalizedToProjected(v, shape.projectedVRange),
  };
}

export function clampNormalizedUV(meta: SurfaceMeta | null, uv: { u: number; v: number }): { u: number; v: number } {
  const projected = normalizedUVToProjected(meta, uv.u, uv.v);
  return clampUVToShape(meta, projected.u, projected.v);
}

export function clampUVToShape(meta: SurfaceMeta | null, u: number, v: number): { u: number; v: number } {
  const shape = getSurfaceShape(meta);
  if (!meta || !shape) {
    return { u, v };
  }

  if (shape.type === 'rect') {
    return {
      u: Math.min(1, Math.max(0, u)),
      v: Math.min(1, Math.max(0, v)),
    };
  }

  const normU = mapProjectedToNormalized(u, shape.projectedURange);
  const normV = mapProjectedToNormalized(v, shape.projectedVRange);

  if (pointInPolygon(normU, normV, shape.normalizedPoints)) {
    return { u: Math.min(1, Math.max(0, normU)), v: Math.min(1, Math.max(0, normV)) };
  }

  const clamped = closestPointOnPolygon(normU, normV, shape.normalizedPoints);
  return {
    u: Math.min(1, Math.max(0, clamped.u)),
    v: Math.min(1, Math.max(0, clamped.v)),
  };
}

export function isUVInsideSurface(meta: SurfaceMeta | null, u: number, v: number, tolerance = 1e-4): boolean {
  const shape = getSurfaceShape(meta);
  if (!meta || !shape) {
    return false;
  }

  if (shape.type === 'rect') {
    const insideU = u >= -tolerance && u <= 1 + tolerance;
    const insideV = v >= -tolerance && v <= 1 + tolerance;
    return insideU && insideV;
  }

  const normU = mapProjectedToNormalized(u, shape.projectedURange);
  const normV = mapProjectedToNormalized(v, shape.projectedVRange);

  const outsideNorm =
    normU < -tolerance ||
    normU > 1 + tolerance ||
    normV < -tolerance ||
    normV > 1 + tolerance;
  if (outsideNorm) {
    return false;
  }

  if (pointInPolygon(normU, normV, shape.normalizedPoints)) {
    return true;
  }

  if (tolerance > 0) {
    const closest = closestPointOnPolygon(normU, normV, shape.normalizedPoints);
    const dist = Math.hypot(closest.u - normU, closest.v - normV);
    return dist <= tolerance;
  }

  return false;
}

function polygonCentroid(points: Array<[number, number]>): [number, number] | null {
  const ring = points.slice(0, points.length - 1);
  let areaTwice = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    areaTwice += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }

  if (Math.abs(areaTwice) < 1e-6) {
    const inv = 1 / ring.length;
    const avgX = ring.reduce((sum, [x]) => sum + x, 0) * inv;
    const avgY = ring.reduce((sum, [, y]) => sum + y, 0) * inv;
    return [avgX, avgY];
  }

  return [cx / (3 * areaTwice), cy / (3 * areaTwice)];
}

export function getSurfaceSpawnPoint(
  meta: SurfaceMeta | null,
  clearance = 0
): { position: Vec3; uv: [number, number] } | null {
  const shape = getSurfaceShape(meta);
  if (!meta || !shape) {
    return null;
  }

  let targetU = 0.5;
  let targetV = 0.5;

  if (shape.type === 'polygon') {
    const centroid = polygonCentroid(shape.normalizedPoints);
    if (centroid) {
      targetU = centroid[0];
      targetV = centroid[1];
    }
  }

  const projectedTarget = normalizedUVToProjected(meta, targetU, targetV);
  const clamped = clampUVToShape(meta, projectedTarget.u, projectedTarget.v);
  const { u: rawU, v: rawV } = normalizedUVToProjected(meta, clamped.u, clamped.v);
  const position = unprojectFromSurface(meta, rawU, rawV, clearance);

  if (!position) {
    return null;
  }

  return {
    position,
    uv: [clamped.u, clamped.v],
  };
}

export type NormalizedSurfacePlacement = {
  normalizedUV: { u: number; v: number };
  projectedUV: { u: number; v: number };
  lift: number;
};

export function projectPointToNormalized(meta: SurfaceMeta | null, point: Vec3): (NormalizedSurfacePlacement & { inside: boolean }) | null {
  const projection = projectPointToSurface(meta, point);
  if (!projection) {
    return null;
  }

  const projectedUV = { u: projection.u, v: projection.v };
  const normalizedUV = projectedUVToNormalized(meta, projection.u, projection.v);
  const inside = isUVInsideSurface(meta, projection.u, projection.v);

  return {
    normalizedUV,
    projectedUV,
    lift: projection.lift,
    inside,
  };
}
