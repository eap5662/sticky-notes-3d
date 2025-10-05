import type { AnchorConfig } from '@/canvas/props/GLTFProp';
import type { SurfaceExtractOptions } from '@/canvas/props/surfaceAdapter';
import { createSurfaceId, type SurfaceId } from '@/canvas/surfaces';

export type SurfaceKind = 'desk' | 'screen' | 'monitor-arm' | 'wall';

export type PropSurfaceConfig = {
  id: SurfaceId;
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
    id: 'desk-default',
    label: 'Desk',
    url: '/models/DeskTopPlane.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'max', z: 'center' } },
    surfaces: [
      {
        id: createSurfaceId('desk-surface'),
        kind: 'desk',
        nodeName: 'DeskTopPlane',
        options: { normalSide: 'positive' },
      },
    ],
  },
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
        id: createSurfaceId('monitor-basic-screen'),
        kind: 'screen',
        nodeName: 'ScreenPlane',
        options: { normalSide: 'positive' },
      },
    ],
  },
];
