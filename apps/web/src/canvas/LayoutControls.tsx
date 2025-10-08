import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import * as THREE from "three";

import { useSelection } from "@/canvas/hooks/useSelection";
import { useGenericProp, useGenericProps } from "@/canvas/hooks/useGenericProps";
import { rotateGenericProp, getGenericPropRotationDeg, dockPropWithOffset, undockProp, type Vec3 } from "@/state/genericPropsStore";
import { useLayoutFrameState } from "@/canvas/hooks/useLayoutFrame";
import { useUndoHistoryStore } from "@/state/undoHistoryStore";
import { useSurface, useSurfacesByKind } from "@/canvas/hooks/useSurfaces";
import { getDeskBounds } from "@/state/deskBoundsStore";
import { pointInPolygon } from "@/canvas/math/polygon";
import { planeProject } from "@/canvas/math/plane";

const ROTATE_STEP_DEG = 5;
const DEFAULT_HOLD_INTERVAL_MS = 500;
const DESK_HOLD_INTERVAL_MS = 150;

type HoldButtonProps = {
  onActivate: () => void;
  className?: string;
  children: ReactNode;
  holdIntervalMs?: number;
};

function useHoldPress(action: () => void, intervalMs = DEFAULT_HOLD_INTERVAL_MS) {
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    actionRef.current();
    timeoutRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(() => {
        actionRef.current();
      }, intervalMs);
    }, intervalMs);
  }, [intervalMs, stop]);

  useEffect(() => stop, [stop]);

  return { start, stop };
}

function HoldButton({ onActivate, className, children, holdIntervalMs }: HoldButtonProps) {
  const { start, stop } = useHoldPress(onActivate, holdIntervalMs);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      start();
    },
    [start],
  );

  const handlePointerStop = useCallback(() => {
    stop();
  }, [stop]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        start();
      }
    },
    [start],
  );

  const handleKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        stop();
      }
    },
    [stop],
  );

  return (
    <button
      type="button"
      className={className}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerStop}
      onPointerLeave={handlePointerStop}
      onPointerCancel={handlePointerStop}
      onBlur={handlePointerStop}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {children}
    </button>
  );
}

type LayoutControlsProps = {
  className?: string;
};

export default function LayoutControls({ className = "" }: LayoutControlsProps = {}) {
  const layoutFrame = useLayoutFrameState();
  const pushAction = useUndoHistoryStore((s) => s.push);

  const selection = useSelection();
  const selectedGenericId = selection && selection.kind === 'generic' ? selection.id : null;
  const selectedGeneric = useGenericProp(selectedGenericId);

  // Find desk prop (now in generic props store)
  const genericProps = useGenericProps();
  const deskProp = genericProps.find(p => p.catalogId === 'desk-default');

  // Get desk surface for isOverDesk check
  const deskSurfaces = useSurfacesByKind('desk');
  const deskSurfaceId = deskSurfaces[0]?.id;
  const deskSurface = useSurface(deskSurfaceId ?? '');

  // Check if selected prop is over desk
  const isOverDesk = (() => {
    if (!selectedGeneric || !deskSurface || !deskProp) return false; // Default to false if no checks possible

    // Check if desk has custom polygon bounds
    const customBounds = getDeskBounds(deskProp.id);

    if (customBounds) {
      // Use point-in-polygon check with custom bounds
      const propPoint2D: [number, number] = [selectedGeneric.position[0], selectedGeneric.position[2]];
      return pointInPolygon(propPoint2D, customBounds);
    }

    // Fall back to UV bounds check (same as GenericProp.tsx)
    const TMP_RAY = new THREE.Ray();
    const rayOriginY = (selectedGeneric.bounds?.max[1] ?? selectedGeneric.position[1]) + 1;
    TMP_RAY.origin.set(selectedGeneric.position[0], rayOriginY, selectedGeneric.position[2]);
    TMP_RAY.direction.set(0, -1, 0);
    const hit = planeProject(TMP_RAY, deskSurface);
    if (!hit.hit) return false;
    return hit.u >= 0 && hit.u <= 1 && hit.v >= 0 && hit.v <= 1;
  })();

  // Rotation target: selected prop only (no automatic fallback to desk)
  const rotationTarget = selectedGeneric
    ? { type: 'generic' as const, id: selectedGeneric.id, label: selectedGeneric.label ?? 'Prop' }
    : null;

  const currentRotationDeg = rotationTarget
    ? getGenericPropRotationDeg(rotationTarget.id)
    : 0;

  const handleRotateLeft = useCallback(() => {
    if (!rotationTarget || !selectedGeneric) return;
    const before = selectedGeneric.rotation;
    rotateGenericProp(rotationTarget.id, -ROTATE_STEP_DEG);
    // Get updated rotation (need to wait a tick for state update)
    setTimeout(() => {
      const after = selectedGeneric.rotation;
      pushAction({
        type: 'rotate',
        propId: rotationTarget.id,
        before,
        after,
      });
    }, 0);
  }, [rotationTarget, selectedGeneric, pushAction]);

  const handleRotateRight = useCallback(() => {
    if (!rotationTarget || !selectedGeneric) return;
    const before = selectedGeneric.rotation;
    rotateGenericProp(rotationTarget.id, ROTATE_STEP_DEG);
    // Get updated rotation (need to wait a tick for state update)
    setTimeout(() => {
      const after = selectedGeneric.rotation;
      pushAction({
        type: 'rotate',
        propId: rotationTarget.id,
        before,
        after,
      });
    }, 0);
  }, [rotationTarget, selectedGeneric, pushAction]);

  const handleDock = useCallback(() => {
    if (!selectedGeneric || !layoutFrame.frame || !deskProp) return;

    const beforeDocked = selectedGeneric.docked;
    const beforePos = selectedGeneric.position;

    // Calculate dock offset from current world position
    const frame = layoutFrame.frame;
    const pos = selectedGeneric.position;
    const rot = selectedGeneric.rotation;

    // Simple offset calculation: position relative to desk center
    const deskCenter = frame.center;
    const relativePos = [
      pos[0] - deskCenter[0],
      pos[1] - deskCenter[1],
      pos[2] - deskCenter[2],
    ];

    // Project onto desk axes
    const right = frame.right;
    const forward = frame.forward;
    const up = frame.up;

    const lateral = relativePos[0] * right[0] + relativePos[1] * right[1] + relativePos[2] * right[2];
    const depth = relativePos[0] * forward[0] + relativePos[1] * forward[1] + relativePos[2] * forward[2];
    const lift = relativePos[0] * up[0] + relativePos[1] * up[1] + relativePos[2] * up[2];

    // Get desk's current yaw from desk prop (now in genericPropsStore)
    const deskYawRad = deskProp.rotation[1];

    // Store yaw relative to desk (subtract desk yaw from prop yaw)
    const propWorldYaw = rot[1];
    const propDeskRelativeYaw = propWorldYaw - deskYawRad;

    const dockOffset = {
      lateral,
      depth,
      lift,
      yaw: propDeskRelativeYaw, // Desk-relative rotation
    };

    dockPropWithOffset(selectedGeneric.id, dockOffset);

    // Push undo action
    pushAction({
      type: 'dock',
      propId: selectedGeneric.id,
      beforeDocked,
      afterDocked: true,
      beforePos,
      afterPos: pos,
      dockOffset,
    });
  }, [selectedGeneric, layoutFrame.frame, deskProp, pushAction]);

  const handleUndock = useCallback(() => {
    if (!selectedGeneric) return;
    const beforeDocked = selectedGeneric.docked;
    const beforePos = selectedGeneric.position;
    const dockOffset = selectedGeneric.dockOffset;

    undockProp(selectedGeneric.id);

    // Push undo action
    pushAction({
      type: 'undock',
      propId: selectedGeneric.id,
      beforeDocked,
      afterDocked: false,
      beforePos,
      afterPos: beforePos, // Position doesn't change on undock
      dockOffset,
    });
  }, [selectedGeneric, pushAction]);

  const containerClass = ["pointer-events-none flex flex-col items-end gap-2", className]
    .filter(Boolean)
    .join(" ");

  if (!rotationTarget) return null;

  const isDocked = selectedGeneric?.docked ?? false;
  const isDesk = selectedGeneric?.catalogId === 'desk-default';
  const buttonClass = isDocked
    ? "flex-1 rounded border border-white/30 px-2 py-1 opacity-40 cursor-not-allowed"
    : "flex-1 rounded border border-white/30 px-2 py-1 hover:bg-white/10";

  return (
    <div className={containerClass}>
      <div className="pointer-events-auto w-64 rounded-md bg-black/70 p-3 text-sm text-white shadow-lg">
          <div>
            <div className="font-semibold">
              {rotationTarget.label} Rotation
            </div>
            <div className="mt-2 flex gap-2">
              <HoldButton
                className={buttonClass}
                onActivate={isDocked ? () => {} : handleRotateLeft}
                holdIntervalMs={DESK_HOLD_INTERVAL_MS}
              >
                Rotate Left
              </HoldButton>
              <HoldButton
                className={buttonClass}
                onActivate={isDocked ? () => {} : handleRotateRight}
                holdIntervalMs={DESK_HOLD_INTERVAL_MS}
              >
                Rotate Right
              </HoldButton>
            </div>
            <div className="mt-1 text-xs text-white/70">
              Yaw: {currentRotationDeg.toFixed(1)}&deg;
              {selectedGeneric && selectedGeneric.docked && (
                <>
                  <span className="ml-2">(Docked)</span>
                  <span className="ml-2 text-teal-400">Undock to edit</span>
                </>
              )}
            </div>
          </div>

          {selectedGeneric && (
            <div className="mt-3">
              <div className="font-semibold">Desk Attachment</div>
              <div className="mt-2">
                {selectedGeneric.docked ? (
                  <button
                    type="button"
                    className="w-full rounded border border-white/30 px-2 py-1 text-xs hover:bg-white/10"
                    onClick={handleUndock}
                  >
                    {isDesk ? 'Unlock Desk' : 'Undock from Desk'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`w-full rounded border px-2 py-1 text-xs ${
                        isOverDesk
                          ? 'border-white/30 hover:bg-white/10'
                          : 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
                      }`}
                      onClick={isOverDesk ? handleDock : undefined}
                      disabled={!isOverDesk}
                    >
                      {isDesk ? 'Lock Desk' : 'Dock to Desk'}
                    </button>
                    {!isOverDesk && !isDesk && (
                      <div className="mt-1 text-[10px] text-yellow-400/80">
                        Move prop over desk surface to dock
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
    </div>
  );
}
