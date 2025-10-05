import { createSurfaceId } from '@/canvas/surfaces';
import GLTFProp from './GLTFProp';

type DeskPropProps = {
  url: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
};

export function DeskProp({ url, position, rotation, scale }: DeskPropProps) {
  return (
    <GLTFProp
      url={url}
      position={position}
      rotation={rotation}
      scale={scale}
      anchor={{ type: 'bbox', align: { x: 'center', y: 'max', z: 'center' } }}
      propId="desk"
      registerSurfaces={[{ id: createSurfaceId('desk'), kind: 'desk', nodeName: 'DeskTopPlane', options: { normalSide: 'positive' } }]}
    />
  );
}


