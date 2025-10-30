import { useEffect, useLayoutEffect, useRef } from 'react';

import { useLayoutFrameState } from './useLayoutFrame';
import { useGenericProps } from './useGenericProps';
import { useSurfacesByKind } from './useSurfaces';
import {
  setGenericPropPosition,
  setGenericPropRotation,
  type GenericProp,
} from '@/state/genericPropsStore';
import type { LayoutFrame } from '@/state/layoutFrameStore';
import type { SurfaceMeta } from '@/state/surfaceMetaStore';
import { clampUVToShape, unprojectFromSurface } from '@/canvas/math/surfaceFrame';

const EPSILON = 1e-4;

type DockConstraintContext = {
  frame: LayoutFrame | null;
  activeDeskId: string | null;
  deskPropsById: Map<string, GenericProp>;
  surfaceMetaById: Map<string, SurfaceMeta>;
};

function shouldUpdateProp(
  prop: GenericProp,
  newPosition: [number, number, number],
  newRotation: [number, number, number]
): boolean {
  const posDelta =
    Math.abs(prop.position[0] - newPosition[0]) +
    Math.abs(prop.position[1] - newPosition[1]) +
    Math.abs(prop.position[2] - newPosition[2]);

  const rotDelta =
    Math.abs(prop.rotation[0] - newRotation[0]) +
    Math.abs(prop.rotation[1] - newRotation[1]) +
    Math.abs(prop.rotation[2] - newRotation[2]);

  return posDelta > EPSILON || rotDelta > EPSILON;
}

function solveDockPlacementForProp(
  prop: GenericProp,
  context: DockConstraintContext
): { position: [number, number, number]; rotation: [number, number, number] } | null {
  if (!prop.docked) {
    return null;
  }

  const { frame, activeDeskId, deskPropsById, surfaceMetaById } = context;

  const attachment = prop.dockAttachment ?? null;
  if (attachment) {
    const surfaceKey = String(attachment.surfaceId);
    const surfaceMeta = surfaceMetaById.get(surfaceKey);
    if (surfaceMeta) {
      const clamped = clampUVToShape(surfaceMeta, attachment.offsetUV.u, attachment.offsetUV.v);
      const position = unprojectFromSurface(
        surfaceMeta,
        clamped.u,
        clamped.v,
        attachment.lift
      );
      if (position) {
        const deskProp = deskPropsById.get(attachment.deskInstanceId);
        const deskYaw = deskProp ? deskProp.rotation[1] : 0;
        const rotation: [number, number, number] = [0, deskYaw + attachment.yawRel, 0];
        return { position, rotation };
      }
    }
  }

  const fallbackEligible =
    !!prop.dockOffset &&
    frame &&
    activeDeskId &&
    (!prop.dockAttachment || prop.dockAttachment.deskInstanceId === activeDeskId);

  if (fallbackEligible) {
    const deskProp = deskPropsById.get(activeDeskId);
    if (!deskProp) {
      return null;
    }

    const { lateral, depth, lift, yaw } = prop.dockOffset!;

    const up = [frame.up[0], frame.up[1], frame.up[2]] as const;
    const right = [frame.right[0], frame.right[1], frame.right[2]] as const;
    const forward = [frame.forward[0], frame.forward[1], frame.forward[2]] as const;
    const basePoint = frame.center;

    const position: [number, number, number] = [
      basePoint[0] + lateral * right[0] + depth * forward[0] + lift * up[0],
      basePoint[1] + lateral * right[1] + depth * forward[1] + lift * up[1],
      basePoint[2] + lateral * right[2] + depth * forward[2] + lift * up[2],
    ];

    const rotation: [number, number, number] = [0, deskProp.rotation[1] + yaw, 0];
    return { position, rotation };
  }

  return null;
}

export function useDockConstraints() {
  const layoutFrame = useLayoutFrameState();

  const genericProps = useGenericProps();
  const deskSurfaces = useSurfacesByKind('desk');
  const deskOwnerId = deskSurfaces[0]?.meta.ownerId ?? null;
  const deskProp = deskOwnerId
    ? genericProps.find((p) => p.id === deskOwnerId) ?? null
    : null;
  const deskId = deskProp?.id ?? null;

  const genericPropsRef = useRef(genericProps);

  // Keep genericProps ref updated without triggering the main effect
  useEffect(() => {
    genericPropsRef.current = genericProps;
  });

  useLayoutEffect(() => {
    const frame = layoutFrame.frame ?? null;

    const deskPropsById = new Map<string, GenericProp>();
    genericPropsRef.current.forEach((prop) => {
      deskPropsById.set(prop.id, prop);
    });

    const surfaceMetaById = new Map<string, SurfaceMeta>();
    deskSurfaces.forEach(({ id, meta }) => {
      surfaceMetaById.set(String(id), meta);
    });

    const context: DockConstraintContext = {
      frame,
      activeDeskId: deskId,
      deskPropsById,
      surfaceMetaById,
    };

    // Update all docked props using the ref (avoids re-running when genericProps changes)
    genericPropsRef.current.forEach((prop) => {
      if (!prop.docked) return;

      const placement = solveDockPlacementForProp(prop, context);

      if (placement && shouldUpdateProp(prop, placement.position, placement.rotation)) {
        setGenericPropPosition(prop.id, placement.position);
        setGenericPropRotation(prop.id, placement.rotation);
      }
    });
  }, [layoutFrame.frame, deskId, deskSurfaces, genericProps]);
}
