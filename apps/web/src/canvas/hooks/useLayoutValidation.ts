import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { createSurfaceId, type SurfaceId } from '@/canvas/surfaces';
import { useSurface, useSurfaceMeta, useSurfacesByKind } from './useSurfaces';
import { usePropBounds } from './usePropBounds';
import type { PropBounds } from '@/state/propBoundsStore';
import { useLayoutFrame } from './useLayoutFrame';

export type LayoutWarning = {
  id: string;
  message: string;
  severity: 'warn' | 'error';
  value?: number;
  surfaceId?: SurfaceId;
};

export type UseLayoutValidationOptions = {
  monitorClearance?: number;
  tolerance?: number;
  monitorFaceToleranceDeg?: number;
  edgeMargin?: number;
  onReport?: (warnings: LayoutWarning[]) => void;
  enabled?: boolean;
};

const toVec3 = (tuple: readonly number[]) => new THREE.Vector3(tuple[0], tuple[1], tuple[2]);

function extremalPoint(bounds: PropBounds, normal: THREE.Vector3, pick: 'min' | 'max') {
  const choose = (axis: number, minVal: number, maxVal: number) => {
    const positive = axis >= 0;
    if (pick === 'min') {
      return positive ? minVal : maxVal;
    }
    return positive ? maxVal : minVal;
  };

  return new THREE.Vector3(
    choose(normal.x, bounds.min[0], bounds.max[0]),
    choose(normal.y, bounds.min[1], bounds.max[1]),
    choose(normal.z, bounds.min[2], bounds.max[2])
  );
}

function spanAlongAxis(bounds: PropBounds, axis: THREE.Vector3) {
  const corners: THREE.Vector3[] = [];
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      for (let z = 0; z <= 1; z++) {
        corners.push(
          new THREE.Vector3(
            x ? bounds.max[0] : bounds.min[0],
            y ? bounds.max[1] : bounds.min[1],
            z ? bounds.max[2] : bounds.min[2]
          )
        );
      }
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const corner of corners) {
    const dot = corner.dot(axis);
    min = Math.min(min, dot);
    max = Math.max(max, dot);
  }
  return { min, max };
}

function projectOntoPlane(vec: THREE.Vector3, normal: THREE.Vector3) {
  const n = normal.clone().normalize();
  return vec.clone().sub(n.multiplyScalar(vec.dot(n)));
}

function signedAngleAroundAxis(from: THREE.Vector3, to: THREE.Vector3, axis: THREE.Vector3) {
  const cross = new THREE.Vector3().crossVectors(from, to);
  const dot = THREE.MathUtils.clamp(from.dot(to), -1, 1);
  return Math.atan2(cross.dot(axis), dot);
}

export function useLayoutValidation(options: UseLayoutValidationOptions = {}) {
  const {
    monitorClearance = 0,
    tolerance = 0.002,
    monitorFaceToleranceDeg = 5,
    edgeMargin = 0.0,
    onReport,
    enabled = true,
  } = options;

  // Query desk by kind (reactively subscribes to surface changes)
  const deskSurfaces = useSurfacesByKind('desk');
  const deskSurfaceId = deskSurfaces[0]?.id;
  const deskSurface = useSurface(deskSurfaceId ?? '');
  const deskMeta = useSurfaceMeta(deskSurfaceId ?? '');

  // TODO: Update this when monitor1 is migrated (Phase 2 of cleanup)
  const monitorSurface = useSurface(createSurfaceId('monitor1'));
  const monitorMeta = useSurfaceMeta(createSurfaceId('monitor1'));
  const monitorBounds = usePropBounds('monitor1');
  const layoutFrame = useLayoutFrame();

  const warnings = useMemo<LayoutWarning[]>(() => {
    if (!enabled) return [];
    const next: LayoutWarning[] = [];

    if (deskSurface && deskMeta) {
      const deskOrigin = toVec3(deskSurface.origin);
      const deskNormal = toVec3(deskMeta.normal).normalize();
      const deskCenter = toVec3(deskMeta.center);
      const halfThickness = deskMeta.extents.thickness / 2;
      const expectedTop = deskCenter.clone().add(deskNormal.clone().multiplyScalar(halfThickness));
      const delta = expectedTop.distanceTo(deskOrigin);
      if (delta > tolerance) {
        next.push({
          id: 'desk-surface-origin-mismatch',
          severity: 'warn',
          surfaceId: deskSurfaceId,
          message: `Desk surface origin differs from GLTF-derived top by ${(delta * 1000).toFixed(1)} mm`,
          value: delta,
        });
      }
    }

    if (deskSurface && monitorSurface && deskMeta && monitorMeta) {
      const deskNormal = toVec3(deskMeta.normal).normalize();
      const deskTop = toVec3(deskSurface.origin);
      const deskTopProjection = deskTop.dot(deskNormal);

      let separation: number | null = null;
      if (monitorBounds) {
        const monitorBottomPoint = extremalPoint(monitorBounds, deskNormal, 'min');
        separation = monitorBottomPoint.dot(deskNormal) - deskTopProjection;
      } else {
        const monitorCenter = toVec3(monitorMeta.center);
        const monitorNormal = toVec3(monitorMeta.normal).normalize();
        const monitorHalfThickness = monitorMeta.extents.thickness / 2;
        const monitorBottom = monitorCenter.clone().sub(monitorNormal.clone().multiplyScalar(monitorHalfThickness));
        separation = monitorBottom.clone().sub(deskTop).dot(deskNormal);
      }

      if (separation !== null && separation < monitorClearance - tolerance) {
        next.push({
          id: 'monitor-below-desk',
          severity: 'error',
          surfaceId: createSurfaceId('monitor1'),
          message: `Monitor base penetrates desk by ${((monitorClearance - separation) * 1000).toFixed(1)} mm`,
          value: separation,
        });
      }
    }

    if (layoutFrame && monitorMeta) {
      const up = toVec3(layoutFrame.up).normalize();
      const forward = toVec3(layoutFrame.forward).normalize();
      const monitorNormal = toVec3(monitorMeta.normal).normalize();

      const projectedMonitor = projectOntoPlane(monitorNormal, up);
      const projectedForward = projectOntoPlane(forward, up);
      if (projectedMonitor.lengthSq() > 1e-6 && projectedForward.lengthSq() > 1e-6) {
        projectedMonitor.normalize();
        projectedForward.normalize();
        const angleRad = Math.abs(signedAngleAroundAxis(projectedMonitor, projectedForward, up));
        const angleDeg = THREE.MathUtils.radToDeg(angleRad);
        if (angleDeg > monitorFaceToleranceDeg) {
          next.push({
            id: 'monitor-face-misalignment',
            severity: 'error',
            surfaceId: createSurfaceId('monitor1'),
            message: `Monitor facing deviates ${angleDeg.toFixed(2)} deg from desk forward (${monitorFaceToleranceDeg} deg max).`,
            value: angleDeg,
          });
        }
      }
    }

    if (layoutFrame && monitorBounds) {
      const right = toVec3(layoutFrame.right).normalize();
      const forward = toVec3(layoutFrame.forward).normalize();
      const deskBounds = layoutFrame.bounds;

      const deskSpanRight = spanAlongAxis(deskBounds, right);
      const monitorSpanRight = spanAlongAxis(monitorBounds, right);
      if (monitorSpanRight.min < deskSpanRight.min - edgeMargin || monitorSpanRight.max > deskSpanRight.max + edgeMargin) {
        const overflow = Math.max(
          deskSpanRight.min - monitorSpanRight.min,
          monitorSpanRight.max - deskSpanRight.max,
        );
        next.push({
          id: 'monitor-lateral-overflow',
          severity: 'warn',
          surfaceId: createSurfaceId('monitor1'),
          message: `Monitor extends  mm past desk lateral bounds (margin  mm).`,
          value: Math.abs(overflow),
        });
      }

      const deskSpanForward = spanAlongAxis(deskBounds, forward);
      const monitorSpanForward = spanAlongAxis(monitorBounds, forward);
      if (monitorSpanForward.min < deskSpanForward.min - edgeMargin || monitorSpanForward.max > deskSpanForward.max + edgeMargin) {
        const overflow = Math.max(
          deskSpanForward.min - monitorSpanForward.min,
          monitorSpanForward.max - deskSpanForward.max,
        );
        next.push({
          id: 'monitor-depth-overflow',
          severity: 'warn',
          surfaceId: createSurfaceId('monitor1'),
          message: `Monitor extends  mm past desk depth bounds (margin  mm).`,
          value: Math.abs(overflow),
        });
      }
    }

    return next;
  }, [
    enabled,
    layoutFrame,
    deskSurface,
    deskMeta,
    monitorSurface,
    monitorMeta,
    monitorBounds,
    monitorClearance,
    tolerance,
    monitorFaceToleranceDeg,
    edgeMargin,
  ]);

  const lastReportRef = useRef<string>('');
  useEffect(() => {
    if (!enabled || !onReport) return;
    const serialized = JSON.stringify(warnings);
    if (serialized === lastReportRef.current) return;
    lastReportRef.current = serialized;
    onReport(warnings);
  }, [warnings, onReport, enabled]);

  return warnings;
}



