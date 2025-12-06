import { useMemo } from 'react';

import { useSurfacesByKind } from './useSurfaces';
import { useGenericProps } from './useGenericProps';

export function useActiveDeskId(): string | null {
  const deskSurfaces = useSurfacesByKind('desk');
  return deskSurfaces[0]?.meta.ownerId ?? null;
}

export function useActiveDeskProp() {
  const deskId = useActiveDeskId();
  const genericProps = useGenericProps();

  return useMemo(() => {
    if (!deskId) return null;
    return genericProps.find((prop) => prop.id === deskId) ?? null;
  }, [genericProps, deskId]);
}
