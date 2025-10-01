import { useSyncExternalStore } from 'react';
import {
  getPropBounds,
  getAllPropBounds,
  subscribePropBounds,
  type PropBounds,
  type PropId,
} from '@/state/propBoundsStore';

export function usePropBounds(id: PropId): PropBounds | null {
  return useSyncExternalStore(
    subscribePropBounds,
    () => getPropBounds(id),
    () => getPropBounds(id),
  );
}

export function useAllPropBounds(): [PropId, PropBounds][] {
  return useSyncExternalStore(
    subscribePropBounds,
    () => getAllPropBounds(),
    () => getAllPropBounds(),
  );
}
