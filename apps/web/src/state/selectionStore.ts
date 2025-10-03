import type { GenericPropId } from '@/state/genericPropsStore';
import type { PropId } from '@/state/propBoundsStore';

type DeskSelection = { kind: 'desk'; id: Extract<PropId, 'desk'> };
type MonitorSelection = { kind: 'monitor'; id: Extract<PropId, 'monitor1'> };
type GenericSelection = { kind: 'generic'; id: GenericPropId };

export type Selection = DeskSelection | MonitorSelection | GenericSelection | null;

type Subscriber = () => void;

let selectionState: Selection = null;
const listeners = new Set<Subscriber>();

function equals(a: Selection, b: Selection) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id;
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function getSelection(): Selection {
  return selectionState;
}

export function setSelection(next: Selection) {
  if (equals(selectionState, next)) {
    return;
  }
  selectionState = next;
  notify();
}

export function clearSelection() {
  setSelection(null);
}

export function subscribeSelection(listener: Subscriber) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
