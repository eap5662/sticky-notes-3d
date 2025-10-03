import { useSyncExternalStore } from 'react';

import { getSelection, subscribeSelection, type Selection } from '@/state/selectionStore';

const getServerSnapshot = () => getSelection();

export function useSelection(): Selection {
  return useSyncExternalStore(subscribeSelection, getSelection, getServerSnapshot);
}
