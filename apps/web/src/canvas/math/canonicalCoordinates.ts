import type { SurfaceMeta } from '@/state/surfaceMetaStore';
import type { Vec3 } from '@/canvas/surfaces';
import { buildCanonicalSampler, type CanonicalSampler } from '@/canvas/math/canonicalSampler';
import { normalizedUVToProjected, projectPointToSurface, unprojectFromSurface } from '@/canvas/math/surfaceFrame';

const EPS = 1e-6;

export type CanonicalSnapshot = {
  sampleCount: number;
  samples: Array<[number, number]>;
  weights: Float32Array;
};

export type CanonicalEncodeResult = {
  uv: { u: number; v: number };
  lift: number;
  yawRel: number;
  snapshot: CanonicalSnapshot;
};

function computeMeanValueWeights(sampler: CanonicalSampler, u: number, v: number): Float32Array | null {
  const n = sampler.sampleCount;
  if (n === 0) return null;

  const weights = new Float32Array(n);
  const px = u;
  const py = v;

  const dx = new Array(n);
  const dy = new Array(n);
  const dist = new Array(n);

  for (let i = 0; i < n; i++) {
    const [vx, vy] = sampler.samples[i];
    const rx = vx - px;
    const ry = vy - py;
    const d = Math.hypot(rx, ry);
    dx[i] = rx;
    dy[i] = ry;
    dist[i] = d;
    if (d < EPS) {
      const exact = new Float32Array(n);
      exact[i] = 1;
      return exact;
    }
  }

  const tanHalf = new Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dot = dx[i] * dx[j] + dy[i] * dy[j];
    const denom = Math.max(dist[i] * dist[j], EPS);
    const clampDot = Math.min(Math.max(dot / denom, -1), 1);
    const angle = Math.acos(clampDot);
    const half = Math.tan(angle / 2);
    tanHalf[i] = half;
  }

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const weight = (tanHalf[prev] + tanHalf[i]) / Math.max(dist[i], EPS);
    weights[i] = weight;
    sum += weight;
  }

  if (sum < EPS) {
    return null;
  }

  for (let i = 0; i < n; i++) {
    weights[i] /= sum;
  }

  return weights;
}

export function encodeCanonical(
  meta: SurfaceMeta | null,
  point: Vec3,
  yawRel: number,
  options?: { sampler?: CanonicalSampler | null; sampleCount?: number },
): CanonicalEncodeResult | null {
  if (!meta) return null;
  const sampler = options?.sampler ?? buildCanonicalSampler(meta, options?.sampleCount);
  if (!sampler) return null;

  const projection = projectPointToSurface(meta, point);
  if (!projection) return null;

  const { u, v, lift } = projection;
  const weights = computeMeanValueWeights(sampler, u, v);
  if (!weights) return null;

  return {
    uv: { u, v },
    lift,
    yawRel,
    snapshot: {
      sampleCount: sampler.sampleCount,
      samples: sampler.samples.map(([sx, sy]) => [sx, sy]),
      weights,
    },
  };
}

export function decodeCanonical(
  meta: SurfaceMeta | null,
  snapshot: CanonicalSnapshot | null,
  lift: number,
  yawRel: number,
  options?: { sampler?: CanonicalSampler | null },
): { uv: { u: number; v: number }; lift: number; yawRel: number; position: Vec3 | null } | null {
  if (!meta || !snapshot) return null;

  const sampler = options?.sampler ?? buildCanonicalSampler(meta, snapshot.sampleCount);
  if (!sampler || sampler.sampleCount !== snapshot.sampleCount) {
    return null;
  }

  const n = sampler.sampleCount;
  if (snapshot.weights.length !== n) {
    return null;
  }

  let u = 0;
  let v = 0;

  for (let i = 0; i < n; i++) {
    const weight = snapshot.weights[i];
    const [sx, sy] = sampler.samples[i];
    u += weight * sx;
    v += weight * sy;
  }

  const projected = normalizedUVToProjected(meta, u, v);
  const position = unprojectFromSurface(meta, projected.u, projected.v, lift);

  return {
    uv: { u, v },
    lift,
    yawRel,
    position,
  };
}

export function canonicalSnapshotsEqual(a: CanonicalSnapshot | null | undefined, b: CanonicalSnapshot | null | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.sampleCount !== b.sampleCount) return false;
  if (a.samples.length !== b.samples.length) return false;
  if (a.weights.length !== b.weights.length) return false;

  for (let i = 0; i < a.samples.length; i++) {
    if (Math.abs(a.samples[i][0] - b.samples[i][0]) > EPS || Math.abs(a.samples[i][1] - b.samples[i][1]) > EPS) {
      return false;
    }
  }

  for (let i = 0; i < a.weights.length; i++) {
    if (Math.abs(a.weights[i] - b.weights[i]) > EPS) {
      return false;
    }
  }

  return true;
}
