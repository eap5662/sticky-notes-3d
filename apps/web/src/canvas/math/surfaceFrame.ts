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

type RectShapeData = {
  type: 'rect';
  normalizedPoints: Array<[number, number]>;
};

type Range = { min: number; max: number };
type Orientation = 1 | -1;

type PolygonShapeData = {
  type: 'polygon';
  rawPoints: Array<[number, number]>;
  normalizedPoints: Array<[number, number]>;
  uRange: Range;
  vRange: Range;
  uOrientation: Orientation;
  vOrientation: Orientation;
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

function createPolygonShape(meta: SurfaceMeta): PolygonShapeData | null {
  if (!meta.shape || meta.shape.type !== 'polygon') {
    return null;
  }

  const rawPoints = ensureClosed(meta.shape.points.map(([px, py]) => [px, py]) as Array<[number, number]>);

  if (rawPoints.length < 4) {
    return null;
  }

  let uMin = Number.POSITIVE_INFINITY;
  let uMax = Number.NEGATIVE_INFINITY;
  let vMin = Number.POSITIVE_INFINITY;
  let vMax = Number.NEGATIVE_INFINITY;

  for (const [u, v] of rawPoints) {
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }

  if (!Number.isFinite(uMin) || !Number.isFinite(uMax) || !Number.isFinite(vMin) || !Number.isFinite(vMax)) {
    return null;
  }

  const uSpan = uMax - uMin;
  const vSpan = vMax - vMin;
  if (Math.abs(uSpan) < 1e-8 || Math.abs(vSpan) < 1e-8) {
    return null;
  }

  const uRange = { min: uMin, max: uMax };
  const vRange = { min: vMin, max: vMax };
  const uOrientation = determineOrientation(uMin, uMax);
  const vOrientation = determineOrientation(vMin, vMax);
  const normalizedPoints = ensureClosed(
    rawPoints.map(([u, v]) => [
      mapFromShapeSpace(u, uRange, uOrientation),
      mapFromShapeSpace(v, vRange, vOrientation),
    ]) as Array<[number, number]>
  );

  return {
    type: 'polygon',
    rawPoints,
    normalizedPoints,
    uRange,
    vRange,
    uOrientation,
    vOrientation,
  };
}

function determineOrientation(minVal: number, maxVal: number): Orientation {
  const distToMin = Math.abs(minVal);
  const distToMax = Math.abs(maxVal);
  // Normalized 0 should map to whichever endpoint is closest to zero.
  return distToMin <= distToMax ? 1 : -1;
}

function mapToShapeSpace(value: number, range: Range, orientation: Orientation) {
  const span = range.max - range.min;
  if (Math.abs(span) < 1e-8) {
    return range.min;
  }
  if (orientation === 1) {
    return range.min + value * span;
  }
  return range.max - value * span;
}

function mapFromShapeSpace(value: number, range: Range, orientation: Orientation) {
  const span = range.max - range.min;
  if (Math.abs(span) < 1e-8) {
    return 0;
  }
  if (orientation === 1) {
    return (value - range.min) / span;
  }
  return (range.max - value) / span;
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

  const uRaw = mapToShapeSpace(u, shape.uRange, shape.uOrientation);
  const vRaw = mapToShapeSpace(v, shape.vRange, shape.vOrientation);

  if (pointInPolygon(uRaw, vRaw, shape.rawPoints)) {
    return { u, v };
  }

  const clamped = closestPointOnPolygon(uRaw, vRaw, shape.rawPoints);
  return {
    u: mapFromShapeSpace(clamped.u, shape.uRange, shape.uOrientation),
    v: mapFromShapeSpace(clamped.v, shape.vRange, shape.vOrientation),
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

  const uRaw = mapToShapeSpace(u, shape.uRange, shape.uOrientation);
  const vRaw = mapToShapeSpace(v, shape.vRange, shape.vOrientation);

  if (pointInPolygon(uRaw, vRaw, shape.rawPoints)) {
    return true;
  }

  if (tolerance > 0) {
    const closest = closestPointOnPolygon(uRaw, vRaw, shape.rawPoints);
    const closestU = mapFromShapeSpace(closest.u, shape.uRange, shape.uOrientation);
    const closestV = mapFromShapeSpace(closest.v, shape.vRange, shape.vOrientation);
    const dist = Math.hypot(closestU - u, closestV - v);
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
    const centroid = polygonCentroid(shape.rawPoints);
    if (centroid) {
      targetU = mapFromShapeSpace(centroid[0], shape.uRange, shape.uOrientation);
      targetV = mapFromShapeSpace(centroid[1], shape.vRange, shape.vOrientation);
    }
  }

  const clamped = clampUVToShape(meta, targetU, targetV);
  const position = unprojectFromSurface(meta, clamped.u, clamped.v, clearance);

  if (!position) {
    return null;
  }

  return {
    position,
    uv: [clamped.u, clamped.v],
  };
}
