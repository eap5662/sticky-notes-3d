"use client";
import { Suspense, useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

import { useCamera } from "@/state/cameraSlice";
import CameraRigController from "@/canvas/Cameras/CameraRigController";
import { Surfaces } from "@/canvas/surfaceRendering";
import DebugHud from "@/canvas/debugHud";
import { useLayoutValidation, type LayoutWarning } from "@/canvas/hooks/useLayoutValidation";
import { useAutoLayout } from "@/canvas/hooks/useAutoLayout";
import { useDockConstraints } from "@/canvas/hooks/useDockConstraints";
import { useUndoHistory } from "@/canvas/hooks/useUndoHistory";
import GenericPropsLayer from "@/canvas/GenericPropsLayer";
import DeskSwapPreviewLayer from "@/canvas/DeskSwapPreviewLayer";
import DeskSurfaceBoundsMarkers from "@/canvas/DeskSurfaceBoundsMarkers";
import GenericPropControls from "@/canvas/GenericPropControls";
import PropSelectionPanel from "@/canvas/PropSelectionPanel";
import DeletePropButton from "@/canvas/DeletePropButton";
import UndoToast from "@/canvas/UndoToast";
import BoundsMarkingMode from "@/canvas/BoundsMarkingMode";
import DeskDriveHint from "@/canvas/DeskDriveHint";
import GroundGrid from "@/canvas/GroundGrid";
import { clearSelection } from "@/state/selectionStore";
import { closeCatalog } from "@/state/catalogState";
import { motion, AnimatePresence } from "framer-motion";
import { spawnGenericProp, setGenericPropPosition, dockPropWithOffset, dockPropWithAttachment, floatDockedProp, getGenericPropsSnapshot, type Vec3, type GenericProp } from "@/state/genericPropsStore";
import { PROP_CATALOG } from "@/data/propCatalog";
import { useGenericProps } from "@/canvas/hooks/useGenericProps";
import { useLayoutFrame } from "@/canvas/hooks/useLayoutFrame";
import { useSelection } from "@/canvas/hooks/useSelection";
import { useDelayedVisibility } from "@/canvas/hooks/useDelayedVisibility";
import type { LayoutFrame } from "@/state/layoutFrameStore";
import { useActiveDeskId, useActiveDeskProp } from "@/canvas/hooks/useDeskProp";

const DESK_MOVE_SPEED = 0.85; // meters per second
const PROP_MOVE_SPEED = 0.45; // meters per second
const MIN_MOVEMENT_DELTA = 1 / 60;
const MOVE_KEYS = new Set(['w', 'a', 's', 'd']);

function projectHorizontal(vec: readonly number[]): Vec3 {
  return [vec[0], 0, vec[2]] as Vec3;
}

export default function SceneRoot() {
  const setMode = useCamera((s) => s.setMode);

  const genericProps = useGenericProps();
  const activeDeskId = useActiveDeskId();
  const deskProp = useActiveDeskProp();
  const layoutState = useAutoLayout();
  const layoutFrame = useLayoutFrame();
  const hasDesk = !!layoutState.frame;

  const deskPropRef = useRef<GenericProp | null>(deskProp);
  const genericPropsRef = useRef<GenericProp[]>(genericProps);
  const loggedSnapshotRef = useRef(false);

  const layoutFrameRef = useRef<LayoutFrame | null>(layoutFrame);
  useEffect(() => {
    layoutFrameRef.current = layoutFrame;
  }, [layoutFrame]);
  const movementFrameRef = useRef<number | null>(null);
  const lastMovementTimeRef = useRef<number | null>(null);

  useEffect(() => {
    genericPropsRef.current = genericProps;
    if (!loggedSnapshotRef.current) {
      loggedSnapshotRef.current = true;
      const immediate = getGenericPropsSnapshot().map((prop) => ({
        id: prop.id,
        position: prop.position,
        docked: prop.docked,
        deskInstanceId: prop.dockAttachment?.deskInstanceId ?? null,
      }));
      console.info('[SceneRoot][immediate-snapshot]', immediate);
      requestAnimationFrame(() => {
        const next = getGenericPropsSnapshot().map((prop) => ({
          id: prop.id,
          position: prop.position,
          docked: prop.docked,
          deskInstanceId: prop.dockAttachment?.deskInstanceId ?? null,
        }));
        console.info('[SceneRoot][next-frame-snapshot]', next);
        loggedSnapshotRef.current = false;
      });
    }
  }, [genericProps]);

  const selection = useSelection();
  const selectedGenericId = selection && selection.kind === 'generic' ? selection.id : null;

  // Coordinate DELETE button visibility with catalog/panel animations
  const showDeleteButton = useDelayedVisibility(!!selectedGenericId, {
    enterDelay: 300, // Coordinate with catalog close
    exitDelay: 200   // Match exit animation duration
  });

  const pressedKeysRef = useRef<Set<string>>(new Set());
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const selectedId = selection?.kind === 'generic' ? selection.id : null;
    const prevSelectedId = selectedIdRef.current;
    selectedIdRef.current = selectedId;

    // Clear pressed keys when selection changes
    if (prevSelectedId !== selectedId) {
      pressedKeysRef.current.clear();
    }
  }, [selection]);

  useEffect(() => {
    deskPropRef.current = deskProp;
    if (!deskProp || selectedIdRef.current !== deskProp.id) {
      pressedKeysRef.current.clear();
    }
  }, [deskProp]);

  const applyPropMovement = useCallback((
    propsRef: MutableRefObject<GenericProp[]>,
    deskRef: MutableRefObject<GenericProp | null>,
    frameRef: MutableRefObject<LayoutFrame | null>,
    keysRef: MutableRefObject<Set<string>>,
    selectionRef: MutableRefObject<string | null>,
    deltaSeconds = MIN_MOVEMENT_DELTA,
  ) => {
    const pressed = keysRef.current;
    if (pressed.size === 0) return;

    const selectedId = selectionRef.current;
    if (!selectedId) return;

    // Find selected prop
    const selectedProp = propsRef.current.find(p => p.id === selectedId);
    if (!selectedProp || selectedProp.status === 'dragging') return;

    // Don't allow keyboard movement of docked or locked props
    if (selectedProp.docked || selectedProp.locked) return;

    const frame = frameRef.current;
    const forward = frame ? projectHorizontal(frame.forward) : ([1, 0, 0] as Vec3);
    const right = frame ? projectHorizontal(frame.right) : ([0, 0, -1] as Vec3);

    let moveX = 0;
    let moveZ = 0;

    if (pressed.has('w')) {
      moveX += forward[0];
      moveZ += forward[2];
    }
    if (pressed.has('s')) {
      moveX -= forward[0];
      moveZ -= forward[2];
    }
    if (pressed.has('d')) {
      moveX -= right[0];
      moveZ -= right[2];
    }
    if (pressed.has('a')) {
      moveX += right[0];
      moveZ += right[2];
    }

    if (Math.abs(moveX) < 1e-6 && Math.abs(moveZ) < 1e-6) {
      return;
    }

    const length = Math.hypot(moveX, moveZ);
    if (length < 1e-6) return;

    // Use different step sizes for desk vs other props
    const isDesk = deskRef.current?.id === selectedId;
    const delta = Math.max(deltaSeconds, MIN_MOVEMENT_DELTA);
    const speed = isDesk ? DESK_MOVE_SPEED : PROP_MOVE_SPEED;
    const distance = speed * delta;

    const scale = distance / length;
    const deltaX = moveX * scale;
    const deltaZ = moveZ * scale;

    const nextPos: Vec3 = [
      selectedProp.position[0] + deltaX,
      selectedProp.position[1],
      selectedProp.position[2] + deltaZ,
    ];

    setGenericPropPosition(selectedProp.id, nextPos);

    // Update desk ref if moving the desk
    if (isDesk) {
      deskRef.current = { ...selectedProp, position: nextPos };
    }
  }, []);

  const applyPropMovementRef = useRef(applyPropMovement);
  useEffect(() => {
    applyPropMovementRef.current = applyPropMovement;
  }, [applyPropMovement]);

  useDockConstraints();
  useUndoHistory();
  // Auto-spawn desk on first mount if none exists
  const hasSpawnedDeskRef = useRef(false);
  useEffect(() => {
    if (hasSpawnedDeskRef.current) return;

    if (activeDeskId) {
      hasSpawnedDeskRef.current = true;
      return;
    }

    const deskEntry = PROP_CATALOG.find(entry => entry.id === 'desk-default');
    if (!deskEntry) return;

    spawnGenericProp({
      catalogId: deskEntry.id,
      label: deskEntry.label,
      url: deskEntry.url,
      anchor: deskEntry.anchor,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    });
    hasSpawnedDeskRef.current = true;
  }, [genericProps, activeDeskId]);

  // Track desk lifecycle to float or reattach docked props
  const prevDeskIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentDeskId = deskProp?.id ?? null;
    const prevDeskId = prevDeskIdRef.current;

    if (prevDeskId && !currentDeskId) {
      // Desk removed: mark attached props as floating
      genericProps.forEach(prop => {
        if (prop.id === currentDeskId) return;
        if (prop.dockState === 'attached' || prop.docked) {
          floatDockedProp(prop.id);
        }
      });
    }

    if (!prevDeskId && currentDeskId) {
      // Desk added: auto-reattach floating props using stored offsets
      genericProps.forEach(prop => {
        if (prop.id === currentDeskId) return;
        if (prop.dockState === 'floating' && prop.dockOffset) {
          dockPropWithOffset(prop.id, prop.dockOffset);
          if (prop.dockAttachment && prop.dockAttachment.deskInstanceId === currentDeskId) {
            dockPropWithAttachment(prop.id, prop.dockAttachment);
          }
        }
      });
    }

    prevDeskIdRef.current = currentDeskId;
  }, [deskProp, genericProps]);

  // Handler to spawn desk (from banner button)
  const handleSpawnDesk = useCallback(() => {
    const deskEntry = PROP_CATALOG.find(entry => entry.id === 'desk-default');
    if (!deskEntry) return;

    spawnGenericProp({
      catalogId: deskEntry.id,
      label: deskEntry.label,
      url: deskEntry.url,
      anchor: deskEntry.anchor,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    });
  }, []);

  const handleLayoutWarnings = useCallback((warnings: LayoutWarning[]) => {
    warnings.forEach((warning) => {
      const log = warning.severity === "error" ? console.error : console.warn;
      log('[layout] ' + warning.id + ': ' + warning.message);
    });
  }, []);

  useLayoutValidation({
    monitorClearance: 0.0015,
    tolerance: 0.003,
    monitorFaceToleranceDeg: 5,
    edgeMargin: 0.012,
    onReport: handleLayoutWarnings,
  });

  useEffect(() => {
    function handleKeyDown(ev: KeyboardEvent) {
      const key = ev.key.toLowerCase();
      if (!MOVE_KEYS.has(key)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;

      const selectedId = selectedIdRef.current;
      if (!selectedId) return;

      const selectedProp = genericPropsRef.current.find(p => p.id === selectedId);
      if (!selectedProp || selectedProp.status === 'dragging' || selectedProp.docked || selectedProp.locked) return;

      if (!pressedKeysRef.current.has(key)) {
        pressedKeysRef.current.add(key);
        applyPropMovementRef.current(genericPropsRef, deskPropRef, layoutFrameRef, pressedKeysRef, selectedIdRef, MIN_MOVEMENT_DELTA);
      }
      ev.preventDefault();
    }

    function handleKeyUp(ev: KeyboardEvent) {
      const key = ev.key.toLowerCase();
      if (!MOVE_KEYS.has(key)) return;
      if (pressedKeysRef.current.delete(key)) {
        ev.preventDefault();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    const loop = (time: number) => {
      if (pressedKeysRef.current.size > 0) {
        const last = lastMovementTimeRef.current ?? time;
        const deltaSeconds = Math.min((time - last) / 1000, 0.25);
        lastMovementTimeRef.current = time;
        applyPropMovementRef.current(genericPropsRef, deskPropRef, layoutFrameRef, pressedKeysRef, selectedIdRef, deltaSeconds);
      } else {
        lastMovementTimeRef.current = time;
      }
      movementFrameRef.current = window.requestAnimationFrame(loop);
    };

    movementFrameRef.current = window.requestAnimationFrame(loop);
    return () => {
      if (movementFrameRef.current !== null) {
        window.cancelAnimationFrame(movementFrameRef.current);
        movementFrameRef.current = null;
      }
      lastMovementTimeRef.current = null;
    };
  }, []);

  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  const onPointerDown = useCallback(() => {
    // Screen mode switching now handled by screen surface interaction
    // TODO: Implement generic surface click detection if needed
  }, []);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        setMode({ kind: "wide" });
        clearSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  const isLoading = layoutState.status === 'pending' && !layoutState.frame;

  return (
    <div className="relative h-[70vh] min-h-[540px]">
      <DebugHud />
      <UndoToast />
      <DeskDriveHint />
      <div className="pointer-events-none absolute right-7 top-[0.5rem] z-20 flex flex-col items-end gap-2">
        {/* LAYER 1: Top row - always mounted, stable position */}
        <div className="pointer-events-none flex items-center gap-2">
          <AnimatePresence>
            {showDeleteButton && (
              <motion.div
                layout
                key="delete-button"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{
                  duration: 0.2,
                  ease: 'easeOut',
                  layout: { type: 'spring', bounce: 0.2, duration: 0.3 }
                }}
              >
                <DeletePropButton />
              </motion.div>
            )}
          </AnimatePresence>
          <GenericPropControls />
        </div>

        {/* LAYER 2: Panels - mount/unmount with delay coordination */}
        <PropSelectionPanel />
      </div>
      <div
        style={{ width: "100%", height: "100%" }}
        onClick={(e) => {
          // Only close if clicking directly on canvas, not on UI elements
          if (e.target instanceof HTMLCanvasElement) {
            closeCatalog();
          }
        }}
      >
        <Canvas
          style={{ width: "100%", height: "100%" }}
          camera={{ position: [0, 1.35, 3.6], fov: 48 }}
          dpr={[1, 1.5]}
          frameloop="always"
          gl={{ powerPreference: "low-power" }}
          onCreated={({ camera, gl, scene }) => {
            cameraRef.current = camera as THREE.PerspectiveCamera;
            canvasElRef.current = gl.domElement as HTMLCanvasElement;

            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.1;

            const bg = new THREE.Color(0x0b0d12);
            gl.setClearColor(bg, 1);
            scene.fog = new THREE.Fog(bg, 6, 16);
          }}
          onPointerDown={onPointerDown}
          onPointerMissed={() => clearSelection()}
        >
        <Suspense fallback={null}>
          {/* Desk now rendered via GenericPropsLayer (auto-spawned on mount) */}
          <GroundGrid />
          <GenericPropsLayer />
          <DeskSwapPreviewLayer />
          <DeskSurfaceBoundsMarkers />
          <Surfaces />
          <BoundsMarkingMode />
          <CameraRigController />
        </Suspense>
      </Canvas>
      </div>

      {/* No desk banner (Frozen World) */}
      {!hasDesk && !isLoading && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 text-center">
          <div className="rounded-lg bg-black/90 px-8 py-6 text-white shadow-2xl border border-white/10">
            <div className="text-xl font-semibold">No Workspace Active</div>
            <div className="mt-2 text-sm text-white/70 max-w-xs">
              Add a desk to activate props and enable interactions
            </div>
            <button
              type="button"
              className="mt-4 rounded-full bg-teal-500 px-6 py-2.5 text-sm font-semibold hover:bg-teal-400 transition-colors"
              onClick={handleSpawnDesk}
            >
              Add Desk
            </button>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-black/60 px-4 py-2 text-sm text-white">
          Loading workspace...
        </div>
      )}
    </div>
  );
}
