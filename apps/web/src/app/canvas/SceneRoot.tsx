"use client";
import { Suspense, useCallback, useEffect, useRef, useMemo } from "react";
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
import LayoutControls from "@/canvas/LayoutControls";
import PropScaleControls from "@/canvas/PropScaleControls";
import GenericPropsLayer from "@/canvas/GenericPropsLayer";
import GenericPropControls from "@/canvas/GenericPropControls";
import DeletePropButton from "@/canvas/DeletePropButton";
import UndoToast from "@/canvas/UndoToast";
import BoundsMarkingMode from "@/canvas/BoundsMarkingMode";
import DeskDriveHint from "@/canvas/DeskDriveHint";
import GroundGrid from "@/canvas/GroundGrid";
import { clearSelection } from "@/state/selectionStore";
import { undockProp, spawnGenericProp, setGenericPropPosition, type Vec3, type GenericProp } from "@/state/genericPropsStore";
import { PROP_CATALOG } from "@/data/propCatalog";
import { useGenericProps } from "@/canvas/hooks/useGenericProps";
import { useLayoutFrame } from "@/canvas/hooks/useLayoutFrame";
import { useSelection } from "@/canvas/hooks/useSelection";
import type { LayoutFrame } from "@/state/layoutFrameStore";

const DESK_MOVE_STEP = 0.25;
const DESK_MOVE_INTERVAL_MS = 200;
const DESK_MOVE_KEYS = new Set(['w', 'a', 's', 'd']);

function projectHorizontal(vec: readonly number[]): Vec3 {
  return [vec[0], 0, vec[2]] as Vec3;
}

export default function SceneRoot() {
  const setMode = useCamera((s) => s.setMode);

  const genericProps = useGenericProps();
  const layoutState = useAutoLayout();
  const layoutFrame = useLayoutFrame();
  const hasDesk = !!layoutState.frame;

  const deskProp = useMemo(() => {
    return genericProps.find(p => p.catalogId === 'desk-default') ?? null;
  }, [genericProps]);

  const deskPropRef = useRef<GenericProp | null>(deskProp);

  const layoutFrameRef = useRef<LayoutFrame | null>(layoutFrame);
  useEffect(() => {
    layoutFrameRef.current = layoutFrame;
  }, [layoutFrame]);

  const selection = useSelection();

  const pressedKeysRef = useRef<Set<string>>(new Set());
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const selectedId = selection?.kind === 'generic' ? selection.id : null;
    selectedIdRef.current = selectedId;
    const desk = deskPropRef.current;
    if (!desk || selectedId !== desk.id) {
      pressedKeysRef.current.clear();
    }
  }, [selection]);

  useEffect(() => {
    deskPropRef.current = deskProp;
    if (!deskProp || selectedIdRef.current !== deskProp.id) {
      pressedKeysRef.current.clear();
    }
  }, [deskProp]);

  const applyDeskMovement = (
    deskRef: MutableRefObject<GenericProp | null>,
    frameRef: MutableRefObject<LayoutFrame | null>,
    keysRef: MutableRefObject<Set<string>>,
    selectionRef: MutableRefObject<string | null>,
  ) => {
    const pressed = keysRef.current;
    if (pressed.size === 0) return;

    const desk = deskRef.current;
    if (!desk || desk.status === 'dragging') return;
    const selectedId = selectionRef.current;
    if (!selectedId || selectedId !== desk.id) return;

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

    const scale = DESK_MOVE_STEP / length;
    const deltaX = moveX * scale;
    const deltaZ = moveZ * scale;

    const nextPos: Vec3 = [
      desk.position[0] + deltaX,
      desk.position[1],
      desk.position[2] + deltaZ,
    ];

    setGenericPropPosition(desk.id, nextPos);
    deskRef.current = { ...desk, position: nextPos };
  };

  useDockConstraints();
  useUndoHistory();
  // Auto-spawn desk on first mount if none exists
  const hasSpawnedDeskRef = useRef(false);
  useEffect(() => {
    if (hasSpawnedDeskRef.current) return;

    const existingDesk = genericProps.find(p => p.catalogId === 'desk-default');
    if (existingDesk) {
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
  }, [genericProps]);

  // Auto-undock all props when desk is deleted
  const prevDeskIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentDeskId = deskProp?.id ?? null;

    // Desk was removed
    if (prevDeskIdRef.current && !currentDeskId) {
      genericProps.forEach(prop => {
        if (prop.docked) {
          undockProp(prop.id);
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
      if (!DESK_MOVE_KEYS.has(key)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
      const desk = deskPropRef.current;
      const selectedId = selectedIdRef.current;
      if (!desk || desk.status === 'dragging' || !selectedId || selectedId !== desk.id) return;
      if (!pressedKeysRef.current.has(key)) {
        pressedKeysRef.current.add(key);
        applyDeskMovement(deskPropRef, layoutFrameRef, pressedKeysRef, selectedIdRef);
      }
      ev.preventDefault();
    }

    function handleKeyUp(ev: KeyboardEvent) {
      const key = ev.key.toLowerCase();
      if (!DESK_MOVE_KEYS.has(key)) return;
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
    const interval = window.setInterval(() => {
      applyDeskMovement(deskPropRef, layoutFrameRef, pressedKeysRef, selectedIdRef);
    }, DESK_MOVE_INTERVAL_MS);

    return () => window.clearInterval(interval);
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

  const isLoading = layoutState.status === 'pending';

  return (
    <div className="relative h-[70vh] min-h-[540px]">
      <DebugHud />
      <UndoToast />
      <DeskDriveHint />
      <div className="pointer-events-none absolute right-4 top-4 z-20 flex flex-col items-end gap-2">
        <div className="pointer-events-none flex items-center gap-2">
          <DeletePropButton />
          <GenericPropControls />
        </div>
        <LayoutControls />
        <PropScaleControls />
      </div>
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
          <Surfaces />
          <BoundsMarkingMode />
          <CameraRigController />
        </Suspense>
      </Canvas>

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
