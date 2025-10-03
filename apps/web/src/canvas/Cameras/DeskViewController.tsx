"use client";
/**
 * DeskViewController
 * ------------------
 * A tiny React component that *controls the three.js camera* while you're in the
 * "desk" mode (wide view where both planes stay visible).
 *
 * Key ideas (beginner-friendly):
 * - In React Three Fiber (R3F), you don't manually render frames; instead, you *update the camera*
 *   and R3F draws the scene next frame.
 * - This component *doesn't render JSX geometry*; it only uses React hooks to:
 *     1) Position the camera based on the app's camera state (yaw/pitch/dolly).
 *     2) Wire up mouse wheel + drag events to update that state.
 * - Zustand is our tiny global store that holds yaw/pitch/dolly. We call store actions to edit it.
 */

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { useCamera, clampPose } from "@/state/cameraSlice";
import { useLayoutCameraTarget } from "@/canvas/hooks/useLayoutFrame";
import { isCameraOrbitLocked, subscribeCameraOrbit } from "@/state/cameraInteractionStore";

/**
 * Fallback desk target: used until the auto-layout pass resolves the live target.
 */
const FALLBACK_DESK_TARGET: [number, number, number] = [0.1, 0.33, -0.35];

const ORBIT_SPEED = 0.003; // radians per px
const DOLLY_STEP = 0.15;   // meters per wheel notch (sign controlled by deltaY)

export default function DeskViewController() {
  const { camera, gl } = useThree();

  const mode = useCamera((s) => s.mode);
  const yaw = useCamera((s) => s.yaw);
  const pitch = useCamera((s) => s.pitch);
  const dolly = useCamera((s) => s.dolly);
  const orbitBy = useCamera((s) => s.orbitBy);
  const dollyBy = useCamera((s) => s.dollyBy);

  const layoutTarget = useLayoutCameraTarget();
  const target = layoutTarget ?? FALLBACK_DESK_TARGET;

  useEffect(() => {
    if (mode.kind !== "desk") return;

    const [tx, ty, tz] = target;

    const px = tx + dolly * Math.cos(pitch) * Math.sin(yaw);
    const py = ty + dolly * Math.sin(pitch);
    const pz = tz + dolly * Math.cos(pitch) * Math.cos(yaw);

    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
  }, [camera, mode, yaw, pitch, dolly, target]);

  const dragging = useRef(false);
  const lastX = useRef(0);
  const lastY = useRef(0);

  useEffect(() => {
    if (mode.kind !== "desk") return;

    const unsubscribe = subscribeCameraOrbit(() => {
      if (isCameraOrbitLocked()) {
        dragging.current = false;
      }
    });

    return () => unsubscribe();
  }, [mode]);

  useEffect(() => {
    if (mode.kind !== "desk") return;

    const el = gl.domElement;

    function onWheel(e: WheelEvent) {
      if (isCameraOrbitLocked()) return;
      const s = Math.sign(e.deltaY);
      dollyBy(s * DOLLY_STEP);
    }

    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl, mode, dollyBy]);

  useEffect(() => {
    if (mode.kind !== "desk") return;

    const el = gl.domElement;

    function onPointerDown(e: PointerEvent) {
      if (isCameraOrbitLocked()) {
        dragging.current = false;
        return;
      }
      dragging.current = true;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (!dragging.current) return;
      if (isCameraOrbitLocked()) {
        dragging.current = false;
        return;
      }
      const dx = e.clientX - lastX.current;
      const dy = e.clientY - lastY.current;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
      orbitBy(dx * ORBIT_SPEED, -dy * ORBIT_SPEED);
    }

    function stopDragging(e: PointerEvent) {
      dragging.current = false;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", stopDragging);
    el.addEventListener("pointercancel", stopDragging);
    el.addEventListener("pointerleave", stopDragging);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", stopDragging);
      el.removeEventListener("pointercancel", stopDragging);
      el.removeEventListener("pointerleave", stopDragging);
    };
  }, [gl, mode, orbitBy]);

  useEffect(() => {
    if (mode.kind !== "desk") return;
    const clamped = clampPose(mode, yaw, pitch, dolly);
    if (clamped.yaw !== yaw || clamped.pitch !== pitch || clamped.dolly !== dolly) {
      orbitBy(clamped.yaw - yaw, clamped.pitch - pitch);
      dollyBy(clamped.dolly - dolly);
    }
  }, [mode, yaw, pitch, dolly, orbitBy, dollyBy]);

  return null;
}
