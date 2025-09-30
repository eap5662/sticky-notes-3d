"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

import { useCamera } from "@/state/cameraSlice";
import DeskViewController from "@/canvas/Cameras/DeskViewController";
import ScreenViewController from "@/canvas/Cameras/ScreenViewController";
import { Surfaces } from "@/canvas/surfaceRendering";
import { subscribe as subscribeSurfaces, getSurfaceOrNull, type SurfaceId } from "@/canvas/surfaces";
import { planeProject } from "@/canvas/math/plane";
import DebugHud from "@/canvas/debugHud";
import type { TableStandConfig } from "@/canvas/mounts/types";
import { computePose } from "@/canvas/mounts/pose";
import { TableStandMount } from "@/canvas/mounts/variants/tableStand";
import { DeskProp } from "@/canvas/props/DeskProp";
import { MonitorProp } from "@/canvas/props/MonitorProp";

function useSurface(id: SurfaceId) {
  return useSyncExternalStore(
    subscribeSurfaces,
    () => getSurfaceOrNull(id),
    () => getSurfaceOrNull(id)
  );
}

export default function SceneRoot() {
  const mode = useCamera((s) => s.mode);
  const setMode = useCamera((s) => s.setMode);

  const deskSurface = useSurface("desk");
  const monitorSurface = useSurface("monitor1");

  const surfaceReady = deskSurface && monitorSurface;

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

  // ---- TableStand mount config + pose ----
  const mountCfg: TableStandConfig = useMemo(
    () => ({
      deskAnchor: { surfaceId: "desk", u: 0.52, v: 0.42, lift: 0 },
      base: { w: 0.22, d: 0.24, t: 0.02, fillet: 0.01, minClearance: 2 }, // mm
      neck: { width: 0.035, depth: 0.025 },
      plate: { w: 0.12, h: 0.10, t: 0.004 },
    }),
    []
  );

  const pose = useMemo(() => {
    if (!deskSurface || !monitorSurface) return null;
    const socket = { u: 0, v: 0, lift: 0 };
    return computePose({ deskSurface, monitorSurface, socket, deskAnchor: mountCfg.deskAnchor });
  }, [deskSurface, monitorSurface, mountCfg]);

  return (
    <div className="relative">
      <DebugHud />
      <Canvas
        camera={{ position: [0, 1.2, 2.5], fov: 50 }}
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
          <MonitorProp url="/models/monitor_processed.glb" />

          <Surfaces />
          {pose && <TableStandMount pose={pose} config={mountCfg} showDebug />}
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
