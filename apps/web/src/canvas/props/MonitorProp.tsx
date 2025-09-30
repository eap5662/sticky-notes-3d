import GLTFProp from './GLTFProp';

export function MonitorProp({ url }: { url: string }) {
  // Assumes your monitor GLTF has a node named "ScreenPlane"
  return (
    <GLTFProp
      url={url}
      registerSurfaces={[{ id: 'monitor1', kind: 'monitor', nodeName: 'ScreenPlane' }]}
    />
  );
}