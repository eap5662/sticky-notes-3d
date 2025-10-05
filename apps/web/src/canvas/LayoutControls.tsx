import { useState, useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import { resetLayoutOverrides } from "@/state/layoutOverridesStore";
import { useLayoutOverridesState } from "@/canvas/hooks/useLayoutOverrides";
import { useSelection } from "@/canvas/hooks/useSelection";
import { useGenericProp, useGenericProps } from "@/canvas/hooks/useGenericProps";
import { rotateGenericProp, getGenericPropRotationDeg, dockPropWithOffset, undockProp } from "@/state/genericPropsStore";
import { useLayoutFrameState } from "@/canvas/hooks/useLayoutFrame";

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
  const overrides = useLayoutOverridesState();
  const layoutFrame = useLayoutFrameState();
  const [isOpen, setIsOpen] = useState(false);

  const selection = useSelection();
  const selectedGenericId = selection && selection.kind === 'generic' ? selection.id : null;
  const selectedGeneric = useGenericProp(selectedGenericId);

  // Find desk prop (now in generic props store)
  const genericProps = useGenericProps();
  const deskProp = genericProps.find(p => p.catalogId === 'desk-default');

  // Rotation target: selected prop if any, otherwise desk
  const rotationTarget = selectedGeneric
    ? { type: 'generic' as const, id: selectedGeneric.id, label: selectedGeneric.label ?? 'Prop' }
    : deskProp
    ? { type: 'generic' as const, id: deskProp.id, label: 'Desk' }
    : null;

  const currentRotationDeg = rotationTarget
    ? getGenericPropRotationDeg(rotationTarget.id)
    : 0;

  const handleRotateLeft = useCallback(() => {
    if (!rotationTarget) return;
    rotateGenericProp(rotationTarget.id, -ROTATE_STEP_DEG);
  }, [rotationTarget]);

  const handleRotateRight = useCallback(() => {
    if (!rotationTarget) return;
    rotateGenericProp(rotationTarget.id, ROTATE_STEP_DEG);
  }, [rotationTarget]);

  const handleDock = useCallback(() => {
    if (!selectedGeneric || !layoutFrame.frame || !deskProp) return;

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

    dockPropWithOffset(selectedGeneric.id, {
      lateral,
      depth,
      lift,
      yaw: propDeskRelativeYaw, // Desk-relative rotation
    });
  }, [selectedGeneric, layoutFrame.frame, deskProp]);

  const handleUndock = useCallback(() => {
    if (!selectedGeneric) return;
    undockProp(selectedGeneric.id);
  }, [selectedGeneric]);

  const containerClass = ["pointer-events-none flex flex-col items-end gap-2", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass}>
      <button
        type="button"
        className="pointer-events-auto rounded-full bg-black/70 px-3 py-1 text-xs uppercase tracking-wide text-white shadow hover:bg-black/80"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {isOpen ? "Hide Layout" : "Show Layout"}
      </button>

      {isOpen && rotationTarget && (
        <div className="pointer-events-auto w-64 rounded-md bg-black/70 p-3 text-sm text-white shadow-lg">
          <div>
            <div className="font-semibold">
              {rotationTarget.label} Rotation
            </div>
            <div className="mt-2 flex gap-2">
              <HoldButton
                className="flex-1 rounded border border-white/30 px-2 py-1 hover:bg-white/10"
                onActivate={handleRotateLeft}
                holdIntervalMs={DESK_HOLD_INTERVAL_MS}
              >
                Rotate Left
              </HoldButton>
              <HoldButton
                className="flex-1 rounded border border-white/30 px-2 py-1 hover:bg-white/10"
                onActivate={handleRotateRight}
                holdIntervalMs={DESK_HOLD_INTERVAL_MS}
              >
                Rotate Right
              </HoldButton>
            </div>
            <div className="mt-1 text-xs text-white/70">
              Yaw: {currentRotationDeg.toFixed(1)}&deg;
              {selectedGeneric && selectedGeneric.docked && <span className="ml-2">(Docked)</span>}
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
                    Undock from Desk
                  </button>
                ) : (
                  <button
                    type="button"
                    className="w-full rounded border border-white/30 px-2 py-1 text-xs hover:bg-white/10"
                    onClick={handleDock}
                  >
                    Dock to Desk
                  </button>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            className="mt-3 w-full rounded border border-white/30 px-2 py-1 text-xs uppercase tracking-wide hover:bg-white/10"
            onClick={() => resetLayoutOverrides()}
          >
            Reset Adjustments
          </button>
        </div>
      )}
    </div>
  );
}
