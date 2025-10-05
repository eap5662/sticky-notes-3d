"use client";
import { Suspense, useCallback, useEffect, useRef, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

import { useCamera } from "@/state/cameraSlice";
import DeskViewController from "@/canvas/Cameras/DeskViewController";
import ScreenViewController from "@/canvas/Cameras/ScreenViewController";
import { Surfaces } from "@/canvas/surfaceRendering";
import DebugHud from "@/canvas/debugHud";
import { useSurface, useSurfacesByKind } from "@/canvas/hooks/useSurfaces";
import { useLayoutValidation, type LayoutWarning } from "@/canvas/hooks/useLayoutValidation";
import { useAutoLayout } from "@/canvas/hooks/useAutoLayout";
import { useDockConstraints } from "@/canvas/hooks/useDockConstraints";
import { useLayoutOverridesState } from "@/canvas/hooks/useLayoutOverrides";
import LayoutControls from "@/canvas/LayoutControls";
import PropScaleControls from "@/canvas/PropScaleControls";
import GenericPropsLayer from "@/canvas/GenericPropsLayer";
import GenericPropControls from "@/canvas/GenericPropControls";
import GenericPropScaleBanner from "@/canvas/GenericPropScaleBanner";
import { clearSelection } from "@/state/selectionStore";
import { undockProp, spawnGenericProp } from "@/state/genericPropsStore";
import { PROP_CATALOG } from "@/data/propCatalog";
import { useGenericProps } from "@/canvas/hooks/useGenericProps";

export default function SceneRoot() {
  const mode = useCamera((s) => s.mode);
  const setMode = useCamera((s) => s.setMode);

  const genericProps = useGenericProps();
  const deskSurfaces = useSurfacesByKind('desk');

  const layoutState = useAutoLayout();
  const hasDesk = !!layoutState.frame;

  useDockConstraints();
  const overrides = useLayoutOverridesState();

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

  // Get desk prop for tracking deletion
  const deskProp = useMemo(() => {
    return genericProps.find(p => p.catalogId === 'desk-default');
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

  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Screen mode switching now handled by screen surface interaction
      // TODO: Implement generic surface click detection if needed
    },
    [setMode]
  );

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setMode({ kind: "desk" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  const isLoading = layoutState.status === 'pending';

  return (
    <div className="relative h-[70vh] min-h-[540px]">
      <DebugHud />
      <div className="pointer-events-none absolute right-4 top-4 z-20 flex flex-col items-end gap-2">
        <GenericPropControls />
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
          <GenericPropsLayer />
          <Surfaces />
          {mode.kind === "desk" ? <DeskViewController /> : <ScreenViewController />}
        </Suspense>
      </Canvas>

      <GenericPropScaleBanner />

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
