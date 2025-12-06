import type { SurfaceMeta } from '@/state/surfaceMetaStore';
import { getSurfaceShapeInfo } from '@/canvas/math/surfaceFrame';

export type CanonicalSampler = {
  sampleCount: number;
  samples: Array<[number, number]>;
  perimeter: number;
  cumulativeLengths: number[];
};

export const DEFAULT_CANONICAL_SAMPLE_COUNT = 64;
const LENGTH_EPS = 1e-6;

function normalizePoints(meta: SurfaceMeta): Array<[number, number]> | null {
  const shapeInfo = getSurfaceShapeInfo(meta);
  if (!shapeInfo) {
    return null;
  }

  if (shapeInfo.type === 'rect') {
    return [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
  }

  const usable = shapeInfo.normalizedPoints.length > 1
    ? shapeInfo.normalizedPoints.slice(0, shapeInfo.normalizedPoints.length - 1)
    : shapeInfo.normalizedPoints.slice();

  if (usable.length < 3) {
    return null;
  }

  return usable.map(([u, v]) => [u, v]);
}

function ensureClosed(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first[0] - last[0]) < LENGTH_EPS && Math.abs(first[1] - last[1]) < LENGTH_EPS) {
    return points.slice(0, points.length - 1);
  }
  return points.slice();
}

function signedArea(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area * 0.5;
}

function rotateToDeterministicStart(points: Array<[number, number]>): Array<[number, number]> {
  let startIndex = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[startIndex];
    if (ax < bx - LENGTH_EPS || (Math.abs(ax - bx) < LENGTH_EPS && ay < by)) {
      startIndex = i;
    }
  }

  if (startIndex === 0) {
    return points;
  }

  return [...points.slice(startIndex), ...points.slice(0, startIndex)];
}

function computePerimeter(points: Array<[number, number]>): { perimeter: number; cumulative: number[] } {
  let length = 0;
  const cumulative = [0];

  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segment = Math.sqrt(dx * dx + dy * dy);
    length += segment;
    cumulative.push(length);
  }

  return { perimeter: length, cumulative };
}

function sampleAt(points: Array<[number, number]>, cumulative: number[], distance: number): [number, number] {
  const total = cumulative[cumulative.length - 1];
  if (total < LENGTH_EPS) {
    return points[0];
  }

  let target = distance % total;
  if (target < 0) target += total;

  for (let i = 0; i < points.length; i++) {
    const startLen = cumulative[i];
    const endLen = cumulative[i + 1];
    if (target <= endLen || i === points.length - 1) {
      const t = endLen - startLen > LENGTH_EPS ? (target - startLen) / (endLen - startLen) : 0;
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
  }

  return points[points.length - 1];
}

const samplerCache = new WeakMap<SurfaceMeta, CanonicalSampler>();

export function clearCanonicalSampler(meta: SurfaceMeta) {
  samplerCache.delete(meta);
}

export function buildCanonicalSampler(meta: SurfaceMeta, sampleCount = DEFAULT_CANONICAL_SAMPLE_COUNT): CanonicalSampler | null {
  const cached = samplerCache.get(meta);
  if (cached && cached.sampleCount === sampleCount) {
    return cached;
  }

  const normalized = normalizePoints(meta);
  if (!normalized) {
    return null;
  }

  let canonical = ensureClosed(normalized);
  if (canonical.length < 3) {
    return null;
  }

  if (signedArea(canonical) < 0) {
    canonical = canonical.slice().reverse();
  }

  canonical = rotateToDeterministicStart(canonical);

  const { perimeter, cumulative } = computePerimeter(canonical);
  if (perimeter < LENGTH_EPS) {
    return null;
  }

  const samples: Array<[number, number]> = [];
  const spacing = perimeter / sampleCount;

  for (let i = 0; i < sampleCount; i++) {
    const dist = spacing * i;
    samples.push(sampleAt(canonical, cumulative, dist));
  }

  const sampler: CanonicalSampler = {
    sampleCount,
    samples,
    perimeter,
    cumulativeLengths: cumulative,
  };

  samplerCache.set(meta, sampler);
  return sampler;
}
