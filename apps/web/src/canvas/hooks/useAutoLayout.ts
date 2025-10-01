import { useEffect, useRef } from "react";
import * as THREE from "three";

import { CAMERA_CLAMPS, useCamera } from "@/state/cameraSlice";
import type { SurfaceMeta } from "@/state/surfaceMetaStore";
import type { PropBounds } from "@/state/propBoundsStore";
import { useSurface, useSurfaceMeta } from "./useSurfaces";
import { usePropBounds } from "./usePropBounds";
import { usePropScale } from "./usePropScale";
import { useLayoutOverridesState } from "./useLayoutOverrides";
import {
  setLayoutState,
  peekLayoutState,
  type LayoutFrame,
  type MonitorPlacement,
  type LayoutPose,
} from "@/state/layoutFrameStore";
import { useLayoutFrameState } from "./useLayoutFrame";
import type { Surface } from "@/canvas/surfaces";

const DEFAULT_CAMERA_FOV_DEG = 48;
const CAMERA_RADIUS_MARGIN = 1.12;
const CAMERA_DEFAULT_AZIMUTH_DEG = 24;
const CAMERA_DEFAULT_ELEVATION_DEG = 18;
const CAMERA_TARGET_FORWARD_OFFSET = 0.05;
const CAMERA_TARGET_RIGHT_OFFSET = -0.08;
const CAMERA_TARGET_UP_OFFSET = 0.18;
const MONITOR_CLEARANCE = 0.0015;
const EDGE_MARGIN = 0.012;
const SNAP_EPS = 1e-6;
const STATE_EPS = 1e-4;

function toVec3(tuple: readonly number[]) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

function toTuple(vec: THREE.Vector3): [number, number, number] {
  return [vec.x, vec.y, vec.z];
}

function cloneMeta(meta: SurfaceMeta | null): SurfaceMeta | null {
  if (!meta) return null;
  return {
    center: [...meta.center] as SurfaceMeta["center"],
    normal: [...meta.normal] as SurfaceMeta["normal"],
    uDir: [...meta.uDir] as SurfaceMeta["uDir"],
    vDir: [...meta.vDir] as SurfaceMeta["vDir"],
    extents: { ...meta.extents },
  };
}

function cloneBounds(bounds: PropBounds | null): PropBounds | null {
  if (!bounds) return null;
  return {
    min: [...bounds.min] as PropBounds["min"],
    max: [...bounds.max] as PropBounds["max"],
  };
}

function hasNonUnitScale(scale: readonly number[], epsilon = 1e-4) {
  return (
    Math.abs(scale[0] - 1) > epsilon ||
    Math.abs(scale[1] - 1) > epsilon ||
    Math.abs(scale[2] - 1) > epsilon
  );
}

function scaleBoundsFromFoot(bounds: PropBounds, scale: readonly number[]): PropBounds {
  const anchorX = (bounds.min[0] + bounds.max[0]) / 2;
  const anchorY = bounds.min[1];
  const anchorZ = (bounds.min[2] + bounds.max[2]) / 2;

  const scaleAxis = (value: number, anchor: number, factor: number) => anchor + (value - anchor) * factor;

  return {
    min: [
      scaleAxis(bounds.min[0], anchorX, scale[0]),
      scaleAxis(bounds.min[1], anchorY, scale[1]),
      scaleAxis(bounds.min[2], anchorZ, scale[2]),
    ],
    max: [
      scaleAxis(bounds.max[0], anchorX, scale[0]),
      scaleAxis(bounds.max[1], anchorY, scale[1]),
      scaleAxis(bounds.max[2], anchorZ, scale[2]),
    ],
  };
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

function boundsToBox(bounds: PropBounds) {
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

function spanAlongAxis(bounds: PropBounds, axis: THREE.Vector3) {
  const box = boundsToBox(bounds);
  const corners = collectCorners(box);
  let min = Infinity;
  let max = -Infinity;
  for (const corner of corners) {
    const dot = corner.dot(axis);
    min = Math.min(min, dot);
    max = Math.max(max, dot);
  }
  return { min, max };
}

function boundsCenter(bounds: PropBounds) {
  return new THREE.Vector3(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  );
}

function extremalPoint(bounds: PropBounds, direction: THREE.Vector3, pick: "min" | "max") {
  const box = boundsToBox(bounds);
  const corners = collectCorners(box);
  const best = corners[0].clone();
  let bestDot = best.dot(direction);
  for (const corner of corners) {
    const dot = corner.dot(direction);
    if (pick === "min") {
      if (dot < bestDot) {
        bestDot = dot;
        best.copy(corner);
      }
    } else if (dot > bestDot) {
      bestDot = dot;
      best.copy(corner);
    }
  }
  return best;
}

function projectOntoPlane(vec: THREE.Vector3, normal: THREE.Vector3) {
  const n = normal.clone().normalize();
  return vec.clone().sub(n.multiplyScalar(vec.dot(n)));
}

function signedAngleAroundAxis(from: THREE.Vector3, to: THREE.Vector3, axis: THREE.Vector3) {
  const cross = new THREE.Vector3().crossVectors(from, to);
  const dot = THREE.MathUtils.clamp(from.dot(to), -1, 1);
  return Math.atan2(cross.dot(axis), dot);
}

function clampScalar(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function snapScalar(value: number) {
  return Math.abs(value) < SNAP_EPS ? 0 : Number(value.toFixed(6));
}

function placementsClose(a: MonitorPlacement | null, b: MonitorPlacement | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.position[0] - b.position[0]) <= STATE_EPS &&
    Math.abs(a.position[1] - b.position[1]) <= STATE_EPS &&
    Math.abs(a.position[2] - b.position[2]) <= STATE_EPS &&
    Math.abs(a.rotation[0] - b.rotation[0]) <= STATE_EPS &&
    Math.abs(a.rotation[1] - b.rotation[1]) <= STATE_EPS &&
    Math.abs(a.rotation[2] - b.rotation[2]) <= STATE_EPS
  );
}

function buildLayoutFrame(meta: SurfaceMeta, bounds: PropBounds): LayoutFrame {
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
  deskBounds: PropBounds,
  monitorBounds: PropBounds | null,
): { target: [number, number, number]; pose: LayoutPose } {
  const forward = toVec3(frame.forward);
  const right = toVec3(frame.right);
  const up = toVec3(frame.up);

  const combinedBounds = boundsToBox(deskBounds);
  if (monitorBounds) {
    combinedBounds.union(boundsToBox(monitorBounds));
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

function solveMonitor(
  frame: LayoutFrame,
  deskSurface: Surface | null,
  monitorMeta: SurfaceMeta | null,
  currentBounds: PropBounds | null,
  baseMeta: SurfaceMeta | null,
  baseBounds: PropBounds | null,
  manualOffsets?: { lateral: number; depth: number },
  scaledBounds: PropBounds | null = null,
): MonitorPlacement | null {
  const up = toVec3(frame.up);
  const right = toVec3(frame.right);
  const forward = toVec3(frame.forward);

  const deskTop = deskSurface
    ? new THREE.Vector3(deskSurface.origin[0], deskSurface.origin[1], deskSurface.origin[2])
    : new THREE.Vector3(frame.center[0], frame.center[1], frame.center[2]);
  const desiredPlane = deskTop.dot(up) + MONITOR_CLEARANCE;

  const referenceBounds = scaledBounds ?? baseBounds ?? currentBounds;
  if (!referenceBounds && !baseMeta) {
    return null;
  }

  let liftDelta = 0;
  if (referenceBounds) {
    const bottom = extremalPoint(referenceBounds, up, "min");
    liftDelta = desiredPlane - bottom.dot(up);
  } else if (baseMeta) {
    const center = new THREE.Vector3(baseMeta.center[0], baseMeta.center[1], baseMeta.center[2]);
    const baseNormal = toVec3(baseMeta.normal).normalize();
    const bottom = center.clone().sub(baseNormal.multiplyScalar(baseMeta.extents.thickness / 2));
    liftDelta = desiredPlane - bottom.dot(up);
  }

  const manualLateral = manualOffsets?.lateral ?? 0;
  const manualDepth = manualOffsets?.depth ?? 0;

  const deskCenter = boundsCenter(frame.bounds);
  const boundsForAlignment = scaledBounds ?? referenceBounds ?? baseBounds ?? currentBounds;
  let lateralDelta = manualLateral;
  let depthDelta = manualDepth;
  if (boundsForAlignment) {
    const monitorCenter = boundsCenter(boundsForAlignment);
    lateralDelta += deskCenter.clone().sub(monitorCenter).dot(right);
    depthDelta += deskCenter.clone().sub(monitorCenter).dot(forward);

    const deskSpanRight = spanAlongAxis(frame.bounds, right);
    const monitorSpanRight = spanAlongAxis(boundsForAlignment, right);
    const halfDeskRight = (deskSpanRight.max - deskSpanRight.min) / 2;
    const halfMonitorRight = (monitorSpanRight.max - monitorSpanRight.min) / 2;
    const limitRight = Math.max(0, halfDeskRight - halfMonitorRight - EDGE_MARGIN);
    lateralDelta = clampScalar(lateralDelta, -limitRight, limitRight);

    const deskSpanForward = spanAlongAxis(frame.bounds, forward);
    const monitorSpanForward = spanAlongAxis(boundsForAlignment, forward);
    const halfDeskForward = (deskSpanForward.max - deskSpanForward.min) / 2;
    const halfMonitorForward = (monitorSpanForward.max - monitorSpanForward.min) / 2;
    const limitForward = Math.max(0, halfDeskForward - halfMonitorForward - EDGE_MARGIN);
    depthDelta = clampScalar(depthDelta, -limitForward, limitForward);
  }

  liftDelta = snapScalar(liftDelta);
  lateralDelta = snapScalar(lateralDelta);
  depthDelta = snapScalar(depthDelta);

  const lift = up.clone().multiplyScalar(liftDelta);
  const lateral = right.clone().multiplyScalar(lateralDelta);
  const depth = forward.clone().multiplyScalar(depthDelta);

  const position = lift.add(lateral).add(depth);

  const normalSource = baseMeta ?? monitorMeta;
  let yaw = 0;
  if (normalSource) {
    const monitorNormal = toVec3(normalSource.normal).normalize();
    const projectedMonitor = projectOntoPlane(monitorNormal, up);
    const projectedForward = projectOntoPlane(forward, up);
    if (projectedMonitor.lengthSq() > SNAP_EPS && projectedForward.lengthSq() > SNAP_EPS) {
      projectedMonitor.normalize();
      projectedForward.normalize();
      yaw = signedAngleAroundAxis(projectedMonitor, projectedForward, up);
    }
  }

  yaw = snapScalar(yaw);

  return {
    position: toTuple(position),
    rotation: [0, yaw, 0],
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
  const overrides = useLayoutOverridesState();
  const deskSurface = useSurface("desk");
  const deskMeta = useSurfaceMeta("desk");
  const deskBounds = usePropBounds("desk");

  const monitorMeta = useSurfaceMeta("monitor1");
  const monitorBounds = usePropBounds("monitor1");
  const monitorScale = usePropScale("monitor1");
  const [monitorScaleX, monitorScaleY, monitorScaleZ] = monitorScale;

  const initialMonitorMetaRef = useRef<SurfaceMeta | null>(null);
  const initialMonitorBoundsRef = useRef<PropBounds | null>(null);

  useEffect(() => {
    if (!initialMonitorMetaRef.current && monitorMeta) {
      initialMonitorMetaRef.current = cloneMeta(monitorMeta);
    }
  }, [monitorMeta]);

  useEffect(() => {
    if (!initialMonitorBoundsRef.current && monitorBounds) {
      initialMonitorBoundsRef.current = cloneBounds(monitorBounds);
    }
  }, [monitorBounds]);

  useEffect(() => {
    if (!deskMeta || !deskBounds) {
      setLayoutState({
        status: deskMeta || deskBounds ? "pending" : "idle",
        frame: null,
        cameraTarget: null,
        deskPose: null,
        monitorPlacement: null,
      });
      return;
    }

    const frame = buildLayoutFrame(deskMeta, deskBounds);
    const cameraSolution = solveCamera(frame, deskBounds, monitorBounds ?? null);

    const monitorScaleVec: [number, number, number] = [monitorScaleX, monitorScaleY, monitorScaleZ];
    const baseMonitorBounds = initialMonitorBoundsRef.current;
    const scaledMonitorBounds = baseMonitorBounds && hasNonUnitScale(monitorScaleVec)
      ? scaleBoundsFromFoot(baseMonitorBounds, monitorScaleVec)
      : baseMonitorBounds;

    const placementCandidate = solveMonitor(
      frame,
      deskSurface,
      monitorMeta,
      monitorBounds ?? null,
      initialMonitorMetaRef.current,
      baseMonitorBounds,
      { lateral: overrides.monitorLateral, depth: overrides.monitorDepth },
      scaledMonitorBounds,
    );

    const prevLayout = peekLayoutState();
    let nextPlacement: MonitorPlacement | null = placementCandidate;
    if (!nextPlacement && prevLayout.monitorPlacement) {
      nextPlacement = prevLayout.monitorPlacement;
    } else if (placementsClose(nextPlacement, prevLayout.monitorPlacement)) {
      nextPlacement = prevLayout.monitorPlacement;
    }

    setLayoutState({
      status: "ready",
      frame,
      cameraTarget: cameraSolution.target,
      deskPose: cameraSolution.pose,
      monitorPlacement: nextPlacement ?? null,
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
  }, [
    deskMeta,
    deskBounds,
    deskSurface,
    monitorMeta,
    monitorBounds,
    overrides.monitorLateral,
    overrides.monitorDepth,
    monitorScaleX,
    monitorScaleY,
    monitorScaleZ,
  ]);

  return useLayoutFrameState();
}

