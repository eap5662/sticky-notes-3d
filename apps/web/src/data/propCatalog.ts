import type { AnchorConfig } from '@/canvas/props/GLTFProp';
import type { SurfaceExtractOptions } from '@/canvas/props/surfaceAdapter';

export type SurfaceKind = 'desk' | 'screen' | 'monitor-arm' | 'wall';

export type PropSurfaceConfig = {
  id: string;
  kind: SurfaceKind;
  nodeName: string;
  options?: SurfaceExtractOptions;
};

export type PropCatalogEntry = {
  id: string;
  label: string;
  url: string;
  anchor?: AnchorConfig;
  surfaces?: PropSurfaceConfig[];
};

export const PROP_CATALOG: PropCatalogEntry[] = [
  {
    id: 'lamp-basic',
    label: 'Desk Lamp',
    url: '/models/lamp.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
  },
  {
    id: 'monitor-basic',
    label: 'Monitor',
    url: '/models/monitor_processed.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    surfaces: [
      {
        id: 'monitor-basic-screen',
        kind: 'screen',
        nodeName: 'ScreenPlane',
        options: { normalSide: 'positive' },
      },
    ],
  },
];
