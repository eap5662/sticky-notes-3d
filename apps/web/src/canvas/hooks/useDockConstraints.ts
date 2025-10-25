import { useEffect, useRef } from 'react';

import { useLayoutFrameState } from './useLayoutFrame';
import { useGenericProps } from './useGenericProps';
import { useSurfacesByKind } from './useSurfaces';
import {
  setGenericPropPosition,
  setGenericPropRotation,
  type GenericProp,
} from '@/state/genericPropsStore';
import type { LayoutFrame } from '@/state/layoutFrameStore';

const EPSILON = 1e-4;

type DockConstraintContext = {
  frame: LayoutFrame;
  deskYawRad: number;
  deskId: string | null;
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

  const { frame, deskYawRad, deskId } = context;

  const up = [frame.up[0], frame.up[1], frame.up[2]] as const;
  const right = [frame.right[0], frame.right[1], frame.right[2]] as const;
  const forward = [frame.forward[0], frame.forward[1], frame.forward[2]] as const;
  const basePoint = frame.center;

  let lateral = 0;
  let depth = 0;
  let lift = 0;
  let yawRel = 0;

  const attachment =
    prop.dockAttachment && deskId && prop.dockAttachment.deskInstanceId !== deskId
      ? null
      : prop.dockAttachment ?? null;

  if (attachment) {
    const width = frame.extents.u;
    const depthSpan = frame.extents.v;

    const uNorm = attachment.offsetUV.u;
    const vNorm = attachment.offsetUV.v;
    lateral = (uNorm - 0.5) * (width || 0);
    depth = (vNorm - 0.5) * (depthSpan || 0);
    lift = attachment.lift;
    yawRel = attachment.yawRel;
  } else if (prop.dockOffset) {
    lateral = prop.dockOffset.lateral;
    depth = prop.dockOffset.depth;
    lift = prop.dockOffset.lift;
    yawRel = prop.dockOffset.yaw;
  } else {
    return null;
  }

  const position: [number, number, number] = [
    basePoint[0] + lateral * right[0] + depth * forward[0] + lift * up[0],
    basePoint[1] + lateral * right[1] + depth * forward[1] + lift * up[1],
    basePoint[2] + lateral * right[2] + depth * forward[2] + lift * up[2],
  ];

  const worldYaw = yawRel + deskYawRad;
  const rotation: [number, number, number] = [0, worldYaw, 0];

  return { position, rotation };
}

export function useDockConstraints() {
  const layoutFrame = useLayoutFrameState();

  const genericProps = useGenericProps();
  const deskSurfaces = useSurfacesByKind('desk');
  const deskOwnerId = deskSurfaces[0]?.meta.ownerId ?? null;
  const deskProp = deskOwnerId
    ? genericProps.find((p) => p.id === deskOwnerId) ?? null
    : null;
  const deskYawRad = deskProp?.rotation[1] ?? 0;
  const deskId = deskProp?.id ?? null;

  const prevFrameRef = useRef<LayoutFrame | null>(null);
  const prevDeskYawRef = useRef<number>(0);
  const genericPropsRef = useRef(genericProps);

  // Keep genericProps ref updated without triggering the main effect
  useEffect(() => {
    genericPropsRef.current = genericProps;
  });

  useEffect(() => {
    if (!layoutFrame.frame) {
      prevFrameRef.current = null;
      return;
    }

    const frame = layoutFrame.frame;

    // Check if frame or desk yaw actually changed (avoid thrashing)
    if (prevFrameRef.current && prevDeskYawRef.current === deskYawRad) {
      const prev = prevFrameRef.current;
      const orientationUnchanged =
        prev.up[0] === frame.up[0] &&
        prev.up[1] === frame.up[1] &&
        prev.up[2] === frame.up[2] &&
        prev.right[0] === frame.right[0] &&
        prev.right[1] === frame.right[1] &&
        prev.right[2] === frame.right[2] &&
        prev.forward[0] === frame.forward[0] &&
        prev.forward[1] === frame.forward[1] &&
        prev.forward[2] === frame.forward[2];
      const centerUnchanged =
        prev.center[0] === frame.center[0] &&
        prev.center[1] === frame.center[1] &&
        prev.center[2] === frame.center[2];

      if (orientationUnchanged && centerUnchanged) {
        return;
      }
    }

    prevFrameRef.current = frame;
    prevDeskYawRef.current = deskYawRad;

    const context: DockConstraintContext = {
      frame,
      deskYawRad,
      deskId,
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
  }, [layoutFrame.frame, deskYawRad, deskId]);
}
