import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SurfaceId } from '@/canvas/surfaces';
import { useSurface, useSurfaceMeta } from './useSurfaces';
import { usePropBounds } from './usePropBounds';
import type { PropBounds } from '@/state/propBoundsStore';

export type LayoutWarning = {
  id: string;
  message: string;
  severity: 'warn' | 'error';
  value?: number;
  surfaceId?: SurfaceId;
};

export type UseLayoutValidationOptions = {
  /** Minimum clearance (meters) expected between desk top and monitor base along the desk normal. */
  monitorClearance?: number;
  /** Tolerance (meters) when comparing derived GLTF planes to registered surfaces. */
  tolerance?: number;
  /** Optional reporter callback for UI/console plumbing. */
  onReport?: (warnings: LayoutWarning[]) => void;
  /** Toggle validations without unmounting the hook. */
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

export function useLayoutValidation(options: UseLayoutValidationOptions = {}) {
  const { monitorClearance = 0, tolerance = 0.002, onReport, enabled = true } = options;

  const deskSurface = useSurface('desk');
  const monitorSurface = useSurface('monitor1');
  const deskMeta = useSurfaceMeta('desk');
  const monitorMeta = useSurfaceMeta('monitor1');
  const monitorBounds = usePropBounds('monitor1');

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
          surfaceId: 'desk',
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
          surfaceId: 'monitor1',
          message: `Monitor base penetrates desk by ${((monitorClearance - separation) * 1000).toFixed(1)} mm`,
          value: separation,
        });
      }
    }

    return next;
  }, [deskSurface, monitorSurface, deskMeta, monitorMeta, monitorBounds, tolerance, monitorClearance, enabled]);

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
