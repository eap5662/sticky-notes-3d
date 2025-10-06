import type { Vec3 } from "@/canvas/surfaces";
import type { GenericPropBounds } from "@/state/genericPropsStore";

export type LayoutStatus = "idle" | "pending" | "ready";

export type LayoutPose = {
  yaw: number;
  pitch: number;
  dolly: number;
};

export type LayoutFrame = {
  center: Vec3;
  up: Vec3;
  right: Vec3;
  forward: Vec3;
  extents: { u: number; v: number; thickness: number };
  bounds: GenericPropBounds;
};

export type LayoutState = {
  status: LayoutStatus;
  frame: LayoutFrame | null;
  cameraTarget: Vec3 | null;
  deskPose: LayoutPose | null;
};

const listeners = new Set<() => void>();

let state: LayoutState = {
  status: "idle",
  frame: null,
  cameraTarget: null,
  deskPose: null,
};

let cachedSnapshot: LayoutState | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

function vecEquals(a: Vec3 | null, b: Vec3 | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function extentsEqual(
  a: LayoutFrame["extents"] | null,
  b: LayoutFrame["extents"] | null
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.u === b.u && a.v === b.v && a.thickness === b.thickness;
}

function boundsEqual(a: GenericPropBounds | null, b: GenericPropBounds | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return vecEquals(a.min, b.min) && vecEquals(a.max, b.max);
}

function frameEquals(a: LayoutFrame | null, b: LayoutFrame | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    vecEquals(a.center, b.center) &&
    vecEquals(a.up, b.up) &&
    vecEquals(a.right, b.right) &&
    vecEquals(a.forward, b.forward) &&
    extentsEqual(a.extents, b.extents) &&
    boundsEqual(a.bounds, b.bounds)
  );
}

function poseEquals(a: LayoutPose | null, b: LayoutPose | null, eps = 1e-6) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.yaw - b.yaw) <= eps &&
    Math.abs(a.pitch - b.pitch) <= eps &&
    Math.abs(a.dolly - b.dolly) <= eps
  );
}

function cloneVec3(vec: Vec3): Vec3 {
  return [vec[0], vec[1], vec[2]];
}

function cloneBounds(bounds: GenericPropBounds): GenericPropBounds {
  return {
    min: cloneVec3(bounds.min),
    max: cloneVec3(bounds.max),
  };
}

function cloneFrame(frame: LayoutFrame | null): LayoutFrame | null {
  if (!frame) return null;
  return {
    center: cloneVec3(frame.center),
    up: cloneVec3(frame.up),
    right: cloneVec3(frame.right),
    forward: cloneVec3(frame.forward),
    extents: { ...frame.extents },
    bounds: cloneBounds(frame.bounds),
  };
}

function clonePose(pose: LayoutPose | null): LayoutPose | null {
  if (!pose) return null;
  return { ...pose };
}

function layoutStateEquals(a: LayoutState, b: LayoutState) {
  return (
    a.status === b.status &&
    frameEquals(a.frame, b.frame) &&
    vecEquals(a.cameraTarget, b.cameraTarget) &&
    poseEquals(a.deskPose, b.deskPose)
  );
}

export function setLayoutState(partial: Partial<LayoutState>) {
  const frameValue =
    partial.frame === undefined ? state.frame : partial.frame;
  const targetValue =
    partial.cameraTarget === undefined ? state.cameraTarget : partial.cameraTarget;
  const poseValue =
    partial.deskPose === undefined ? state.deskPose : partial.deskPose;

  const next: LayoutState = {
    status: partial.status ?? state.status,
    frame: frameValue ? cloneFrame(frameValue) : null,
    cameraTarget: targetValue ? cloneVec3(targetValue) : null,
    deskPose: clonePose(poseValue),
  };

  if (!layoutStateEquals(state, next)) {
    state = next;
    cachedSnapshot = null;
    notify();
  }
}

export function resetLayoutState() {
  state = {
    status: "idle",
    frame: null,
    cameraTarget: null,
    deskPose: null,
  };
  cachedSnapshot = null;
  notify();
}

export function getLayoutState(): LayoutState {
  if (!cachedSnapshot) {
    cachedSnapshot = cloneLayoutState(state);
  }
  return cachedSnapshot;
}

export function peekLayoutState(): LayoutState {
  return state;
}

function cloneLayoutState(current: LayoutState): LayoutState {
  return {
    status: current.status,
    frame: cloneFrame(current.frame),
    cameraTarget: current.cameraTarget ? cloneVec3(current.cameraTarget) : null,
    deskPose: clonePose(current.deskPose),
  };
}

export function subscribeLayoutState(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
