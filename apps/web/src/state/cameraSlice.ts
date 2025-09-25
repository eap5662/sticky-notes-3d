"use client";

import { create } from "zustand";

/**
 * Camera modes:
 * - "desk": free-orbit around a target that keeps desk + monitor visible
 * - "screen": constrained orbit around the selected screen surface center
 */
export type CameraMode =
  | { kind: "desk" }
  | { kind: "screen"; surfaceId: "monitor1" };

/**
 * One place to tune clamped ranges for each mode.
 * All angles are in radians; dolly is a distance in world units (meters).
 *
 * Notes:
 * - Keep desk yaw wide so both planes remain visible.
 * - Keep screen yaw/pitch narrow so the monitor mostly fills the frame.
 */
export const CAMERA_CLAMPS = {
  desk: {
    yaw: { min: (-45 * Math.PI) / 180, max: (45 * Math.PI) / 180 },
    pitch: { min: (-10 * Math.PI) / 180, max: (20 * Math.PI) / 180 },
    dolly: { min: 1.8, max: 3.4 },
  },
  screen: {
    yaw: { min: (-15 * Math.PI) / 180, max: (15 * Math.PI) / 180 },
    pitch: { min: (-10 * Math.PI) / 180, max: (10 * Math.PI) / 180 },
    dolly: { min: 0.5, max: 1.2 }, // ~70–85% screen fill
  },
} as const;

/**
 * Clamp a scalar into [min, max].
 */
function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}

/**
 * Apply the correct clamp set for a given mode to (yaw, pitch, dolly).
 * Returns a new triple — pure function, no state mutation here.
 */
export function clampPose(
  mode: CameraMode,
  yaw: number,
  pitch: number,
  dolly: number
) {
  const key = mode.kind === "desk" ? "desk" : "screen";
  const c = CAMERA_CLAMPS[key];
  return {
    yaw: clamp(yaw, c.yaw.min, c.yaw.max),
    pitch: clamp(pitch, c.pitch.min, c.pitch.max),
    dolly: clamp(dolly, c.dolly.min, c.dolly.max),
  };
}

type CameraState = {
  // Current mode (which also selects which clamp set we use)
  mode: CameraMode;

  // Spherical-ish camera parameters around an implicit target
  // (controllers decide exact target point).
  yaw: number;   // left/right
  pitch: number; // up/down
  dolly: number; // distance from target

  /**
   * Switch camera mode. Also clamps pose to the new mode's ranges
   * (so a wide desk yaw can't carry into narrow screen yaw).
   */
  setMode: (mode: CameraMode) => void;

  /**
   * Patch any of yaw/pitch/dolly, auto-clamping to current mode.
   */
  setPose: (p: Partial<Pick<CameraState, "yaw" | "pitch" | "dolly">>) => void;

  /**
   * Incrementally orbit by deltas, then clamp.
   * Useful for mouse/touch drag handlers.
   */
  orbitBy: (dYaw: number, dPitch: number) => void;

  /**
   * Incrementally dolly by a delta, then clamp.
   * Useful for wheel/pinch handlers.
   */
  dollyBy: (d: number) => void;

  /**
   * Reset to a sensible pose for the active mode.
   * Good for ESC/backdrop or “recenter” UX.
   */
  resetPose: () => void;
};

/**
 * Reasonable defaults for first render.
 * - Desk pose: slightly pitched down, moderate distance.
 */
const INITIAL_STATE: Omit<CameraState, "setMode" | "setPose" | "orbitBy" | "dollyBy" | "resetPose"> = {
  mode: { kind: "desk" },
  yaw: 0,
  pitch: (-10 * Math.PI) / 180,
  dolly: 2.5,
};

/**
 * Provide a sane, mode-specific default pose.
 * You can tune these without touching controller code.
 */
function defaultPoseFor(mode: CameraMode) {
  if (mode.kind === "desk") {
    return clampPose(mode, 0, (-10 * Math.PI) / 180, 2.5);
  }
  // screen
  return clampPose(mode, 0, 0, 0.9);
}

/**
 * Zustand store: central camera state + small set of ergonomic actions.
 * Controllers subscribe to this and translate it into actual camera transforms.
 */
export const useCamera = create<CameraState>((set, get) => ({
  ...INITIAL_STATE,

  setMode: (mode) => {
    const { yaw, pitch, dolly } = get();
    const clamped = clampPose(mode, yaw, pitch, dolly);
    set({ mode, ...clamped });
  },

  setPose: (patch) => {
    const { mode, yaw, pitch, dolly } = get();
    const next = {
      yaw: patch.yaw ?? yaw,
      pitch: patch.pitch ?? pitch,
      dolly: patch.dolly ?? dolly,
    };
    set(clampPose(mode, next.yaw, next.pitch, next.dolly));
  },

  orbitBy: (dYaw, dPitch) => {
    const { mode, yaw, pitch, dolly } = get();
    set(clampPose(mode, yaw + dYaw, pitch + dPitch, dolly));
  },

  dollyBy: (d) => {
    const { mode, yaw, pitch, dolly } = get();
    set(clampPose(mode, yaw, pitch, dolly + d));
  },

  resetPose: () => {
    const { mode } = get();
    set(defaultPoseFor(mode));
  },
}));
