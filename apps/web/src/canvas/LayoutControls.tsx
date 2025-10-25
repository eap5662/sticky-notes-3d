import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import * as THREE from "three";

import { useSelection } from "@/canvas/hooks/useSelection";
import { useGenericProp, useGenericProps } from "@/canvas/hooks/useGenericProps";
import { PROP_CATALOG } from "@/data/propCatalog";
import {
  rotateGenericProp,
  getGenericPropRotationDeg,
  dockPropWithAttachment,
  dockPropWithOffset,
  undockProp,
  setGenericPropStatus,
  setGenericPropLocked,
  type DockAttachment,
} from "@/state/genericPropsStore";
import { useLayoutFrameState } from "@/canvas/hooks/useLayoutFrame";
import { useUndoHistoryStore } from "@/state/undoHistoryStore";
import { useSurface, useSurfaceMeta, useSurfacesByKind } from "@/canvas/hooks/useSurfaces";
import { getDeskBounds } from "@/state/deskBoundsStore";
import { pointInPolygon } from "@/canvas/math/polygon";
import { planeProject } from "@/canvas/math/plane";
import { clampUVToShape, projectPointToSurface } from "@/canvas/math/surfaceFrame";
import { beginDeskSwap, cancelDeskSwap, useDeskSwapStore, forceCompleteDeskSwap, type DeskSwapAttachmentPreviewStatus } from "@/state/deskSwapStore";

const ROTATE_STEP_DEG = 5;
const DEFAULT_HOLD_INTERVAL_MS = 500;
const DESK_HOLD_INTERVAL_MS = 150;

const DESK_CATALOG_IDS = new Set(
  PROP_CATALOG.filter((entry) => entry.primaryCategory === "desk").map((entry) => entry.id)
);

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
  overrideSelectionId?: string | null;
};

export default function LayoutControls({ className = "", overrideSelectionId }: LayoutControlsProps = {}) {
  const layoutFrame = useLayoutFrameState();
  const pushAction = useUndoHistoryStore((s) => s.push);

  const selection = useSelection();
  const selectedGenericId = overrideSelectionId !== undefined
    ? overrideSelectionId
    : (selection && selection.kind === 'generic' ? selection.id : null);
  const selectedGeneric = useGenericProp(selectedGenericId);

  const swapActive = useDeskSwapStore((s) => s.active);
  const swapTargetDeskId = useDeskSwapStore((s) => s.targetDeskId);
  const previewEntry = useDeskSwapStore((s) => s.previewEntry);
  const pendingReview = useDeskSwapStore((s) => s.pendingReview);
  const previewAnalysis = useDeskSwapStore((s) => s.previewAnalysis);
  const isSwapActiveForSelectedDesk = swapActive && swapTargetDeskId === (selectedGeneric?.id ?? null);

  const previewCounts = useMemo(() => {
    if (!previewAnalysis) return null;
    const counts: Record<DeskSwapAttachmentPreviewStatus, number> = { ok: 0, clamped: 0, failed: 0 };
    previewAnalysis.attachments.forEach((attachment) => {
      counts[attachment.status] += 1;
    });
    return counts;
  }, [previewAnalysis]);

  const previewIssues = useMemo(() => {
    if (!previewAnalysis) return [];
    return previewAnalysis.attachments.filter((attachment) => attachment.status !== "ok");
  }, [previewAnalysis]);

  const reviewIssues = useMemo(() => {
    if (!pendingReview) return [];
    return pendingReview.attachments.filter((attachment) => attachment.status !== "ok");
  }, [pendingReview]);

  // Find desk prop (now in generic props store)
  const genericProps = useGenericProps();
  const deskSurfaces = useSurfacesByKind('desk');
  const deskOwnerId = deskSurfaces[0]?.meta.ownerId ?? null;
  const deskProp = useMemo(() => {
    if (deskOwnerId) {
      const byOwner = genericProps.find((prop) => prop.id === deskOwnerId);
      if (byOwner) return byOwner;
    }
    return genericProps.find((prop) => prop.catalogId && DESK_CATALOG_IDS.has(prop.catalogId)) ?? null;
  }, [genericProps, deskOwnerId]);
  const resolvedDeskId = deskProp?.id ?? deskOwnerId ?? null;

  // Get desk surface for isOverDesk check
  const deskSurfaceId = deskSurfaces[0]?.id;
  const deskSurface = useSurface(deskSurfaceId ?? '');
  const deskSurfaceMeta = useSurfaceMeta(deskSurfaceId ?? '');

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

  const isDocked = selectedGeneric?.docked ?? false;
  const isDesk = selectedGeneric
    ? selectedGeneric.id === resolvedDeskId || (selectedGeneric.catalogId && DESK_CATALOG_IDS.has(selectedGeneric.catalogId))
    : false;
  const isDeskLocked = isDesk && (selectedGeneric?.locked ?? false);
  const rotationDisabled = isDocked || isDeskLocked;

  const handleRotateLeft = useCallback(() => {
    if (!rotationTarget || !selectedGeneric) return;
    if (rotationDisabled) return;
    const before = selectedGeneric.rotation;
    const after = rotateGenericProp(rotationTarget.id, -ROTATE_STEP_DEG);
    pushAction({
      type: 'rotate',
      propId: rotationTarget.id,
      before,
      after,
    });
  }, [rotationTarget, selectedGeneric, pushAction, rotationDisabled]);

  const handleRotateRight = useCallback(() => {
    if (!rotationTarget || !selectedGeneric) return;
    if (rotationDisabled) return;
    const before = selectedGeneric.rotation;
    const after = rotateGenericProp(rotationTarget.id, ROTATE_STEP_DEG);
    pushAction({
      type: 'rotate',
      propId: rotationTarget.id,
      before,
      after,
    });
  }, [rotationTarget, selectedGeneric, pushAction, rotationDisabled]);

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

    let dockAttachment: DockAttachment | undefined;
    if (deskSurfaceId) {
      if (deskSurfaceMeta) {
        const projection = projectPointToSurface(deskSurfaceMeta, pos);
        if (projection) {
          const clamped = clampUVToShape(deskSurfaceMeta, projection.u, projection.v);
          dockAttachment = {
            deskInstanceId: deskProp.id,
            surfaceId: deskSurfaceId,
            offsetUV: clamped,
            lift: projection.lift,
            yawRel: propDeskRelativeYaw,
            surfaceSnapshot:
              deskSurfaceMeta.shape && deskSurfaceMeta.shape.type === 'rect'
                ? {
                    type: 'rect',
                    width: deskSurfaceMeta.shape.width,
                    height: deskSurfaceMeta.shape.height,
                  }
                : undefined,
          };
        }
      }

      if (!dockAttachment) {
        const width = frame.extents.u;
        const depthSpan = frame.extents.v;
        if (width > 0 && depthSpan > 0) {
          const halfWidth = width / 2;
          const halfDepth = depthSpan / 2;
          const uvU = halfWidth > 1e-6 ? Math.max(0, Math.min(1, (lateral / halfWidth + 1) / 2)) : 0.5;
          const uvV = halfDepth > 1e-6 ? Math.max(0, Math.min(1, (depth / halfDepth + 1) / 2)) : 0.5;
          dockAttachment = {
            deskInstanceId: deskProp.id,
            surfaceId: deskSurfaceId,
            offsetUV: { u: uvU, v: uvV },
            lift,
            yawRel: propDeskRelativeYaw,
          };
        }
      }

      if (dockAttachment) {
        dockPropWithAttachment(selectedGeneric.id, dockAttachment);
      }
    }

    // Push undo action
    pushAction({
      type: 'dock',
      propId: selectedGeneric.id,
      beforeDocked,
      afterDocked: true,
      beforePos,
      afterPos: pos,
      dockOffset,
      dockAttachment: dockAttachment ?? selectedGeneric.dockAttachment,
      beforeState: selectedGeneric.dockState,
      afterState: 'attached',
    });
  }, [selectedGeneric, layoutFrame.frame, deskProp, deskSurfaceId, deskSurfaceMeta, pushAction]);

  const handleUndock = useCallback(() => {
    if (!selectedGeneric) return;
    const beforeDocked = selectedGeneric.docked;
    const beforePos = selectedGeneric.position;
    const dockOffset = selectedGeneric.dockOffset;
    const dockAttachment = selectedGeneric.dockAttachment;

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
      dockAttachment,
      beforeState: selectedGeneric.dockState,
      afterState: 'free',
    });
  }, [selectedGeneric, pushAction]);

  const handleBeginSwap = useCallback(() => {
    if (!selectedGeneric) return;
    beginDeskSwap(selectedGeneric.id);
  }, [selectedGeneric]);

  const handleCancelSwapMode = useCallback(() => {
    cancelDeskSwap();
  }, []);

  const handleToggleDeskLock = useCallback(() => {
    if (!selectedGeneric) return;
    const nextLocked = !(selectedGeneric.locked ?? false);
    setGenericPropLocked(selectedGeneric.id, nextLocked);
    setGenericPropStatus(selectedGeneric.id, 'placed');
  }, [selectedGeneric]);

  const containerClass = ["pointer-events-none flex flex-col items-end gap-2", className]
    .filter(Boolean)
    .join(" ");

  if (!rotationTarget) return null;

  const buttonClass = rotationDisabled
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
                onActivate={rotationDisabled ? () => {} : handleRotateLeft}
                holdIntervalMs={DESK_HOLD_INTERVAL_MS}
              >
                Rotate Left
              </HoldButton>
              <HoldButton
                className={buttonClass}
                onActivate={rotationDisabled ? () => {} : handleRotateRight}
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
              {isDeskLocked && (
                <>
                  <span className="ml-2">(Locked)</span>
                  <span className="ml-2 text-teal-400">Unlock to edit</span>
                </>
              )}
            </div>
          </div>

          {selectedGeneric && (
            <>
              {!isDesk ? (
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
                          Dock to Desk
                        </button>
                        {!isOverDesk && (
                          <div className="mt-1 text-[10px] text-yellow-400/80">
                            Move prop over desk surface to dock
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="font-semibold">Desk Controls</div>
                  <div className="mt-2 flex flex-col gap-2">
                    <button
                      type="button"
                      className="w-full rounded border border-white/30 px-2 py-1 text-xs hover:bg-white/10"
                      onClick={handleToggleDeskLock}
                    >
                      {selectedGeneric?.locked ? 'Unlock Desk' : 'Lock Desk'}
                    </button>
                    {isDeskLocked && (
                      <div className="text-[11px] text-white/60">
                        Locked desks cannot be moved or rotated.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isDesk && (
                <div className="mt-3">
                  <button
                    type="button"
                    className="w-full rounded border border-white/30 px-2 py-1 text-xs hover:bg-white/10"
                    onClick={isSwapActiveForSelectedDesk ? handleCancelSwapMode : handleBeginSwap}
                  >
                    {isSwapActiveForSelectedDesk ? 'Cancel Desk Swap' : 'Replace Desk'}
                  </button>
                  {isSwapActiveForSelectedDesk && (
                    <div className="mt-1 text-[11px] text-white/60">
                      Catalog filtered to desks — choose a replacement to finish swapping.
                    </div>
                  )}
                  {isSwapActiveForSelectedDesk && previewEntry && (
                    <div className="mt-3 rounded-md border border-white/15 bg-white/[0.08] p-2 text-[11px] text-white">
                      <div className="font-semibold text-white">
                        Previewing: {previewEntry.label}
                      </div>
                      {previewAnalysis ? (
                        previewAnalysis.attachments.length === 0 ? (
                          <div className="mt-1 text-white/60">No docked props need remapping.</div>
                        ) : (
                          <>
                            {previewCounts && (
                              <div className="mt-1 text-white/70">
                                {previewCounts.ok} ok · {previewCounts.clamped} clamped · {previewCounts.failed} failed
                              </div>
                            )}
                            {previewIssues.length > 0 && (
                              <ul className="mt-2 space-y-1">
                                {previewIssues.map((issue) => {
                                  const tone = issue.status === "failed" ? "text-red-300" : "text-amber-200";
                                  const fallback =
                                    issue.status === "failed"
                                      ? "Cannot remap to new desk"
                                      : "Will clamp to desk bounds";
                                  return (
                                    <li key={issue.propId} className={tone}>
                                      {issue.label} — {issue.reason ?? fallback}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </>
                        )
                      ) : (
                        <div className="mt-1 text-white/60">Loading preview…</div>
                      )}
                    </div>
                  )}
                  {isSwapActiveForSelectedDesk && pendingReview && (
                    <div className="mt-3 rounded-md border border-amber-400/40 bg-amber-500/10 p-2 text-[11px] text-white">
                      <div className="font-semibold text-amber-200">Review Required</div>
                      {reviewIssues.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {reviewIssues.map((issue) => {
                            const tone = issue.status === "failed" ? "text-red-200" : "text-yellow-100";
                            const fallback =
                              issue.status === "failed"
                                ? "Cannot remap to new desk"
                                : "Will clamp to desk bounds";
                            return (
                              <li key={`pending-${issue.propId}`} className={tone}>
                                {issue.label} — {issue.reason ?? fallback}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <div className="mt-1 text-white/70">No issues detected, you can proceed.</div>
                      )}
                      <div className="mt-3 flex flex-col gap-2">
                        <button
                          type="button"
                          className="w-full rounded border border-amber-300/60 bg-amber-400/20 px-2 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-300/30"
                          onClick={() => {
                            forceCompleteDeskSwap(pendingReview.entry);
                          }}
                        >
                          Force Swap Anyway
                        </button>
                        <button
                          type="button"
                          className="w-full rounded border border-white/20 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
                          onClick={handleCancelSwapMode}
                        >
                          Cancel Swap
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
    </div>
  );
}
