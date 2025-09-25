"use client";
import { Suspense, useCallback, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

import { useCamera } from "@/state/cameraSlice";
import DeskViewController from "@/canvas/Cameras/DeskViewController";
import ScreenViewController from "@/canvas/Cameras/ScreenViewController";
import { Surfaces } from "@/canvas/surfaceRendering";
import { getSurface } from "@/canvas/surfaces";
import { planeProject } from "@/canvas/math/plane";
import DebugHud from "@/canvas/debugHud";

export default function SceneRoot() {
  const mode = useCamera((s) => s.mode);
  const setMode = useCamera((s) => s.setMode);

  // keep refs to the three.js camera and the actual <canvas> element
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  // NOTE: handler is for the Canvas *wrapper div*, per R3F typings
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
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

    const monitor = getSurface("monitor1");
    const hit = planeProject(ray, monitor);
    if (hit.hit && hit.u >= 0 && hit.u <= 1 && hit.v >= 0 && hit.v <= 1) {
      setMode({ kind: "screen", surfaceId: "monitor1" });
    }
  }, [setMode]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setMode({ kind: "desk" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  return (
    <div className="relative">
      <DebugHud />
      <Canvas
        camera={{ position: [0, 1.2, 2.5], fov: 50 }}
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{ powerPreference: "low-power" }}
        onCreated={({ camera, gl }) => {
          cameraRef.current = camera as THREE.PerspectiveCamera;
          canvasElRef.current = gl.domElement as HTMLCanvasElement;
        }}
        onPointerDown={onPointerDown}
      >
        <Suspense fallback={null}>
          <Surfaces />
          {mode.kind === "desk" ? <DeskViewController /> : <ScreenViewController />}
        </Suspense>
      </Canvas>
    </div>
  );
}