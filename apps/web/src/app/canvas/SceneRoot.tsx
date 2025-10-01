"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

import { useCamera } from "@/state/cameraSlice";
import DeskViewController from "@/canvas/Cameras/DeskViewController";
import ScreenViewController from "@/canvas/Cameras/ScreenViewController";
import { Surfaces } from "@/canvas/surfaceRendering";
import type { SurfaceMeta } from "@/state/surfaceMetaStore";
import { planeProject } from "@/canvas/math/plane";
import DebugHud from "@/canvas/debugHud";
import { useSurface, useSurfaceMeta } from "@/canvas/hooks/useSurfaces";
import { useLayoutValidation, type LayoutWarning } from "@/canvas/hooks/useLayoutValidation";
import { DeskProp } from "@/canvas/props/DeskProp";
import { MonitorProp } from "@/canvas/props/MonitorProp";
import { usePropBounds } from "@/canvas/hooks/usePropBounds";
import type { PropBounds } from "@/state/propBoundsStore";

const tupleToVec3 = (values: readonly number[]) => new THREE.Vector3(values[0], values[1], values[2]);

function cloneSurfaceMeta(meta: SurfaceMeta): SurfaceMeta {
  return {
    center: [...meta.center] as SurfaceMeta["center"],
    normal: [...meta.normal] as SurfaceMeta["normal"],
    uDir: [...meta.uDir] as SurfaceMeta["uDir"],
    vDir: [...meta.vDir] as SurfaceMeta["vDir"],
    extents: { ...meta.extents },
  };
}

function clonePropBounds(bounds: PropBounds): PropBounds {
  return {
    min: [...bounds.min] as PropBounds["min"],
    max: [...bounds.max] as PropBounds["max"],
  };
}

function extremalPoint(bounds: PropBounds, normal: THREE.Vector3, pick: "min" | "max") {
  const choose = (axis: number, minVal: number, maxVal: number) => {
    const positive = axis >= 0;
    if (pick === "min") {
      return positive ? minVal : maxVal;
    }
    return positive ? maxVal : minVal;
  };

  return new THREE.Vector3(
    choose(normal.x, bounds.min[0], bounds.max[0]),
    choose(normal.y, bounds.min[1], bounds.max[1]),
    choose(normal.z, bounds.min[2], bounds.max[2])
  );
}

export default function SceneRoot() {
  const mode = useCamera((s) => s.mode);
  const setMode = useCamera((s) => s.setMode);

  const deskSurface = useSurface("desk");
  const monitorSurface = useSurface("monitor1");
  const deskMeta = useSurfaceMeta("desk");
  const monitorMeta = useSurfaceMeta("monitor1");
  const monitorBounds = usePropBounds("monitor1");

  const surfaceReady = deskSurface && monitorSurface;

  const initialMonitorMetaRef = useRef<SurfaceMeta | null>(null);
  useEffect(() => {
    if (!initialMonitorMetaRef.current && monitorMeta) {
      initialMonitorMetaRef.current = cloneSurfaceMeta(monitorMeta);
    }
  }, [monitorMeta]);

  const initialMonitorBoundsRef = useRef<PropBounds | null>(null);
  useEffect(() => {
    if (!initialMonitorBoundsRef.current && monitorBounds) {
      initialMonitorBoundsRef.current = clonePropBounds(monitorBounds);
    }
  }, [monitorBounds]);

  const handleLayoutWarnings = useCallback((warnings: LayoutWarning[]) => {
    warnings.forEach((warning) => {
      const log = warning.severity === 'error' ? console.error : console.warn;
      log(`[layout] ${warning.id}: ${warning.message}`);
    });
  }, []);
  useLayoutValidation({ monitorClearance: 0.0015, tolerance: 0.003, onReport: handleLayoutWarnings });

  const monitorOffset = useMemo(() => {
    if (!deskSurface || !deskMeta) return undefined;

    const deskNormal = tupleToVec3(deskMeta.normal).normalize();
    const deskTop = tupleToVec3(deskSurface.origin);
    const clearance = 0.0015; // 1.5 mm lift to avoid z-fighting
    const desiredProjection = deskTop.dot(deskNormal) + clearance;

    const baseBounds = initialMonitorBoundsRef.current ?? monitorBounds;
    if (baseBounds) {
      const baseBottomPoint = extremalPoint(baseBounds, deskNormal, "min");
      const baseProjection = baseBottomPoint.dot(deskNormal);
      const delta = desiredProjection - baseProjection;
      return deskNormal.clone().multiplyScalar(delta).toArray() as [number, number, number];
    }

    const baseMeta = initialMonitorMetaRef.current ?? monitorMeta;
    if (!baseMeta) return undefined;

    const baseCenter = tupleToVec3(baseMeta.center);
    const baseNormal = tupleToVec3(baseMeta.normal).normalize();
    const baseBottom = baseCenter.clone().sub(baseNormal.clone().multiplyScalar(baseMeta.extents.thickness / 2));

    return deskNormal
      .clone()
      .multiplyScalar(desiredProjection - baseBottom.dot(deskNormal))
      .toArray() as [number, number, number];
  }, [deskSurface, deskMeta, monitorMeta, monitorBounds]);

  // keep refs to the three.js camera and the actual <canvas> element
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  // NOTE: handler is for the Canvas *wrapper div*, per R3F typings
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!monitorSurface) return;

      const cam = cameraRef.current;
      const canvas = canvasElRef.current;
      if (!cam || !canvas) return;

      // Convert client (px) -> NDC (-1..1) using the real <canvas> rect
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      const ndc = new THREE.Vector2(x, y);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, cam);
      const ray = raycaster.ray;

      const hit = planeProject(ray, monitorSurface);
      if (hit.hit && hit.u >= 0 && hit.u <= 1 && hit.v >= 0 && hit.v <= 1) {
        setMode({ kind: "screen", surfaceId: "monitor1" });
      }
    },
    [monitorSurface, setMode]
  );

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setMode({ kind: "desk" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  return (
    <div className="relative h-[70vh] min-h-[540px]">
      <DebugHud />
      <Canvas
        style={{ width: "100%", height: "100%" }}
        camera={{ position: [0, 1.35, 3.6], fov: 48 }}
        dpr={[1, 1.5]}
        frameloop="always"
        gl={{ powerPreference: "low-power" }}
        onCreated={({ camera, gl, scene }) => {
          cameraRef.current = camera as THREE.PerspectiveCamera;
          canvasElRef.current = gl.domElement as HTMLCanvasElement;

          // Color space & tone mapping (nicer highlights; avoids blown whites)
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;

           // Background + fog (depth separation)
          const bg = new THREE.Color(0x0b0d12); // deep slate-blue
          gl.setClearColor(bg, 1);
          scene.fog = new THREE.Fog(bg, 6, 16);
        }}
        onPointerDown={onPointerDown}
      >
        <Suspense fallback={null}>
          {/* GLTF props that also register surfaces */}
          <DeskProp url="/models/DeskTopPlane.glb" />
          <MonitorProp url="/models/monitor_processed.glb" position={monitorOffset} />

          <Surfaces />
          {mode.kind === "desk" ? <DeskViewController /> : <ScreenViewController />}
        </Suspense>
      </Canvas>

      {!surfaceReady && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-black/60 px-4 py-2 text-sm text-white">
          Loading desk + monitor surfaces...
        </div>
      )}
    </div>
  );
}
