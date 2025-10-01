import GLTFProp from './GLTFProp';

export function DeskProp({ url }: { url: string }) {
  // Assumes your desk GLTF has a node named "DeskTopPlane"
  return (
    <GLTFProp
      url={url}
      propId="desk"
      registerSurfaces={[{ id: 'desk', kind: 'desk', nodeName: 'DeskTopPlane', options: { normalSide: 'positive' } }]}
    />
  );
}
