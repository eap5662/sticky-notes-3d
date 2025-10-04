export type LayoutOverridesState = {
  deskYawDeg: number;
};

const DEFAULT_STATE: LayoutOverridesState = {
  deskYawDeg: 0,
};

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
  return a.deskYawDeg === b.deskYawDeg;
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

