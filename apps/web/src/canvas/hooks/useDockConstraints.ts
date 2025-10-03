import { useEffect, useRef } from 'react';

import { useLayoutFrameState } from './useLayoutFrame';
import { useSurface } from './useSurfaces';
import { useGenericProps } from './useGenericProps';
import {
  setGenericPropPosition,
  setGenericPropRotation,
  type GenericProp,
} from '@/state/genericPropsStore';
import { usePropBounds } from './usePropBounds';
import type { PropBounds } from '@/state/propBoundsStore';
import type { LayoutFrame } from '@/state/layoutFrameStore';
import type { Surface } from '@/canvas/surfaces';

const EPSILON = 1e-4;

type DockConstraintContext = {
  frame: LayoutFrame;
  deskSurface: Surface | null;
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
  propBounds: PropBounds | null,
  context: DockConstraintContext
): { position: [number, number, number]; rotation: [number, number, number] } | null {
  if (!prop.docked || !prop.dockOffset) {
    return null;
  }

  const { frame, deskSurface } = context;

  // Reuse the same logic from useAutoLayout's solveDockPlacement
  // We'll import it directly from useAutoLayout (need to export it)
  // For now, inline a simplified version focused on generic props

  const up = [frame.up[0], frame.up[1], frame.up[2]] as const;
  const right = [frame.right[0], frame.right[1], frame.right[2]] as const;
  const forward = [frame.forward[0], frame.forward[1], frame.forward[2]] as const;

  const deskOrigin = deskSurface ? deskSurface.origin : frame.center;

  // For now, simple implementation:
  // Position = desk center + lateral*right + depth*forward + lift*up
  const lateral = prop.dockOffset.lateral;
  const depth = prop.dockOffset.depth;
  const lift = prop.dockOffset.lift;

  const position: [number, number, number] = [
    deskOrigin[0] + lateral * right[0] + depth * forward[0] + lift * up[0],
    deskOrigin[1] + lateral * right[1] + depth * forward[1] + lift * up[1],
    deskOrigin[2] + lateral * right[2] + depth * forward[2] + lift * up[2],
  ];

  const yaw = prop.dockOffset.yaw;
  const rotation: [number, number, number] = [0, yaw, 0];

  return { position, rotation };
}

export function useDockConstraints() {
  const layoutFrame = useLayoutFrameState();
  const deskSurface = useSurface('desk');
  const genericProps = useGenericProps();

  const prevFrameRef = useRef<LayoutFrame | null>(null);

  useEffect(() => {
    if (!layoutFrame.frame) {
      prevFrameRef.current = null;
      return;
    }

    const frame = layoutFrame.frame;

    // Check if frame actually changed (avoid thrashing)
    if (prevFrameRef.current) {
      const prev = prevFrameRef.current;
      const unchanged =
        prev.up[0] === frame.up[0] &&
        prev.up[1] === frame.up[1] &&
        prev.up[2] === frame.up[2] &&
        prev.right[0] === frame.right[0] &&
        prev.right[1] === frame.right[1] &&
        prev.right[2] === frame.right[2] &&
        prev.forward[0] === frame.forward[0] &&
        prev.forward[1] === frame.forward[1] &&
        prev.forward[2] === frame.forward[2];

      if (unchanged) {
        return;
      }
    }

    prevFrameRef.current = frame;

    const context: DockConstraintContext = {
      frame,
      deskSurface,
    };

    // Update all docked props
    genericProps.forEach((prop) => {
      if (!prop.docked) return;

      const placement = solveDockPlacementForProp(prop, prop.bounds ?? null, context);

      if (placement && shouldUpdateProp(prop, placement.position, placement.rotation)) {
        setGenericPropPosition(prop.id, placement.position);
        setGenericPropRotation(prop.id, placement.rotation);
      }
    });
  }, [layoutFrame.frame, deskSurface, genericProps]);
}
