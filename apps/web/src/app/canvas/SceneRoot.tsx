"use client";
import { Suspense, useCallback, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

import { useCamera } from "@/state/cameraSlice";
import DeskViewController from "@/canvas/Cameras/DeskViewController";
import ScreenViewController from "@/canvas/Cameras/ScreenViewController";
import { Surfaces } from "@/canvas/surfaceRendering";
import DebugHud from "@/canvas/debugHud";
import { useSurface } from "@/canvas/hooks/useSurfaces";
import { useLayoutValidation, type LayoutWarning } from "@/canvas/hooks/useLayoutValidation";
import { DeskProp } from "@/canvas/props/DeskProp";
import { useAutoLayout } from "@/canvas/hooks/useAutoLayout";
import { useDockConstraints } from "@/canvas/hooks/useDockConstraints";
import { useLayoutOverridesState } from "@/canvas/hooks/useLayoutOverrides";
import { usePropScale } from "@/canvas/hooks/usePropScale";
import LayoutControls from "@/canvas/LayoutControls";
import PropScaleControls from "@/canvas/PropScaleControls";
import GenericPropsLayer from "@/canvas/GenericPropsLayer";
import GenericPropControls from "@/canvas/GenericPropControls";
import GenericPropScaleBanner from "@/canvas/GenericPropScaleBanner";
import { clearSelection } from "@/state/selectionStore";

export default function SceneRoot() {
  const mode = useCamera((s) => s.mode);
  const setMode = useCamera((s) => s.setMode);

  const deskSurface = useSurface("desk");

  const layoutState = useAutoLayout();
  useDockConstraints();
  const overrides = useLayoutOverridesState();
  const deskYawRad = THREE.MathUtils.degToRad(overrides.deskYawDeg);
  const deskRotation: [number, number, number] = [0, deskYawRad, 0];

  const deskScale = usePropScale("desk");

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

  const surfacesReady = !!deskSurface;

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
          <DeskProp url="/models/DeskTopPlane.glb" rotation={deskRotation} scale={deskScale} />

          <GenericPropsLayer />
          <Surfaces />
          {mode.kind === "desk" ? <DeskViewController /> : <ScreenViewController />}
        </Suspense>
      </Canvas>

      <GenericPropScaleBanner />

      {!surfacesReady && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-black/60 px-4 py-2 text-sm text-white">
          Loading desk surface...
        </div>
      )}
    </div>
  );
}
