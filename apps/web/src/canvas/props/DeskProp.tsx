import GLTFProp from './GLTFProp';

export function DeskProp({ url }: { url: string }) {
  return (
    <GLTFProp
      url={url}
      propId="desk"
      registerSurfaces={[{ id: 'desk', kind: 'desk', nodeName: 'DeskTopPlane', options: { normalSide: 'positive' } }]}
    />
  );
}
