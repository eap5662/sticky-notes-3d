import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';

import GLTFProp from './GLTFProp';
import {
  clearGenericPropBounds,
  setGenericPropBounds,
  setGenericPropPosition,
  type GenericProp,
} from '@/state/genericPropsStore';
import { setSelection } from '@/state/selectionStore';
import { useSurface } from '@/canvas/hooks/useSurfaces';
import { planeProject } from '@/canvas/math/plane';

const DEFAULT_ANCHOR = { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } } as const;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TMP_PLANE = new THREE.Plane();
const TMP_POINT = new THREE.Vector3();

type GenericPropInstanceProps = {
  prop: GenericProp;
};

export function GenericPropInstance({ prop }: GenericPropInstanceProps) {
  const deskSurface = useSurface('desk');

  const dragActiveRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const grabOffsetRef = useRef(new THREE.Vector3());

  useEffect(() => {
    return () => {
      clearGenericPropBounds(prop.id);
    };
  }, [prop.id]);

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

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation?.();
      setSelection({ kind: 'generic', id: prop.id });

      if (prop.status !== 'dragging') {
        return;
      }

      const intersection = computeIntersection(event);
      if (!intersection) {
        return;
      }

      dragActiveRef.current = true;
      pointerIdRef.current = event.pointerId;
      grabOffsetRef.current.set(prop.position[0], prop.position[1], prop.position[2]).sub(intersection);

      event.target.setPointerCapture?.(event.pointerId);
    },
    [computeIntersection, prop.id, prop.position, prop.status],
  );

  const finishDrag = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!dragActiveRef.current) return;
    if (pointerIdRef.current !== null && pointerIdRef.current !== event.pointerId) return;

    dragActiveRef.current = false;
    pointerIdRef.current = null;

    event.target.releasePointerCapture?.(event.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!dragActiveRef.current) return;
      if (pointerIdRef.current !== null && pointerIdRef.current !== event.pointerId) return;

      const intersection = computeIntersection(event);
      if (!intersection) {
        return;
      }

      const next = intersection.add(grabOffsetRef.current);
      setGenericPropPosition(prop.id, [next.x, next.y, next.z]);
    },
    [computeIntersection, prop.id],
  );

  return (
    <GLTFProp
      url={prop.url}
      position={prop.position}
      rotation={prop.rotation}
      scale={prop.scale}
      anchor={prop.anchor ?? DEFAULT_ANCHOR}
      onBoundsChanged={handleBoundsChanged}
      groupProps={{
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: finishDrag,
        onPointerCancel: finishDrag,
        onPointerLeave: finishDrag,
      }}
    />
  );
}
