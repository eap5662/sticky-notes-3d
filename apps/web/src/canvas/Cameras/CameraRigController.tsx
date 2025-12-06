import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import CameraControlsImpl from 'camera-controls';

import { useCamera } from '@/state/cameraSlice';
import { useLayoutFrameState } from '@/canvas/hooks/useLayoutFrame';
import { useSurfacesByKind } from '@/canvas/hooks/useSurfaces';
import { getSurfaceOrNull } from '@/canvas/surfaces';
import type { CameraPose, ViewId } from '@/camera/types';
import { cameraViews, getViewConfig } from '@/camera/cameraViews';
import { isCameraOrbitLocked, subscribeCameraOrbit } from '@/state/cameraInteractionStore';

CameraControlsImpl.install({ THREE });

const tmpVec = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();

function poseToPosition(target: [number, number, number], pose: CameraPose): [number, number, number] {
  const [tx, ty, tz] = target;
  const { yaw, pitch, dolly } = pose;
  const px = tx + dolly * Math.cos(pitch) * Math.sin(yaw);
  const py = ty + dolly * Math.sin(pitch);
  const pz = tz + dolly * Math.cos(pitch) * Math.cos(yaw);
  return [px, py, pz];
}

function extractPose(position: THREE.Vector3, target: THREE.Vector3): CameraPose {
  const delta = tmpVec.copy(position).sub(target);
  const dolly = delta.length();
  if (dolly < 1e-6) {
    return { yaw: 0, pitch: 0, dolly: 0 };
  }
  const pitch = Math.asin(THREE.MathUtils.clamp(delta.y / dolly, -1, 1));
  const yaw = Math.atan2(delta.x, delta.z);
  return { yaw, pitch, dolly };
}

function getScreenSurface(mode: ReturnType<typeof useCamera>['mode'], surfaces: ReturnType<typeof useSurfacesByKind>) {
  if (mode.kind !== 'screen') return null;
  const explicit = mode.surfaceId ? getSurfaceOrNull(mode.surfaceId) : null;
  if (explicit) return explicit;
  const fallback = surfaces[0];
  if (!fallback) return null;
  return getSurfaceOrNull(fallback.id) ?? null;
}

export default function CameraRigController() {
  const { camera, gl } = useThree();
  const layoutState = useLayoutFrameState();
  const screenSurfaces = useSurfacesByKind('screen');

  const mode = useCamera((s) => s.mode);
  const yaw = useCamera((s) => s.yaw);
  const pitch = useCamera((s) => s.pitch);
  const dolly = useCamera((s) => s.dolly);
  const defaults = useCamera((s) => s.defaults);
  const setPose = useCamera((s) => s.setPose);

  const controlsRef = useRef<CameraControlsImpl | null>(null);
  const suppressStoreUpdate = useRef(false);
  const previousViewRef = useRef<ViewId | null>(null);
  const lastTargetRef = useRef<[number, number, number] | null>(null);

  const activeViewId: ViewId = mode.kind === 'wide' ? 'wide' : 'screen';
  const viewConfig = getViewConfig(activeViewId);

  const screenSurface = useMemo(() => getScreenSurface(mode, screenSurfaces), [mode, screenSurfaces]);

  const target = useMemo<[number, number, number]>(() => {
    const context = {
      layoutFrame: layoutState.frame,
      layoutCameraTarget: layoutState.cameraTarget,
      screenSurface,
    };

    return (
      viewConfig.getTarget(context) ??
      cameraViews.wide.getTarget(context) ??
      [0, 0, 0]
    );
  }, [viewConfig, layoutState.frame, layoutState.cameraTarget, screenSurface]);

  useEffect(() => {
    const controls = new CameraControlsImpl(camera, gl.domElement);
    controls.dollyToCursor = false;
    controls.smoothTime = 0.2;
    controls.draggingSmoothTime = 0.05;
    controlsRef.current = controls;

    return () => {
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const { clamps, pointerEnabled } = viewConfig;

    // For screen view, apply dynamic yaw clamps centered around the calculated screen pose
    if (activeViewId === 'screen') {
      const screenPose = defaults.screen;
      const clampRange = (30 * Math.PI) / 180; // ±30°
      controls.minAzimuthAngle = screenPose.yaw - clampRange;
      controls.maxAzimuthAngle = screenPose.yaw + clampRange;
    } else {
      controls.minAzimuthAngle = clamps.yaw.min;
      controls.maxAzimuthAngle = clamps.yaw.max;
    }

    controls.minPolarAngle = Math.PI / 2 - clamps.pitch.max;
    controls.maxPolarAngle = Math.PI / 2 - clamps.pitch.min;
    controls.minDistance = clamps.dolly.min;
    controls.maxDistance = clamps.dolly.max;
    controls.enableRotate = pointerEnabled;
    controls.enableZoom = pointerEnabled;
    controls.enablePan = false;
  }, [viewConfig, activeViewId, defaults]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const handleUpdate = () => {
      if (suppressStoreUpdate.current) return;
      controls.getTarget(tmpTarget);
      const pose = extractPose(controls.camera.position, tmpTarget);
      setPose(pose);
    };

    controls.addEventListener('update', handleUpdate);
    return () => {
      controls.removeEventListener('update', handleUpdate);
    };
  }, [setPose]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const syncEnabled = () => {
      controls.enabled = !isCameraOrbitLocked();
    };

    syncEnabled();
    const unsubscribe = subscribeCameraOrbit(syncEnabled);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const currentView = activeViewId;
    const lastView = previousViewRef.current;
    const lastTarget = lastTargetRef.current;
    const targetChanged = !lastTarget || Math.hypot(target[0] - lastTarget[0], target[1] - lastTarget[1], target[2] - lastTarget[2]) > 1e-4;

    // Check if we should update camera position
    const viewChanged = currentView !== lastView;
    const shouldUpdate = viewChanged || targetChanged;

    if (shouldUpdate) {
      // When view changes or target changes, use the default pose for the new view
      // Otherwise stay at current pose (user might have orbited)
      const desiredPose =
        viewChanged || targetChanged
          ? defaults[currentView] ?? { yaw, pitch, dolly }
          : { yaw, pitch, dolly };

      const [px, py, pz] = poseToPosition(target, desiredPose);

      suppressStoreUpdate.current = true;
      controls
        .setLookAt(px, py, pz, target[0], target[1], target[2], true)
        .then(() => {
          suppressStoreUpdate.current = false;
          controls.getTarget(tmpTarget);
          const finalPose = extractPose(controls.camera.position, tmpTarget);
          setPose(finalPose);
        })
        .catch(() => {
          suppressStoreUpdate.current = false;
        });

      previousViewRef.current = currentView;
      lastTargetRef.current = target;
    }
  }, [activeViewId, defaults, target, yaw, pitch, dolly, setPose]);

  useFrame((_, delta) => {
    controlsRef.current?.update(delta);
  });

  return null;
}
