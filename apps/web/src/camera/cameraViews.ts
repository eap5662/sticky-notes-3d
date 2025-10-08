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
      yaw: { min: (-45 * Math.PI) / 180, max: (45 * Math.PI) / 180 },
      pitch: { min: (-12 * Math.PI) / 180, max: (22 * Math.PI) / 180 },
      dolly: { min: 2.7, max: 4.8 },
    },
    defaultPose: {
      yaw: THREE.MathUtils.degToRad(22),
      pitch: THREE.MathUtils.degToRad(6),
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
      yaw: { min: (-18 * Math.PI) / 180, max: (18 * Math.PI) / 180 },
      pitch: { min: (-12 * Math.PI) / 180, max: (12 * Math.PI) / 180 },
      dolly: { min: 1.0, max: 2.2 },
    },
    defaultPose: {
      yaw: THREE.MathUtils.degToRad(-10),
      pitch: THREE.MathUtils.degToRad(-4),
      dolly: 1.7,
    },
    orbitSensitivity: { yaw: 0.0025, pitch: 0.0025 },
    dollyStep: 0.1,
    pointerEnabled: true,
    getTarget: ({ screenSurface }) => {
      const target = resolveScreenTarget(screenSurface);
      if (!target) return null;
      return target;
    },
  },
};

export function getViewConfig(viewId: ViewId): CameraViewConfig {
  return cameraViews[viewId];
}

export const WIDE_FALLBACK = WIDE_FALLBACK_TARGET;
