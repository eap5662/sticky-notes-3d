import { useSyncExternalStore } from 'react';

import {
  getPropScale,
  getPropScaleState,
  subscribePropScale,
  type PropScaleValue,
} from '@/state/propScaleStore';
import type { PropId } from '@/state/propBoundsStore';

const getServerSnapshot = (() => {
  const snapshot = getPropScaleState();
  return (id: PropId) => snapshot[id];
})();

export function usePropScale(id: PropId): PropScaleValue {
  return useSyncExternalStore(
    subscribePropScale,
    () => getPropScale(id),
    () => getServerSnapshot(id),
  );
}

