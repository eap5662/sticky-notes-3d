"use client";

import { create } from "zustand";
import * as THREE from "three";

import type { SurfaceId } from '@/canvas/surfaces';
import { isInMarkingMode } from './deskBoundsStore';

/**
 * Camera modes:
 * - "desk": free-orbit around a target that keeps desk + monitor visible
 * - "screen": constrained orbit around the selected screen surface center
 */
export type CameraMode =
  | { kind: "desk" }
  | { kind: "screen"; surfaceId: SurfaceId };

export type CameraPose = {
  yaw: number;
  pitch: number;
  dolly: number;
};

/**
 * One place to tune clamped ranges for each mode.
 * All angles are in radians; dolly is a distance in world units (meters).
 */
export const CAMERA_CLAMPS = {
  desk: {
    yaw: { min: (-45 * Math.PI) / 180, max: (45 * Math.PI) / 180 },
    pitch: { min: (-12 * Math.PI) / 180, max: (22 * Math.PI) / 180 },
    dolly: { min: 2.7, max: 4.8 },
  },
  screen: {
    yaw: { min: (-18 * Math.PI) / 180, max: (18 * Math.PI) / 180 },
    pitch: { min: (-12 * Math.PI) / 180, max: (12 * Math.PI) / 180 },
    dolly: { min: 1.0, max: 2.2 },
  },
} as const;

function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}

function clampPoseForKind(kind: "desk" | "screen", pose: CameraPose): CameraPose {
  const clamps = CAMERA_CLAMPS[kind];

  // Widen pitch range during bounds marking mode for better top-down view
  const pitchMin = (isInMarkingMode() && kind === "desk") ? (-85 * Math.PI) / 180 : clamps.pitch.min;
  const pitchMax = clamps.pitch.max;

  return {
    yaw: clamp(pose.yaw, clamps.yaw.min, clamps.yaw.max),
    pitch: clamp(pose.pitch, pitchMin, pitchMax),
    dolly: clamp(pose.dolly, clamps.dolly.min, clamps.dolly.max),
  };
}

/**
 * Apply the correct clamp set for a given mode to (yaw, pitch, dolly).
 * Returns a new triple - pure function, no state mutation here.
 */
export function clampPose(
  mode: CameraMode,
  yaw: number,
  pitch: number,
  dolly: number
): CameraPose {
  const key = mode.kind === "desk" ? "desk" : "screen";
  return clampPoseForKind(key, { yaw, pitch, dolly });
}

type CameraState = {
  mode: CameraMode;
  yaw: number;
  pitch: number;
  dolly: number;
  defaults: {
    desk: CameraPose;
    screen: CameraPose;
  };
  setMode: (mode: CameraMode) => void;
  setPose: (p: Partial<Pick<CameraState, "yaw" | "pitch" | "dolly">>) => void;
  orbitBy: (dYaw: number, dPitch: number) => void;
  dollyBy: (d: number) => void;
  resetPose: () => void;
  setDefaultPose: (kind: CameraMode["kind"], pose: CameraPose) => void;
};

const STATIC_DEFAULTS: { desk: CameraPose; screen: CameraPose } = {
  desk: {
    yaw: THREE.MathUtils.degToRad(22),
    pitch: THREE.MathUtils.degToRad(6),
    dolly: 3.8,
  },
  screen: {
    yaw: THREE.MathUtils.degToRad(-10),
    pitch: THREE.MathUtils.degToRad(-4),
    dolly: 1.7,
  },
};

const INITIAL_STATE: Pick<CameraState, "mode" | "yaw" | "pitch" | "dolly" | "defaults"> = {
  mode: { kind: "desk" },
  yaw: STATIC_DEFAULTS.desk.yaw,
  pitch: STATIC_DEFAULTS.desk.pitch,
  dolly: STATIC_DEFAULTS.desk.dolly,
  defaults: {
    desk: { ...STATIC_DEFAULTS.desk },
    screen: { ...STATIC_DEFAULTS.screen },
  },
};

function clonePose(pose: CameraPose): CameraPose {
  return { yaw: pose.yaw, pitch: pose.pitch, dolly: pose.dolly };
}

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
    const { mode, defaults } = get();
    const pose = mode.kind === "desk" ? defaults.desk : defaults.screen;
    set({ yaw: pose.yaw, pitch: pose.pitch, dolly: pose.dolly });
  },

  setDefaultPose: (kind, pose) => {
    const clamped = clampPoseForKind(kind === "desk" ? "desk" : "screen", pose);
    set((state) => ({
      defaults: {
        ...state.defaults,
        [kind === "desk" ? "desk" : "screen"]: clonePose(clamped),
      },
    }));
  },
}));
