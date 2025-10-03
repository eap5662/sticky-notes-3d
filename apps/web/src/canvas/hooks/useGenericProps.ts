import { useSyncExternalStore } from 'react';

import {
  getGenericProp,
  getGenericPropsSnapshot,
  subscribeGenericProps,
  type GenericProp,
  type GenericPropId,
} from '@/state/genericPropsStore';

const getServerSnapshot = () => getGenericPropsSnapshot();

export function useGenericProps(): GenericProp[] {
  return useSyncExternalStore(subscribeGenericProps, getGenericPropsSnapshot, getServerSnapshot);
}

export function useGenericProp(id: GenericPropId | null | undefined): GenericProp | null {
  return useSyncExternalStore(
    subscribeGenericProps,
    () => (id ? getGenericProp(id) ?? null : null),
    () => {
      if (!id) return null;
      const snapshot = getServerSnapshot();
      return snapshot.find((prop) => prop.id === id) ?? null;
    },
  );
}
