import { useCallback, useEffect } from 'react';
import type { ThreeEvent } from '@react-three/fiber';

import GLTFProp from './GLTFProp';
import {
  clearGenericPropBounds,
  setGenericPropBounds,
  type GenericProp,
} from '@/state/genericPropsStore';
import { setSelection } from '@/state/selectionStore';

const DEFAULT_ANCHOR = { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } } as const;

type GenericPropInstanceProps = {
  prop: GenericProp;
};

export function GenericPropInstance({ prop }: GenericPropInstanceProps) {
  useEffect(() => {
    return () => {
      clearGenericPropBounds(prop.id);
    };
  }, [prop.id]);

  const handleBoundsChanged = useCallback(
    (bounds: { min: [number, number, number]; max: [number, number, number] }) => {
      setGenericPropBounds(prop.id, bounds);
    },
    [prop.id],
  );

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      setSelection({ kind: 'generic', id: prop.id });
    },
    [prop.id],
  );

  return (
    <GLTFProp
      url={prop.url}
      position={prop.position}
      rotation={prop.rotation}
      scale={prop.scale}
      anchor={prop.anchor ?? DEFAULT_ANCHOR}
      onBoundsChanged={handleBoundsChanged}
      groupProps={{
        onPointerDown: handlePointerDown,
      }}
    />
  );
}
