import { useState, useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import { rotateDesk, nudgeMonitor, resetLayoutOverrides } from "@/state/layoutOverridesStore";
import { useLayoutOverridesState } from "@/canvas/hooks/useLayoutOverrides";
import { useSelection } from "@/canvas/hooks/useSelection";
import { useGenericProp } from "@/canvas/hooks/useGenericProps";
import { rotateGenericProp, getGenericPropRotationDeg } from "@/state/genericPropsStore";

const ROTATE_STEP_DEG = 5;
const MONITOR_STEP = 0.035;
const DEFAULT_HOLD_INTERVAL_MS = 500;
const DESK_HOLD_INTERVAL_MS = 150;

function formatMillimeters(value: number) {
  return (value * 1000).toFixed(0);
}

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
  const [isOpen, setIsOpen] = useState(false);

  const selection = useSelection();
  const selectedGenericId = selection && selection.kind === 'generic' ? selection.id : null;
  const selectedGeneric = useGenericProp(selectedGenericId);

  const rotationTarget = selectedGeneric
    ? { type: 'generic' as const, id: selectedGeneric.id, label: selectedGeneric.label ?? 'Prop' }
    : { type: 'desk' as const };

  const currentRotationDeg = rotationTarget.type === 'generic'
    ? getGenericPropRotationDeg(rotationTarget.id)
    : overrides.deskYawDeg;

  const handleRotateLeft = useCallback(() => {
    if (rotationTarget.type === 'generic') {
      rotateGenericProp(rotationTarget.id, -ROTATE_STEP_DEG);
    } else {
      rotateDesk(-ROTATE_STEP_DEG);
    }
  }, [rotationTarget]);

  const handleRotateRight = useCallback(() => {
    if (rotationTarget.type === 'generic') {
      rotateGenericProp(rotationTarget.id, ROTATE_STEP_DEG);
    } else {
      rotateDesk(ROTATE_STEP_DEG);
    }
  }, [rotationTarget]);

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

      {isOpen && (
        <div className="pointer-events-auto w-64 rounded-md bg-black/70 p-3 text-sm text-white shadow-lg">
          <div>
            <div className="font-semibold">
              {rotationTarget.type === 'generic' ? `${rotationTarget.label} Rotation` : 'Desk Rotation'}
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
            <div className="mt-1 text-xs text-white/70">Yaw: {currentRotationDeg.toFixed(1)}&deg;</div>
          </div>

          <div className="mt-3">
            <div className="font-semibold">Monitor Slide</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <HoldButton
                className="rounded border border-white/30 px-2 py-1 hover:bg-white/10"
                onActivate={() => nudgeMonitor(-MONITOR_STEP, 0)}
              >
                Slide Left
              </HoldButton>
              <HoldButton
                className="rounded border border-white/30 px-2 py-1 hover:bg-white/10"
                onActivate={() => nudgeMonitor(MONITOR_STEP, 0)}
              >
                Slide Right
              </HoldButton>
              <HoldButton
                className="rounded border border-white/30 px-2 py-1 hover:bg-white/10"
                onActivate={() => nudgeMonitor(0, MONITOR_STEP)}
              >
                Forward
              </HoldButton>
              <HoldButton
                className="rounded border border-white/30 px-2 py-1 hover:bg-white/10"
                onActivate={() => nudgeMonitor(0, -MONITOR_STEP)}
              >
                Backward
              </HoldButton>
            </div>
            <div className="mt-1 text-xs text-white/70">
              Lateral: {formatMillimeters(overrides.monitorLateral)} mm | Depth: {formatMillimeters(overrides.monitorDepth)} mm
            </div>
          </div>

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
