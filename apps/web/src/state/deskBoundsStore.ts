import type { GenericPropId } from './genericPropsStore';

/**
 * 2D point in world space (x, z) for desk bounds polygon
 */
export type Vec2 = [number, number];

/**
 * Custom polygon bounds for a desk prop
 */
export type DeskBoundsOverride = {
  propId: GenericPropId;
  polygon: Vec2[]; // Ordered vertices in world space (x, z)
};

type Subscriber = () => void;

const listeners = new Set<Subscriber>();
const boundsMap = new Map<GenericPropId, Vec2[]>();
let isMarkingMode = false;
const markingListeners = new Set<Subscriber>();

function emit() {
  listeners.forEach((listener) => listener());
}

function emitMarkingMode() {
  markingListeners.forEach((listener) => listener());
}

export function setMarkingMode(active: boolean) {
  if (isMarkingMode !== active) {
    isMarkingMode = active;
    emitMarkingMode();
  }
}

export function isInMarkingMode(): boolean {
  return isMarkingMode;
}

export function subscribeMarkingMode(listener: Subscriber) {
  markingListeners.add(listener);
  return () => markingListeners.delete(listener);
}

export function setDeskBounds(propId: GenericPropId, points: Vec2[]) {
  // Require at least 3 points to form a polygon
  if (points.length < 3) {
    console.warn('[deskBoundsStore] Cannot set bounds with less than 3 points');
    return;
  }

  boundsMap.set(propId, points);
  emit();
}

export function getDeskBounds(propId: GenericPropId): Vec2[] | null {
  return boundsMap.get(propId) ?? null;
}

export function clearDeskBounds(propId: GenericPropId) {
  if (boundsMap.delete(propId)) {
    emit();
  }
}

export function hasDeskBounds(propId: GenericPropId): boolean {
  return boundsMap.has(propId);
}

export function subscribeDeskBounds(listener: Subscriber) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAllDeskBounds(): DeskBoundsOverride[] {
  return Array.from(boundsMap.entries()).map(([propId, polygon]) => ({
    propId,
    polygon,
  }));
}
