import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { CAMERA_CLAMPS, useCamera } from "@/state/cameraSlice";
import type { SurfaceMeta } from "@/state/surfaceMetaStore";
import type { GenericPropBounds } from "@/state/genericPropsStore";
import { useSurfaceMeta, useSurfacesByKind } from "./useSurfaces";
import {
  setLayoutState,
  type LayoutFrame,
  type LayoutPose,
} from "@/state/layoutFrameStore";
import { useLayoutFrameState } from "./useLayoutFrame";
import { getGenericPropsSnapshot } from "@/state/genericPropsStore";
import { useGenericProps } from "./useGenericProps";

const DEFAULT_CAMERA_FOV_DEG = 48;
const CAMERA_RADIUS_MARGIN = 1.12;
const CAMERA_DEFAULT_AZIMUTH_DEG = 24;
const CAMERA_DEFAULT_ELEVATION_DEG = 18;
const CAMERA_TARGET_FORWARD_OFFSET = 0.05;
const CAMERA_TARGET_RIGHT_OFFSET = -0.08;
const CAMERA_TARGET_UP_OFFSET = 0.18;
const SNAP_EPS = 1e-6;

function toVec3(tuple: readonly number[]) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

function toTuple(vec: THREE.Vector3): [number, number, number] {
  return [vec.x, vec.y, vec.z];
}

function collectCorners(box: THREE.Box3) {
  const corners: THREE.Vector3[] = [];
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      for (let z = 0; z <= 1; z++) {
        corners.push(
          new THREE.Vector3(
            x ? box.max.x : box.min.x,
            y ? box.max.y : box.min.y,
            z ? box.max.z : box.min.z,
          ),
        );
      }
    }
  }
  return corners;
}

function boundsToBox(bounds: GenericPropBounds) {
  return new THREE.Box3(
    new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]),
    new THREE.Vector3(bounds.max[0], bounds.max[1], bounds.max[2]),
  );
}

function boundingRadius(box: THREE.Box3, center: THREE.Vector3) {
  const corners = collectCorners(box);
  let max = 0;
  for (const corner of corners) {
    max = Math.max(max, corner.distanceTo(center));
  }
  return max;
}

function clampScalar(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildLayoutFrame(meta: SurfaceMeta, bounds: GenericPropBounds): LayoutFrame {
  const up = toVec3(meta.normal).normalize();
  const right = toVec3(meta.uDir).normalize();
  const forward = new THREE.Vector3().crossVectors(right, up).normalize();
  right.copy(new THREE.Vector3().crossVectors(up, forward)).normalize();

  return {
    center: [meta.center[0], meta.center[1], meta.center[2]],
    up: toTuple(up),
    right: toTuple(right),
    forward: toTuple(forward),
    extents: { ...meta.extents },
    bounds: {
      min: [bounds.min[0], bounds.min[1], bounds.min[2]],
      max: [bounds.max[0], bounds.max[1], bounds.max[2]],
    },
  };
}

function solveCamera(
  frame: LayoutFrame,
  deskBounds: GenericPropBounds,
): { target: [number, number, number]; pose: LayoutPose } {
  const forward = toVec3(frame.forward);
  const right = toVec3(frame.right);
  const up = toVec3(frame.up);

  // Include all generic props in camera framing
  const combinedBounds = boundsToBox(deskBounds);
  const genericProps = getGenericPropsSnapshot();
  for (const prop of genericProps) {
    if (prop.bounds) {
      combinedBounds.union(boundsToBox(prop.bounds));
    }
  }
  const contentCenter = combinedBounds.getCenter(new THREE.Vector3());

  const target = contentCenter
    .clone()
    .add(up.clone().multiplyScalar(CAMERA_TARGET_UP_OFFSET))
    .add(forward.clone().multiplyScalar(CAMERA_TARGET_FORWARD_OFFSET))
    .add(right.clone().multiplyScalar(CAMERA_TARGET_RIGHT_OFFSET));

  const azimuth = THREE.MathUtils.degToRad(CAMERA_DEFAULT_AZIMUTH_DEG);
  const elevation = THREE.MathUtils.degToRad(CAMERA_DEFAULT_ELEVATION_DEG);

  const horizontal = forward
    .clone()
    .multiplyScalar(-Math.cos(azimuth))
    .add(right.clone().multiplyScalar(Math.sin(azimuth)));

  if (horizontal.lengthSq() <= SNAP_EPS) {
    horizontal.copy(forward).multiplyScalar(-1);
  } else {
    horizontal.normalize();
  }

  const direction = horizontal
    .clone()
    .multiplyScalar(Math.cos(elevation))
    .add(up.clone().multiplyScalar(Math.sin(elevation)))
    .normalize();

  const yaw = Math.atan2(direction.x, direction.z);
  const pitch = Math.asin(direction.y);

  const radius = boundingRadius(combinedBounds, target);
  const fov = THREE.MathUtils.degToRad(DEFAULT_CAMERA_FOV_DEG);
  let dolly = radius <= 0 ? 3.6 : (radius / Math.tan(fov / 2)) * CAMERA_RADIUS_MARGIN;
  const { min, max } = CAMERA_CLAMPS.desk.dolly;
  dolly = clampScalar(dolly, min, max);

  return {
    target: toTuple(target),
    pose: {
      yaw,
      pitch,
      dolly,
    },
  };
}

function posesApproximatelyEqual(a: LayoutPose, b: LayoutPose, eps = 1e-3) {
  return (
    Math.abs(a.yaw - b.yaw) <= eps &&
    Math.abs(a.pitch - b.pitch) <= eps &&
    Math.abs(a.dolly - b.dolly) <= eps
  );
}

export function useAutoLayout() {
  const genericProps = useGenericProps();

  // Find desk by querying generic props for desk catalog ID
  const deskProp = useMemo(() => {
    return genericProps.find(p => p.catalogId === 'desk-default');
  }, [genericProps]);

  // Get desk surface by kind (reactively subscribes to surface changes)
  const deskSurfaces = useSurfacesByKind('desk');
  const deskSurfaceId = deskSurfaces[0]?.id;
  const deskMeta = useSurfaceMeta(deskSurfaceId ?? '');
  const deskBounds = deskProp?.bounds ?? null;

  useEffect(() => {
    if (!deskMeta || !deskBounds) {
      setLayoutState({
        status: deskMeta || deskBounds ? "pending" : "idle",
        frame: null,
        cameraTarget: null,
        deskPose: null,
      });
      return;
    }

    const frame = buildLayoutFrame(deskMeta, deskBounds);
    const cameraSolution = solveCamera(frame, deskBounds);

    setLayoutState({
      status: "ready",
      frame,
      cameraTarget: cameraSolution.target,
      deskPose: cameraSolution.pose,
    });

    const cameraStore = useCamera.getState();
    const previousDeskDefault = cameraStore.defaults.desk;
    if (!posesApproximatelyEqual(previousDeskDefault, cameraSolution.pose, 1e-4)) {
      cameraStore.setDefaultPose("desk", cameraSolution.pose);
      if (cameraStore.mode.kind === "desk") {
        const currentPose: LayoutPose = {
          yaw: cameraStore.yaw,
          pitch: cameraStore.pitch,
          dolly: cameraStore.dolly,
        };
        if (posesApproximatelyEqual(currentPose, previousDeskDefault, 2e-3)) {
          cameraStore.setPose(cameraSolution.pose);
        }
      }
    }
  }, [deskMeta, deskBounds]);

  return useLayoutFrameState();
}

