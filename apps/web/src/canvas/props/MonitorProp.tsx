import GLTFProp from './GLTFProp';

export function MonitorProp({ url, position }: { url: string; position?: [number, number, number] }) {
  // Assumes your monitor GLTF has a node named "ScreenPlane"
  return (
    <GLTFProp
      url={url}
      position={position}
      propId="monitor1"
      registerSurfaces={[{ id: 'monitor1', kind: 'monitor', nodeName: 'ScreenPlane' }]}
    />
  );
}
