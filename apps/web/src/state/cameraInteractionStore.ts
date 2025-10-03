let orbitLocked = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function lockCameraOrbit() {
  if (!orbitLocked) {
    orbitLocked = true;
    emit();
  }
}

export function unlockCameraOrbit() {
  if (orbitLocked) {
    orbitLocked = false;
    emit();
  }
}

export function isCameraOrbitLocked() {
  return orbitLocked;
}

export function subscribeCameraOrbit(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
