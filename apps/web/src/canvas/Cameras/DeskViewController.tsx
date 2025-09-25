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

/**
 * Tweakable desk "target" point:
 * The camera orbits around this 3D point. Pick a spot that keeps the desk + monitor visible.
 * (Units are meters in world space.)
 */
const DESK_TARGET = { x: 0.2, y: 0.35, z: -0.2 };

/**
 * Sensitivity constants for mouse controls.
 * - ORBIT_SPEED: how fast yaw/pitch change per pixel of mouse movement.
 * - DOLLY_STEP: how much the wheel changes the camera distance.
 *
 * Tip: Smaller numbers = slower, more precise movement.
 */
const ORBIT_SPEED = 0.003; // radians per px
const DOLLY_STEP = 0.1;    // meters per wheel notch (sign controlled by deltaY)

export default function DeskViewController() {
  /**
   * R3F's useThree() gives us references to the low-level three.js objects.
   * - camera: the active THREE.PerspectiveCamera we will move around.
   * - gl.domElement: the canvas element to which we attach mouse listeners.
   */
  const { camera, gl } = useThree();

  /**
   * Subscribe to the global camera store.
   * - mode: which view we're in (we only act if kind === "desk").
   * - yaw, pitch, dolly: the "pose" that defines where the camera sits around the target.
   * - orbitBy / dollyBy: actions to change yaw/pitch/dolly by small increments.
   *   (These functions automatically clamp to valid ranges for desk mode.)
   */
  const mode = useCamera((s) => s.mode);
  const yaw = useCamera((s) => s.yaw);
  const pitch = useCamera((s) => s.pitch);
  const dolly = useCamera((s) => s.dolly);
  const orbitBy = useCamera((s) => s.orbitBy);
  const dollyBy = useCamera((s) => s.dollyBy);

  /**
   * 1) EFFECT: Apply the store's (yaw, pitch, dolly) to the actual three.js camera.
   *    - Whenever mode/yaw/pitch/dolly change, recompute camera.position and lookAt.
   *
   * Math recap (spherical-ish):
   * position = target
   *   + dolly * [ cos(pitch) * sin(yaw),  sin(pitch),  cos(pitch) * cos(yaw) ]
   */
  useEffect(() => {
    if (mode.kind !== "desk") return;

    const tx = DESK_TARGET.x;
    const ty = DESK_TARGET.y;
    const tz = DESK_TARGET.z;

    const px = tx + dolly * Math.cos(pitch) * Math.sin(yaw);
    const py = ty + dolly * Math.sin(pitch);
    const pz = tz + dolly * Math.cos(pitch) * Math.cos(yaw);

    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);

    // No cleanup needed here; we simply set camera values on each change.
  }, [camera, mode, yaw, pitch, dolly]);

  /**
   * Refs for simple drag handling:
   * - dragging: are we currently holding the mouse button down?
   * - lastX/lastY: where the pointer was on the previous move (to compute deltas).
   */
  const dragging = useRef(false);
  const lastX = useRef(0);
  const lastY = useRef(0);

  /**
   * 2) EFFECT: Set up mouse *wheel* to dolly (zoom in/out).
   * - We attach to the canvas element (gl.domElement).
   * - On wheel: positive deltaY usually means scroll down (zoom out),
   *   negative deltaY means scroll up (zoom in).
   *
   * NOTE: Always remove event listeners in the cleanup function to avoid leaks,
   * especially if components mount/unmount.
   */
  useEffect(() => {
    if (mode.kind !== "desk") return;

    const el = gl.domElement;

    function onWheel(e: WheelEvent) {
      // Small, consistent steps based on scroll direction
      const s = Math.sign(e.deltaY);
      dollyBy(s * DOLLY_STEP);
    }

    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl, mode, dollyBy]);

  /**
   * 3) EFFECT: Set up *drag to orbit*.
   * - Pointer down: begin dragging and record the start point.
   * - Pointer move: if dragging, compute movement delta and call orbitBy().
   * - Pointer up/leave: end dragging.
   *
   * Why Pointer Events?
   * - They unify mouse/touch/pen. For now we treat them like mouse; you can expand later.
   */
  useEffect(() => {
    if (mode.kind !== "desk") return;

    const el = gl.domElement;

    function onPointerDown(e: PointerEvent) {
      dragging.current = true;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
      // ensure we receive move events even if pointer leaves the element while pressed
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      const dy = e.clientY - lastY.current;
      lastX.current = e.clientX;
      lastY.current = e.clientY;

      // Convert pixels -> radians using ORBIT_SPEED
      // - horizontal drag adjusts yaw (left/right)
      // - vertical drag adjusts pitch (up/down), inverted so dragging up looks up
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

  /**
   * 4) OPTIONAL: Keep pose clamped even if something external changed it.
   * This demonstrates how clampPose() can be used defensively.
   * (Not strictly necessary because store actions already clamp.)
   */
  useEffect(() => {
    if (mode.kind !== "desk") return;
    const clamped = clampPose(mode, yaw, pitch, dolly);
    if (clamped.yaw !== yaw || clamped.pitch !== pitch || clamped.dolly !== dolly) {
      // setPose would be cleaner, but to avoid importing it we can use the actions we already have:
      // Adjust by the difference; this is rare in practice because our actions already clamp.
      orbitBy(clamped.yaw - yaw, clamped.pitch - pitch);
      dollyBy(clamped.dolly - dolly);
    }
  }, [mode, yaw, pitch, dolly, orbitBy, dollyBy]);

  // This component renders nothing visually; it only "drives" the camera.
  return null;
}
