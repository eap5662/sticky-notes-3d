import type { PropId } from '@/state/propBoundsStore';

export type PropScaleValue = [number, number, number];

export type PropScaleState = Record<PropId, PropScaleValue>;

const DEFAULT_STATE: PropScaleState = {
  desk: [1, 1, 1],
  monitor1: [1, 1, 1],
};

const listeners = new Set<() => void>();
let state: PropScaleState = cloneState(DEFAULT_STATE);
let cachedSnapshot: PropScaleState | null = null;

function cloneValue(value: PropScaleValue): PropScaleValue {
  return [value[0], value[1], value[2]];
}

function cloneState(source: PropScaleState): PropScaleState {
  return {
    desk: cloneValue(source.desk),
    monitor1: cloneValue(source.monitor1),
  };
}

function valuesEqual(a: PropScaleValue, b: PropScaleValue) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function notify() {
  listeners.forEach((listener) => listener());
}

function setState(next: PropScaleState) {
  if (!valuesEqual(state.desk, next.desk) || !valuesEqual(state.monitor1, next.monitor1)) {
    state = next;
    cachedSnapshot = null;
    notify();
  }
}

export function getPropScaleState(): PropScaleState {
  if (!cachedSnapshot) {
    cachedSnapshot = cloneState(state);
  }
  return cachedSnapshot;
}

export function getPropScale(id: PropId): PropScaleValue {
  return state[id];
}

export function setPropScale(id: PropId, rawScale: PropScaleValue) {
  const next = cloneState(state);
  const current = next[id];
  if (valuesEqual(current, rawScale)) {
    return;
  }
  next[id] = cloneValue(rawScale);
  setState(next);
}

export function setUniformPropScale(id: PropId, scale: number) {
  setPropScale(id, [scale, scale, scale]);
}

export function resetPropScales() {
  setState(cloneState(DEFAULT_STATE));
}

export function subscribePropScale(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

