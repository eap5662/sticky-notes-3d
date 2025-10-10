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
  defaultRotation?: [number, number, number]; // Default rotation in radians [x, y, z]
  defaultScale?: number; // Default scale multiplier (e.g., 0.5 = 50%, 2 = 200%)
  surfaces?: PropSurfaceConfig[];
};

export const PROP_CATALOG: PropCatalogEntry[] = [
  {
    id: 'desk-default',
    label: 'Desk',
    url: '/models/DeskTopPlane.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
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
    defaultRotation: [0, -Math.PI / 2, 0] as [number, number, number], // Face desk forward (-90° Y-rotation)
    surfaces: [
      {
        id: createSurfaceId('monitor-basic-screen'),
        kind: 'screen',
        nodeName: 'ScreenPlane',
        options: { normalSide: 'positive' },
      },
    ],
  },

  // ========================================
  // AUTO-GENERATED ENTRIES - Batch 1
  // Generated: 2025-10-10
  // ========================================

  // Simple Props (9) - Scale-corrected
  {
    id: 'Computer-Mouse',
    label: 'Computer Mouse',
    url: '/models/Computer-Mouse.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 2, // Too small, scale 2x
  },
  {
    id: 'Mousepad',
    label: 'Mousepad',
    url: '/models/Mousepad.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 0.25, // Very large, scale to 1/4x
  },
  {
    id: 'Mug-supplies',
    label: 'Mug Supplies',
    url: '/models/Mug-supplies.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    // OK, no scale needed
  },
  {
    id: 'Notebook',
    label: 'Notebook',
    url: '/models/Notebook.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 0.1, // Extremely large, scale to 1/10x
  },
  {
    id: 'Pen',
    label: 'Pen',
    url: '/models/Pen.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 0.05, // Huge, scale to 1/20x
  },
  {
    id: 'Rubber-Duck',
    label: 'Rubber Duck',
    url: '/models/Rubber-Duck.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 1.5, // Scale 1.5x
  },
  {
    id: 'Soda-Can',
    label: 'Soda Can',
    url: '/models/Soda-Can.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 0.04, // Scale to 1/25x
  },
  {
    id: 'Sticky-notes-pad-thick',
    label: 'Sticky Notes Pad Thick',
    url: '/models/Sticky-notes-pad-thick.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 1.5, // Scale 1.5x
  },
  {
    id: 'Tissue-Box',
    label: 'Tissue Box',
    url: '/models/Tissue-Box.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 1.5, // Scale 1.5x
  },

  // Props with Interactive Surfaces (2) - Scale-corrected
  {
    id: 'Monitor-large',
    label: 'Monitor Large',
    url: '/models/Monitor-large.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 0.5, // Scale to 1/2x
    surfaces: [
      {
        id: createSurfaceId('Monitor-large-screen'),
        kind: 'screen',
        nodeName: 'MonitorSurfacePlane',
        options: { normalSide: 'positive' },
      },
    ],
  },
  {
    id: 'Whiteboard1',
    label: 'Whiteboard1',
    url: '/models/Whiteboard1.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 0.04, // Scale to 1/25x
    surfaces: [
      {
        id: createSurfaceId('Whiteboard1-wall'),
        kind: 'wall',
        nodeName: 'WhiteBoardSurface',
        options: { normalSide: 'positive' },
      },
    ],
  },
];
