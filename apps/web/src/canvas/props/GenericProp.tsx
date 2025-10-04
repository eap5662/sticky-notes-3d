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
import { useSurface } from '@/canvas/hooks/useSurfaces';
import { planeProject } from '@/canvas/math/plane';
import { lockCameraOrbit, unlockCameraOrbit } from '@/state/cameraInteractionStore';
import { useSelection } from '@/canvas/hooks/useSelection';
import { PROP_CATALOG } from '@/data/propCatalog';
import { setSurfaceMeta } from '@/state/surfaceMetaStore';

const DEFAULT_ANCHOR = { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } } as const;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TMP_PLANE = new THREE.Plane();
const TMP_POINT = new THREE.Vector3();
const TMP_RAY = new THREE.Ray();

const HIGHLIGHT_COLOR = '#5eead4';
const HIGHLIGHT_MINOR_RADIUS_SCALE = 0.55;
const HIGHLIGHT_MAJOR_RADIUS_SCALE = 1.1;
const DESK_CLEARANCE = 0.015;
const CLEARANCE_EPSILON = 1e-4;

type GenericPropInstanceProps = {
  prop: GenericProp;
};

export function GenericPropInstance({ prop }: GenericPropInstanceProps) {
  const deskSurface = useSurface('desk');
  const selection = useSelection();
  const isSelected = selection?.kind === 'generic' && selection.id === prop.id;

  const dragActiveRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const grabOffsetRef = useRef(new THREE.Vector3());
  const initialBoundsOffsetRef = useRef<number | null>(null);

  // Get surface config from catalog
  const catalogEntry = useMemo(() => {
    return PROP_CATALOG.find(entry => entry.id === prop.catalogId);
  }, [prop.catalogId]);

  const surfaceRegistrations = useMemo(() => {
    if (!catalogEntry?.surfaces) return undefined;
    return catalogEntry.surfaces.map(surf => ({
      id: surf.id as any,
      kind: surf.kind as any,
      nodeName: surf.nodeName,
      options: surf.options,
      onExtract: (info: any) => {
        // Store surface metadata with kind
        setSurfaceMeta(surf.id as any, {
          ...info.meta,
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

      if (deskSurface) {
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
    [deskSurface, prop.position],
  );

  const constrainHeight = useCallback(
    (next: THREE.Vector3) => {
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
    [deskHeight, propMinY, currentPositionY],
  );

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      lockCameraOrbit();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation?.();
      setSelection({ kind: 'generic', id: prop.id });

      // Docked props cannot be dragged
      if (prop.docked) {
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

      event.target.setPointerCapture?.(event.pointerId);
    },
    [computeIntersection, prop.id, prop.position, prop.status, prop.docked],
  );

  const finishDrag = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!dragActiveRef.current) {
      unlockCameraOrbit();
      return;
    }
    if (pointerIdRef.current !== null && pointerIdRef.current !== event.pointerId) return;

    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();

    dragActiveRef.current = false;
    pointerIdRef.current = null;

    event.target.releasePointerCapture?.(event.pointerId);
    unlockCameraOrbit();
  }, []);

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!dragActiveRef.current) return;
      if (pointerIdRef.current !== null && pointerIdRef.current !== event.pointerId) return;

      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation?.();

      const intersection = computeIntersection(event);
      if (!intersection) {
        return;
      }

      const next = intersection.add(grabOffsetRef.current);
      constrainHeight(next);
      setGenericPropPosition(prop.id, [next.x, next.y, next.z]);
    },
    [computeIntersection, prop.id, constrainHeight],
  );

  const isOverDesk = useMemo(() => {
    if (!deskSurface) return false;
    const rayOriginY = (prop.bounds?.max[1] ?? prop.position[1]) + 1;
    TMP_RAY.origin.set(prop.position[0], rayOriginY, prop.position[2]);
    TMP_RAY.direction.set(0, -1, 0);
    const hit = planeProject(TMP_RAY, deskSurface);
    if (!hit.hit) return false;
    return hit.u >= 0 && hit.u <= 1 && hit.v >= 0 && hit.v <= 1;
  }, [deskSurface, prop.bounds, prop.position]);

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

  useEffect(() => {
    if (deskHeight == null) return;
    if (!prop.bounds) return;
    if (!isOverDesk) return;
    if (prop.status === 'dragging' && dragActiveRef.current) return;

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
    }
  }, [deskHeight, isOverDesk, prop.bounds, prop.id, prop.position, prop.status]);

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
          onPointerLeave: finishDrag,
        }}
      />
      {isSelected && (
        <mesh position={highlightData.center} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[highlightData.minorRadius, highlightData.majorRadius, 48]} />
          <meshBasicMaterial color={HIGHLIGHT_COLOR} transparent opacity={0.4} />
        </mesh>
      )}
    </>
  );
}

