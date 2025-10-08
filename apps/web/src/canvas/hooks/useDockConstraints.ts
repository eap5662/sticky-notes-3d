import { useEffect, useRef } from 'react';

import { useLayoutFrameState } from './useLayoutFrame';
import { useGenericProps } from './useGenericProps';
import {
  setGenericPropPosition,
  setGenericPropRotation,
  type GenericProp,
  type GenericPropBounds,
} from '@/state/genericPropsStore';
import type { LayoutFrame } from '@/state/layoutFrameStore';

const EPSILON = 1e-4;

type DockConstraintContext = {
  frame: LayoutFrame;
  deskYawRad: number;
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
  propBounds: GenericPropBounds | null,
  context: DockConstraintContext
): { position: [number, number, number]; rotation: [number, number, number] } | null {
  if (!prop.docked || !prop.dockOffset) {
    return null;
  }

  const { frame } = context;

  const up = [frame.up[0], frame.up[1], frame.up[2]] as const;
  const right = [frame.right[0], frame.right[1], frame.right[2]] as const;
  const forward = [frame.forward[0], frame.forward[1], frame.forward[2]] as const;

  // Use frame.center as the base point (center of desk bounds)
  const basePoint = frame.center;

  // Position = desk center + lateral*right + depth*forward + lift*up
  const lateral = prop.dockOffset.lateral;
  const depth = prop.dockOffset.depth;
  const lift = prop.dockOffset.lift;

  const position: [number, number, number] = [
    basePoint[0] + lateral * right[0] + depth * forward[0] + lift * up[0],
    basePoint[1] + lateral * right[1] + depth * forward[1] + lift * up[1],
    basePoint[2] + lateral * right[2] + depth * forward[2] + lift * up[2],
  ];

  // Convert desk-relative yaw to world yaw using actual desk rotation
  const worldYaw = prop.dockOffset.yaw + context.deskYawRad;

  const rotation: [number, number, number] = [0, worldYaw, 0];

  return { position, rotation };
}

export function useDockConstraints() {
  const layoutFrame = useLayoutFrameState();

  const genericProps = useGenericProps();

  // Find desk prop to get its actual rotation
  const deskProp = genericProps.find(p => p.catalogId === 'desk-default');
  const deskYawRad = deskProp?.rotation[1] ?? 0;

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
    };

    // Update all docked props using the ref (avoids re-running when genericProps changes)
    genericPropsRef.current.forEach((prop) => {
      if (!prop.docked) return;

      const placement = solveDockPlacementForProp(prop, prop.bounds ?? null, context);

      if (placement && shouldUpdateProp(prop, placement.position, placement.rotation)) {
        setGenericPropPosition(prop.id, placement.position);
        setGenericPropRotation(prop.id, placement.rotation);
      }
    });
  }, [layoutFrame.frame, deskYawRad]);
}
