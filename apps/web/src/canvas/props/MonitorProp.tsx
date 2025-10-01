import GLTFProp from './GLTFProp';

export function MonitorProp({
  url,
  position,
  rotation,
}: {
  url: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <GLTFProp
      url={url}
      position={position}
      rotation={rotation}
      propId="monitor1"
      registerSurfaces={[{ id: 'monitor1', kind: 'monitor', nodeName: 'ScreenPlane' }]}
    />
  );
}
