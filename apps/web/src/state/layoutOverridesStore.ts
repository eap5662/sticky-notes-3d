export type LayoutOverridesState = {
  deskYawDeg: number;
  monitorLateral: number;
  monitorDepth: number;
};

const DEFAULT_STATE: LayoutOverridesState = {
  deskYawDeg: 0,
  monitorLateral: 0,
  monitorDepth: 0,
};

const MAX_MONITOR_OFFSET = 0.5;
const listeners = new Set<() => void>();

let state: LayoutOverridesState = { ...DEFAULT_STATE };
let cachedSnapshot: LayoutOverridesState | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

function cloneState(source: LayoutOverridesState): LayoutOverridesState {
  return { ...source };
}

function layoutOverridesEqual(a: LayoutOverridesState, b: LayoutOverridesState) {
  return (
    a.deskYawDeg === b.deskYawDeg &&
    a.monitorLateral === b.monitorLateral &&
    a.monitorDepth === b.monitorDepth
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function wrapDegrees(value: number) {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(wrapped) < 1e-6 ? 0 : Number(wrapped.toFixed(6));
}

function setState(next: LayoutOverridesState) {
  if (!layoutOverridesEqual(state, next)) {
    state = next;
    cachedSnapshot = null;
    notify();
  }
}

export function setLayoutOverrides(partial: Partial<LayoutOverridesState>) {
  setState({ ...state, ...partial });
}

export function updateLayoutOverrides(
  updater: (current: LayoutOverridesState) => LayoutOverridesState,
) {
  setState(updater(state));
}

export function rotateDesk(deltaDeg: number) {
  updateLayoutOverrides((current) => ({
    ...current,
    deskYawDeg: wrapDegrees(current.deskYawDeg + deltaDeg),
  }));
}

export function setDeskYaw(deg: number) {
  updateLayoutOverrides((current) => ({
    ...current,
    deskYawDeg: wrapDegrees(deg),
  }));
}

export function nudgeMonitor(lateralDelta: number, depthDelta: number) {
  updateLayoutOverrides((current) => ({
    ...current,
    monitorLateral: clamp(
      Number((current.monitorLateral + lateralDelta).toFixed(6)),
      -MAX_MONITOR_OFFSET,
      MAX_MONITOR_OFFSET,
    ),
    monitorDepth: clamp(
      Number((current.monitorDepth + depthDelta).toFixed(6)),
      -MAX_MONITOR_OFFSET,
      MAX_MONITOR_OFFSET,
    ),
  }));
}

export function setMonitorOffsets(lateral: number, depth: number) {
  updateLayoutOverrides((current) => ({
    ...current,
    monitorLateral: clamp(Number(lateral.toFixed(6)), -MAX_MONITOR_OFFSET, MAX_MONITOR_OFFSET),
    monitorDepth: clamp(Number(depth.toFixed(6)), -MAX_MONITOR_OFFSET, MAX_MONITOR_OFFSET),
  }));
}

export function resetLayoutOverrides() {
  setState({ ...DEFAULT_STATE });
}

export function getLayoutOverrides(): LayoutOverridesState {
  if (!cachedSnapshot) {
    cachedSnapshot = cloneState(state);
  }
  return cachedSnapshot;
}

export function peekLayoutOverrides(): LayoutOverridesState {
  return state;
}

export function subscribeLayoutOverrides(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

