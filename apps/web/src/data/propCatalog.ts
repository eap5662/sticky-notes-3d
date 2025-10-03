import type { AnchorConfig } from '@/canvas/props/GLTFProp';

export type PropCatalogEntry = {
  id: string;
  label: string;
  url: string;
  anchor?: AnchorConfig;
};

export const PROP_CATALOG: PropCatalogEntry[] = [
  {
    id: 'lamp-basic',
    label: 'Desk Lamp',
    url: '/models/lamp.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
  },
];
