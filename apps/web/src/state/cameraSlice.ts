"use client";

import { create } from "zustand";
import type { SurfaceId } from '@/canvas/surfaces';
import { cameraViews } from '@/camera/cameraViews';
import type { CameraPose, ViewId } from '@/camera/types';
import { isInMarkingMode } from './deskBoundsStore';

/**
 * Camera modes:
 * - "wide": free-orbit around a target that keeps desk + monitor visible
 * - "screen": constrained orbit around the selected screen surface center
 */
export type CameraMode =
  | { kind: "wide" }
  | { kind: "screen"; surfaceId: SurfaceId };

function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}

function clampPoseForKind(viewId: ViewId, pose: CameraPose): CameraPose {
  const clamps = cameraViews[viewId].clamps;

  // Widen pitch range during bounds marking mode for better top-down view
  const pitchMin = (isInMarkingMode() && viewId === "wide") ? (-85 * Math.PI) / 180 : clamps.pitch.min;
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
  const key: ViewId = mode.kind === "wide" ? "wide" : "screen";
  return clampPoseForKind(key, { yaw, pitch, dolly });
}

type CameraState = {
  mode: CameraMode;
  yaw: number;
  pitch: number;
  dolly: number;
  defaults: Record<ViewId, CameraPose>;
  setMode: (mode: CameraMode) => void;
  setPose: (p: Partial<Pick<CameraState, "yaw" | "pitch" | "dolly">>) => void;
  orbitBy: (dYaw: number, dPitch: number) => void;
  dollyBy: (d: number) => void;
  resetPose: () => void;
  setDefaultPose: (view: ViewId, pose: CameraPose) => void;
};

const STATIC_DEFAULTS: Record<ViewId, CameraPose> = {
  wide: { ...cameraViews.wide.defaultPose },
  screen: { ...cameraViews.screen.defaultPose },
};

const INITIAL_STATE: Pick<CameraState, "mode" | "yaw" | "pitch" | "dolly" | "defaults"> = {
  mode: { kind: "wide" },
  yaw: STATIC_DEFAULTS.wide.yaw,
  pitch: STATIC_DEFAULTS.wide.pitch,
  dolly: STATIC_DEFAULTS.wide.dolly,
  defaults: {
    wide: { ...STATIC_DEFAULTS.wide },
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
    const pose = mode.kind === "wide" ? defaults.wide : defaults.screen;
    set({ yaw: pose.yaw, pitch: pose.pitch, dolly: pose.dolly });
  },

  setDefaultPose: (view, pose) => {
    const clamped = clampPoseForKind(view, pose);
    set((state) => ({
      defaults: {
        ...state.defaults,
        [view]: clonePose(clamped),
      },
    }));
  },
}));
