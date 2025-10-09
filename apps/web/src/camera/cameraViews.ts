import * as THREE from 'three';

import type { LayoutFrame } from '@/state/layoutFrameStore';
import type { Surface } from '@/canvas/surfaces';
import { uvToWorld } from '@/canvas/math/plane';
import type { CameraClamps, CameraPose, ViewId } from './types';

export type CameraViewContext = {
  layoutFrame: LayoutFrame | null;
  layoutCameraTarget: [number, number, number] | null;
  screenSurface: Surface | null;
};

export type CameraViewConfig = {
  id: ViewId;
  label: string;
  clamps: CameraClamps;
  defaultPose: CameraPose;
  orbitSensitivity: { yaw: number; pitch: number };
  dollyStep: number;
  pointerEnabled: boolean;
  getTarget: (context: CameraViewContext) => [number, number, number] | null;
};

const WIDE_FALLBACK_TARGET: [number, number, number] = [0.1, 0.33, -0.35];

function resolveScreenTarget(surface: Surface | null): [number, number, number] | null {
  if (!surface) return null;
  const world = uvToWorld(0.5, 0.5, surface);
  return [world.x, world.y, world.z];
}

export const cameraViews: Record<ViewId, CameraViewConfig> = {
  wide: {
    id: 'wide',
    label: 'Wide View',
    clamps: {
      yaw: { min: (60 * Math.PI) / 180, max: (120 * Math.PI) / 180 }, // ±30° around yaw=90° (aligned with desk forward)
      pitch: { min: (-12 * Math.PI) / 180, max: (35 * Math.PI) / 180 }, // Increased max for 30° elevation
      dolly: { min: 2.7, max: 4.8 },
    },
    defaultPose: {
      yaw: THREE.MathUtils.degToRad(90), // Calculated from desk.forward alignment
      pitch: THREE.MathUtils.degToRad(30), // Matches CAMERA_DEFAULT_ELEVATION_DEG
      dolly: 3.8,
    },
    orbitSensitivity: { yaw: 0.003, pitch: 0.003 },
    dollyStep: 0.15,
    pointerEnabled: true,
    getTarget: ({ layoutCameraTarget, layoutFrame }) => {
      if (layoutCameraTarget) {
        return layoutCameraTarget;
      }
      if (layoutFrame) {
        return layoutFrame.center;
      }
      return WIDE_FALLBACK_TARGET;
    },
  },
  screen: {
    id: 'screen',
    label: 'Screen View',
    clamps: {
      // Full 360° yaw freedom allows camera to stay centered regardless of monitor rotation
      // TODO: Ideally this would be ±30° around the calculated monitor-facing direction,
      // but static clamps can't adapt to dynamic monitor orientation
      yaw: { min: -Math.PI, max: Math.PI }, // Full 360° freedom
      pitch: { min: (-30 * Math.PI) / 180, max: (45 * Math.PI) / 180 }, // Asymmetric: -30° down, +45° up
      dolly: { min: 0.5, max: 3.0 }, // Wider range for different screen sizes
    },
    defaultPose: {
      // Placeholder values - overridden by solveScreenCamera() based on actual monitor orientation
      yaw: THREE.MathUtils.degToRad(-10),
      pitch: THREE.MathUtils.degToRad(-4),
      dolly: 1.7,
    },
    orbitSensitivity: { yaw: 0.0025, pitch: 0.0025 },
    dollyStep: 0.1,
    pointerEnabled: true,
    getTarget: ({ screenSurface }) => {
      return resolveScreenTarget(screenSurface);
    },
  },
};

export function getViewConfig(viewId: ViewId): CameraViewConfig {
  return cameraViews[viewId];
}

export const WIDE_FALLBACK = WIDE_FALLBACK_TARGET;
