import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';

import GLTFProp from './GLTFProp';
import {
  clearGenericPropBounds,
  setGenericPropBounds,
  setGenericPropPosition,
  setGenericPropStatus,
  type GenericProp,
} from '@/state/genericPropsStore';
import { clearSelection, setSelection } from '@/state/selectionStore';
import { useSurface, useSurfacesByKind } from '@/canvas/hooks/useSurfaces';
import { planeProject } from '@/canvas/math/plane';
import { lockCameraOrbit, unlockCameraOrbit } from '@/state/cameraInteractionStore';
import { useSelection } from '@/canvas/hooks/useSelection';
import { PROP_CATALOG } from '@/data/propCatalog';
import { setSurfaceMeta } from '@/state/surfaceMetaStore';
import { useLayoutFrame } from '@/canvas/hooks/useLayoutFrame';
import { useUndoHistoryStore } from '@/state/undoHistoryStore';
import type { Vec3 } from '@/state/genericPropsStore';
import { useGenericProps } from '@/canvas/hooks/useGenericProps';
import { getDeskBounds } from '@/state/deskBoundsStore';
import { pointInPolygon } from '@/canvas/math/polygon';

const DEFAULT_ANCHOR = { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } } as const;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TMP_PLANE = new THREE.Plane();
const TMP_POINT = new THREE.Vector3();
const TMP_RAY = new THREE.Ray();

const HIGHLIGHT_COLOR = '#5eead4';

const toVec3 = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];
const HIGHLIGHT_MINOR_RADIUS_SCALE = 0.55;
const HIGHLIGHT_MAJOR_RADIUS_SCALE = 1.1;
const DESK_CLEARANCE = 0.015;
const CLEARANCE_EPSILON = 1e-4;
const DESK_DRIVE_BASE_SPEED = 0.002; // meters per frame when just outside stop radius
const DESK_DRIVE_GAIN = 0.048; // additional speed per meter of pointer offset
const DESK_DRIVE_MAX_STEP = 0.024; // cap desk travel per frame (~2.4cm)
const DESK_DRIVE_STOP_RADIUS = 0.02; // pointer within 2cm of center releases drag

type GenericPropInstanceProps = {
  prop: GenericProp;
};

export function GenericPropInstance({ prop }: GenericPropInstanceProps) {
  // Query desk surface by kind (reactively subscribes to surface changes)
  const deskSurfaces = useSurfacesByKind('desk');
  const deskSurfaceId = deskSurfaces[0]?.id;
  const deskSurface = useSurface(deskSurfaceId ?? '');

  const layoutFrame = useLayoutFrame();
  const isActive = !!layoutFrame; // Active when desk exists
  const canDrag = isActive && !!deskSurface && !prop.docked;

  const selection = useSelection();
  const isSelected = selection?.kind === 'generic' && selection.id === prop.id;

  const dragActiveRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const grabOffsetRef = useRef(new THREE.Vector3());
  const initialBoundsOffsetRef = useRef<number | null>(null);
  const hasAdjustedHeightRef = useRef(false);
  const prevDeskHeightRef = useRef<number | null>(null);
  const positionBeforeDragRef = useRef<Vec3 | null>(null);
  const latestPositionRef = useRef<Vec3>(prop.position);
  const deskCenterOffsetRef = useRef<Vec3 | null>(null);
  const deskCenterRef = useRef<Vec3 | null>(null);
  const deskPointerPointRef = useRef<Vec3 | null>(null);
  const pointerCaptureTargetRef = useRef<Element | null>(null);

  const pushAction = useUndoHistoryStore((s) => s.push);

  // Find desk prop for bounds checking
  const genericProps = useGenericProps();
  const deskProp = useMemo(() => {
    return genericProps.find(p => p.catalogId === 'desk-default');
  }, [genericProps]);

  // Get surface config from catalog
  const catalogEntry = useMemo(() => {
    return PROP_CATALOG.find(entry => entry.id === prop.catalogId);
  }, [prop.catalogId]);

  const surfaceRegistrations = useMemo(() => {
    if (!catalogEntry?.surfaces) return undefined;
    return catalogEntry.surfaces.map(surf => ({
      id: surf.id,
      kind: surf.kind,
      nodeName: surf.nodeName,
      options: surf.options,
      onExtract: (info: ReturnType<typeof import('./surfaceAdapter').extractSurfaceFromNode>['debug']) => {
        // Store surface metadata with kind
        setSurfaceMeta(surf.id, {
          center: toVec3(info.center),
          normal: toVec3(info.normal),
          uDir: toVec3(info.uDir),
          vDir: toVec3(info.vDir),
          extents: info.extents,
          kind: surf.kind,
        });
      },
    }));
  }, [catalogEntry]);

  useEffect(() => {
    return () => {
      clearGenericPropBounds(prop.id);
    };
  }, [prop.id]);

  const deskHeight = useMemo(() => {
    if (!deskSurface) return null;
    return deskSurface.origin[1];
  }, [deskSurface]);

  useEffect(() => {
    if (prop.catalogId !== 'desk-default') {
      deskCenterOffsetRef.current = null;
      deskCenterRef.current = null;
      return;
    }
    if (prop.bounds) {
      const center = [
        (prop.bounds.min[0] + prop.bounds.max[0]) / 2,
        (prop.bounds.min[1] + prop.bounds.max[1]) / 2,
        (prop.bounds.min[2] + prop.bounds.max[2]) / 2,
      ] as Vec3;
      const offset = [
        center[0] - prop.position[0],
        center[1] - prop.position[1],
        center[2] - prop.position[2],
      ] as Vec3;
      deskCenterOffsetRef.current = offset;
      deskCenterRef.current = center;
    } else {
      const fallback = [prop.position[0], prop.position[1], prop.position[2]] as Vec3;
      deskCenterOffsetRef.current = [0, 0, 0] as Vec3;
      deskCenterRef.current = fallback;
    }
  }, [prop.catalogId, prop.bounds, prop.position]);

  const propMinY = prop.bounds?.min[1] ?? null;
  const currentPositionY = prop.position[1];

  const handleBoundsChanged = useCallback(
    (bounds: { min: [number, number, number]; max: [number, number, number] }) => {
      setGenericPropBounds(prop.id, bounds);
    },
    [prop.id],
  );

  const computeIntersection = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const ray = event.ray;
      const isDesk = prop.catalogId === 'desk-default';

      // Don't project onto desk surface when dragging the desk itself (circular logic)
      if (deskSurface && !isDesk) {
        const hit = planeProject(ray, deskSurface);
        if (hit.hit) {
          return hit.point.clone();
        }
      }

      const fallbackY = deskSurface ? deskSurface.origin[1] : prop.position[1];
      TMP_PLANE.set(WORLD_UP, -fallbackY);
      const worldPoint = ray.intersectPlane(TMP_PLANE, TMP_POINT);
      return worldPoint ? worldPoint.clone() : null;
    },
    [deskSurface, prop.position, prop.catalogId],
  );

  const constrainHeight = useCallback(
    (next: THREE.Vector3) => {
      // Don't constrain desk height - only props ON the desk
      if (prop.catalogId === 'desk-default') {
        return next;
      }

      if (deskHeight == null || propMinY == null) {
        return next;
      }
      const desiredFoot = deskHeight + DESK_CLEARANCE;
      const deltaY = next.y - currentPositionY;
      const predictedMin = propMinY + deltaY;
      if (predictedMin < desiredFoot) {
        next.y += desiredFoot - predictedMin;
      }
      return next;
    },
    [deskHeight, propMinY, currentPositionY, prop.catalogId],
  );

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      lockCameraOrbit();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation?.();
      setSelection({ kind: 'generic', id: prop.id });

      // Cannot drag if no desk or if docked
      if (!canDrag) {
        requestAnimationFrame(() => {
          unlockCameraOrbit();
        });
        return;
      }

      let effectiveStatus = prop.status;
      if (prop.status === 'placed') {
        setGenericPropStatus(prop.id, 'dragging');
        effectiveStatus = 'dragging';
      }

      if (effectiveStatus !== 'dragging') {
        requestAnimationFrame(() => {
          unlockCameraOrbit();
        });
        return;
      }

      const intersection = computeIntersection(event);
      if (!intersection) {
        unlockCameraOrbit();
        return;
      }

      dragActiveRef.current = true;
      pointerIdRef.current = event.pointerId;
      grabOffsetRef.current.set(prop.position[0], prop.position[1], prop.position[2]).sub(intersection);
      if (prop.catalogId === 'desk-default') {
        deskPointerPointRef.current = [intersection.x, intersection.y, intersection.z];
      }

      // Capture position at start of drag for undo
      positionBeforeDragRef.current = prop.position;

      if (event.target && 'setPointerCapture' in event.target) {
        (event.target as Element).setPointerCapture(event.pointerId);
        pointerCaptureTargetRef.current = event.target as Element;
      } else {
        pointerCaptureTargetRef.current = null;
      }
    },
    [computeIntersection, prop.id, prop.position, prop.status, prop.catalogId, canDrag, deskSurface],
  );

  const finishDrag = useCallback(
    (event?: ThreeEvent<PointerEvent>) => {
      if (!dragActiveRef.current) {
        unlockCameraOrbit();
        return;
      }

      if (event) {
        if (pointerIdRef.current !== null && pointerIdRef.current !== event.pointerId) {
          return;
        }
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation?.();
      }

      if (positionBeforeDragRef.current) {
        const before = positionBeforeDragRef.current;
        const after = latestPositionRef.current;
        if (
          after &&
          (before[0] !== after[0] || before[1] !== after[1] || before[2] !== after[2])
        ) {
          pushAction({
            type: 'move',
            propId: prop.id,
            before: [before[0], before[1], before[2]] as Vec3,
            after: [after[0], after[1], after[2]] as Vec3,
          });
        }
        positionBeforeDragRef.current = null;
      }

      dragActiveRef.current = false;

      const pointerId = pointerIdRef.current;
      pointerIdRef.current = null;

      const captureTarget = pointerCaptureTargetRef.current;
      pointerCaptureTargetRef.current = null;
      if (captureTarget && pointerId !== null && 'releasePointerCapture' in captureTarget) {
        captureTarget.releasePointerCapture(pointerId);
      } else if (event?.target && 'releasePointerCapture' in event.target) {
        (event.target as Element).releasePointerCapture(event.pointerId);
      }

      deskPointerPointRef.current = null;
      setGenericPropStatus(prop.id, 'placed');
      unlockCameraOrbit();
    },
    [prop.id, pushAction],
  );

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!dragActiveRef.current) return;
      if (pointerIdRef.current !== null && pointerIdRef.current !== event.pointerId) return;

      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation?.();

      const pointerPoint = computeIntersection(event);
      if (!pointerPoint) {
        return;
      }

      if (prop.catalogId === 'desk-default') {
        const current = latestPositionRef.current;
        const centerOffset = (deskCenterOffsetRef.current ?? [0, 0, 0]) as Vec3;
        const deskCenter = (deskCenterRef.current ??
          [
            current[0] + centerOffset[0],
            current[1] + centerOffset[1],
            current[2] + centerOffset[2],
          ]) as Vec3;
        const offsetX = pointerPoint.x - deskCenter[0];
        const offsetZ = pointerPoint.z - deskCenter[2];
        const planarDistance = Math.hypot(offsetX, offsetZ);

        if (planarDistance <= DESK_DRIVE_STOP_RADIUS) {
          finishDrag(event);
          return;
        }

        const dirX = offsetX / planarDistance;
        const dirZ = offsetZ / planarDistance;
        const step = Math.min(
          DESK_DRIVE_MAX_STEP,
          DESK_DRIVE_BASE_SPEED + DESK_DRIVE_GAIN * planarDistance,
        );

        const nextTuple: Vec3 = [
          current[0] + dirX * step,
          current[1],
          current[2] + dirZ * step,
        ];

        latestPositionRef.current = nextTuple;
        const nextCenter: Vec3 = [
          nextTuple[0] + centerOffset[0],
          nextTuple[1] + centerOffset[1],
          nextTuple[2] + centerOffset[2],
        ];
        deskCenterRef.current = nextCenter;

        setGenericPropPosition(prop.id, nextTuple);
        grabOffsetRef.current.set(
          nextTuple[0] - pointerPoint.x,
          nextTuple[1] - pointerPoint.y,
          nextTuple[2] - pointerPoint.z,
        );
        return;
      }

      const desired = pointerPoint.clone().add(grabOffsetRef.current);
      constrainHeight(desired);
      const nextTuple: Vec3 = [desired.x, desired.y, desired.z];
      latestPositionRef.current = nextTuple;
      setGenericPropPosition(prop.id, nextTuple);
      grabOffsetRef.current.set(
        nextTuple[0] - pointerPoint.x,
        nextTuple[1] - pointerPoint.y,
        nextTuple[2] - pointerPoint.z,
      );
    },
    [computeIntersection, prop.id, constrainHeight, prop.catalogId, finishDrag],
  );

  const handlePointerLeave = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!dragActiveRef.current) return;
      const target = event.target as Element | null;
      if (target && typeof target.hasPointerCapture === 'function' && target.hasPointerCapture(event.pointerId)) {
        return;
      }
      finishDrag(event);
    },
    [finishDrag],
  );

  const isOverDesk = useMemo(() => {
    if (!deskSurface) return false;

    // Check if desk has custom polygon bounds
    const customBounds = deskProp ? getDeskBounds(deskProp.id) : null;

    if (customBounds) {
      // Use point-in-polygon check with custom bounds
      const propPoint2D: [number, number] = [prop.position[0], prop.position[2]];
      return pointInPolygon(propPoint2D, customBounds);
    }

    // Fall back to UV bounds check (default behavior)
    const rayOriginY = (prop.bounds?.max[1] ?? prop.position[1]) + 1;
    TMP_RAY.origin.set(prop.position[0], rayOriginY, prop.position[2]);
    TMP_RAY.direction.set(0, -1, 0);
    const hit = planeProject(TMP_RAY, deskSurface);
    if (!hit.hit) return false;
    return hit.u >= 0 && hit.u <= 1 && hit.v >= 0 && hit.v <= 1;
  }, [deskSurface, prop.bounds, prop.position, deskProp]);

  useEffect(() => {
    if (!isSelected || prop.status !== 'dragging') return;

    function handleKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        dragActiveRef.current = false;
        pointerIdRef.current = null;
        setGenericPropStatus(prop.id, 'placed');
        clearSelection();
        unlockCameraOrbit();
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isSelected, prop.status, prop.id]);

  // Reset height adjustment flag when desk height changes (e.g., desk scaled)
  useEffect(() => {
    if (deskHeight !== null && prevDeskHeightRef.current !== null) {
      if (Math.abs(deskHeight - prevDeskHeightRef.current) > CLEARANCE_EPSILON) {
        hasAdjustedHeightRef.current = false;
      }
    }
    prevDeskHeightRef.current = deskHeight;
  }, [deskHeight]);

  useEffect(() => {
    // Don't auto-adjust desk height - only adjust props ON the desk
    if (prop.catalogId === 'desk-default') return;

    if (deskHeight == null) return;
    if (!prop.bounds) return;
    if (!isOverDesk) return;
    if (prop.status === 'dragging' && dragActiveRef.current) return;

    // Only adjust once when bounds first become available
    if (hasAdjustedHeightRef.current) return;

    // Capture the initial bounds offset (local-space foot position) on first bounds arrival
    if (initialBoundsOffsetRef.current === null) {
      initialBoundsOffsetRef.current = prop.bounds.min[1] - prop.position[1];
    }

    const desiredFoot = deskHeight + DESK_CLEARANCE;
    const localFootOffset = initialBoundsOffsetRef.current;
    const targetY = desiredFoot - localFootOffset;

    // Only adjust if the error is significant
    if (Math.abs(prop.position[1] - targetY) > CLEARANCE_EPSILON) {
      setGenericPropPosition(prop.id, [prop.position[0], targetY, prop.position[2]]);
      hasAdjustedHeightRef.current = true;
    }
    // Note: prop.position and prop.bounds intentionally NOT in deps to avoid infinite loop
    // This effect runs once when conditions are met, then hasAdjustedHeightRef prevents re-runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deskHeight, isOverDesk, prop.id, prop.status, prop.catalogId]);

  useEffect(() => {
    latestPositionRef.current = prop.position;
    if (prop.catalogId === 'desk-default') {
      const offset = deskCenterOffsetRef.current;
      if (offset) {
        deskCenterRef.current = [
          prop.position[0] + offset[0],
          prop.position[1] + offset[1],
          prop.position[2] + offset[2],
        ] as Vec3;
      }
    }
  }, [prop.position]);

  useEffect(() => {
    if (prop.catalogId !== 'desk-default') return;
    if (prop.status !== 'dragging') return;

    const interval = window.setInterval(() => {
      if (!dragActiveRef.current) return;
      const pointerPoint = deskPointerPointRef.current;
      if (!pointerPoint) return;

      const current = latestPositionRef.current;
      const centerOffset = (deskCenterOffsetRef.current ?? [0, 0, 0]) as Vec3;
      const deskCenter = (deskCenterRef.current ??
        [
          current[0] + centerOffset[0],
          current[1] + centerOffset[1],
          current[2] + centerOffset[2],
        ]) as Vec3;

      const offsetX = pointerPoint[0] - deskCenter[0];
      const offsetZ = pointerPoint[2] - deskCenter[2];
      const planarDistance = Math.hypot(offsetX, offsetZ);

      if (planarDistance <= DESK_DRIVE_STOP_RADIUS) {
        finishDrag();
        return;
      }

      const dirX = offsetX / planarDistance;
      const dirZ = offsetZ / planarDistance;
      const step = Math.min(
        DESK_DRIVE_MAX_STEP,
        DESK_DRIVE_BASE_SPEED + DESK_DRIVE_GAIN * planarDistance,
      );

      const nextTuple: Vec3 = [
        current[0] + dirX * step,
        current[1],
        current[2] + dirZ * step,
      ];

      latestPositionRef.current = nextTuple;
      const nextCenter: Vec3 = [
        nextTuple[0] + centerOffset[0],
        nextTuple[1] + centerOffset[1],
        nextTuple[2] + centerOffset[2],
      ];
      deskCenterRef.current = nextCenter;

      setGenericPropPosition(prop.id, nextTuple);
      grabOffsetRef.current.set(
        nextTuple[0] - pointerPoint[0],
        nextTuple[1] - pointerPoint[1],
        nextTuple[2] - pointerPoint[2],
      );
    }, 250);

    return () => window.clearInterval(interval);
  }, [prop.catalogId, prop.status, finishDrag, prop.id]);

  const highlightData = useMemo(() => {
    if (!prop.bounds) {
      return {
        center: [prop.position[0], prop.position[1], prop.position[2]] as [number, number, number],
        minorRadius: 0.12,
        majorRadius: 0.18,
      };
    }
    const min = prop.bounds.min;
    const max = prop.bounds.max;
    const center: [number, number, number] = [
      (min[0] + max[0]) / 2,
      min[1] + 0.002,
      (min[2] + max[2]) / 2,
    ];
    const sizeX = Math.max(Math.abs(max[0] - min[0]), 0.001);
    const sizeZ = Math.max(Math.abs(max[2] - min[2]), 0.001);
    const baseRadius = Math.max(sizeX, sizeZ) / 2;
    const majorRadius = baseRadius === 0 ? 0.18 : baseRadius * HIGHLIGHT_MAJOR_RADIUS_SCALE;
    const minorRadius = majorRadius * HIGHLIGHT_MINOR_RADIUS_SCALE;
    return { center, minorRadius, majorRadius };
  }, [prop.bounds, prop.position]);

  return (
    <>
      <GLTFProp
        url={prop.url}
        position={prop.position}
        rotation={prop.rotation}
        scale={prop.scale}
        anchor={prop.anchor ?? DEFAULT_ANCHOR}
        onBoundsChanged={handleBoundsChanged}
        registerSurfaces={surfaceRegistrations}
        groupProps={{
          onPointerDown: handlePointerDown,
          onPointerMove: handlePointerMove,
          onPointerUp: finishDrag,
          onPointerCancel: finishDrag,
          onPointerLeave: handlePointerLeave,
        }}
      />
      {isSelected && isActive && (
        <mesh position={highlightData.center} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[highlightData.minorRadius, highlightData.majorRadius, 48]} />
          <meshBasicMaterial color={HIGHLIGHT_COLOR} transparent opacity={0.4} />
        </mesh>
      )}
    </>
  );
}
