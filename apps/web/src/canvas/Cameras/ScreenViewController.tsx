"use client";
/**
 * ScreenViewController
 * --------------------
 * Controls the camera while you're in the "screen" mode (close-up of a monitor surface).
 *
 * ðŸ” How this compares to DeskViewController:
 * - SAME: It's a behavior-only component (returns null), uses React Three Fiber hooks,
 *   subscribes to the same Zustand store (yaw/pitch/dolly), and attaches wheel + drag events.
 * - DIFFERENT:
 *   1) Target point is *dynamic*: the center of the selected screen surface
 *      (computed via uvToWorld(0.5, 0.5, surface)).
 *   2) Motion ranges are narrower (handled by the store clamps for screen mode),
 *      so orbit/zoom feels tighter and the screen fills most of the viewport.
 *   3) Slightly smaller sensitivity defaults so close-up movement feels controllable.
 */

import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { useCamera, clampPose } from "@/state/cameraSlice";
import { getSurface } from "@/canvas/surfaces";
import { uvToWorld } from "@/canvas/math/plane";

/**
 * Sensitivity constants for *screen* mode.
 * We keep these a bit gentler than desk mode because you're closer to the subject.
 */
const ORBIT_SPEED = 0.0025; // radians per px (slower than desk)
const DOLLY_STEP = 0.1;    // meters per wheel notch (smaller than desk)

export default function ScreenViewController() {
  /**
   * Low-level three.js objects from R3F:
   * - camera: the active PerspectiveCamera we move
   * - gl.domElement: the canvas element we attach listeners to
   */
  const { camera, gl } = useThree();

  /**
   * Zustand store selections:
   * - We only act when mode.kind === "screen".
   * - surfaceId tells us which monitor we're locking onto (e.g., "monitor1").
   * - yaw/pitch/dolly define the pose around that monitor's center.
   */
  const mode = useCamera((s) => s.mode);
  const yaw = useCamera((s) => s.yaw);
  const pitch = useCamera((s) => s.pitch);
  const dolly = useCamera((s) => s.dolly);
  const orbitBy = useCamera((s) => s.orbitBy);
  const dollyBy = useCamera((s) => s.dollyBy);

  /**
   * Desk used a fixed target (DESK_TARGET). Here the target is dynamic:
   *   - We read the Surface by id.
   *   - We convert (u=0.5, v=0.5) to world coordinates for the *center of the screen*.
   *   - useMemo caches the result until mode.surfaceId changes.
   */
  const target = useMemo(() => {
    if (mode.kind !== "screen") return null;
    const s = getSurface(mode.surfaceId);
    return uvToWorld(0.5, 0.5, s); // world-space center of the monitor plane
  }, [mode]); //depends on mode

  /**
   * EFFECT 1: Apply (yaw, pitch, dolly) to the camera, looking at the dynamic target.
   * ðŸ” VS Desk: Same math, different target point (here: monitor center).
   */
  useEffect(() => {
    if (mode.kind !== "screen" || !target) return;

    const { x: tx, y: ty, z: tz } = target;

    const px = tx + dolly * Math.cos(pitch) * Math.sin(yaw);
    const py = ty + dolly * Math.sin(pitch);
    const pz = tz + dolly * Math.cos(pitch) * Math.cos(yaw);

    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
  }, [camera, mode, yaw, pitch, dolly, target]); //array of dependencies

  /**
   * Refs for simple drag handling (identical pattern to Desk):
   * - dragging: whether we're in a drag
   * - lastX/lastY: last pointer pos to compute deltas
   */
  const dragging = useRef(false);
  const lastX = useRef(0);
  const lastY = useRef(0);

  /**
   * EFFECT 2: Wheel to dolly (zoom).
   * ðŸ” VS Desk: Same listener pattern, smaller DOLLY_STEP for finer control.
   */
  useEffect(() => {
    if (mode.kind !== "screen") return;
    const el = gl.domElement;

    function onWheel(e: WheelEvent) {
      const s = Math.sign(e.deltaY);
      dollyBy(s * DOLLY_STEP); // store enforces screen-mode clamps
    }

    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl, mode, dollyBy]);

  /**
   * EFFECT 3: Drag to orbit.
   * ðŸ” VS Desk: Same event wiring, same mapping of dx->yaw and dy->pitch,
   *   but ORBIT_SPEED is reduced for tighter control in close-up view.
   */
  useEffect(() => {
    if (mode.kind !== "screen") return;

    const el = gl.domElement;

    function onPointerDown(e: PointerEvent) {
      dragging.current = true;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current; //delta x from 2 pointers
      const dy = e.clientY - lastY.current;
      lastX.current = e.clientX;
      lastY.current = e.clientY;

      orbitBy(dx * ORBIT_SPEED, -dy * ORBIT_SPEED); //this orbits the camera
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
   * EFFECT 4 (optional): Defensive clamping.
   * ðŸ” VS Desk: Same idea. The store actions already clamp; this just guards
   * against any external changes that might bypass actions.
   */
  useEffect(() => {
    if (mode.kind !== "screen") return;
    if (!target) return;

    const clamped = clampPose(mode, yaw, pitch, dolly);
    const needAdjust =
      clamped.yaw !== yaw || clamped.pitch !== pitch || clamped.dolly !== dolly;

    if (needAdjust) {
      orbitBy(clamped.yaw - yaw, clamped.pitch - pitch);
      dollyBy(clamped.dolly - dolly);
    }
  }, [mode, target, yaw, pitch, dolly, orbitBy, dollyBy]);

  // Behavior component: nothing to render.
  return null;
}
