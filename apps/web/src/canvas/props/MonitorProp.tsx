import GLTFProp from './GLTFProp';

export function MonitorProp({
  url,
  position,
  rotation,
  scale,
}: {
  url: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}) {
  return (
    <GLTFProp
      url={url}
      position={position}
      rotation={rotation}
      scale={scale}
      anchor={{ type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } }}
      propId="monitor1"
      registerSurfaces={[{ id: 'monitor1', kind: 'monitor', nodeName: 'ScreenPlane' }]}
    />
  );
}

