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

export type PropCategory = 'desk' | 'surface' | 'electronics' | 'desk-accessories' | 'supplies' | 'decorations';

export type CategoryMetadata = {
  id: PropCategory;
  label: string;
  icon: string; // Emoji fallback
  iconPath?: string; // Optional path to icon image
  borderColor: string; // Hex color for borders
  bgColor: string; // Lightened hex color for backgrounds
  order: number;
};

export const CATEGORY_DEFINITIONS: Record<PropCategory, CategoryMetadata> = {
  'desk': { id: 'desk', label: 'Desks', icon: '🪑', iconPath: '/icons/categories/desk_icon.png', borderColor: '#8B5E3C', bgColor: '#EBD9CE', order: 1 },
  'surface': { id: 'surface', label: 'Surfaces', icon: '🖥️', borderColor: '#2c78b6', bgColor: '#C6E3F9', order: 2 },
  'electronics': { id: 'electronics', label: 'Electronics', icon: '⚡', iconPath: '/icons/categories/extension.png', borderColor: '#55f4a8', bgColor: '#D3FFED', order: 3 },
  'desk-accessories': { id: 'desk-accessories', label: 'Accessories', icon: '🖱️', iconPath: '/icons/categories/mug.png', borderColor: '#6a6a6a', bgColor: '#E2E2E2', order: 4 },
  'supplies': { id: 'supplies', label: 'Supplies', icon: '📝', iconPath: '/icons/categories/office-supplies.png', borderColor: '#eeeb61', bgColor: '#FFFEDE', order: 5 },
  'decorations': { id: 'decorations', label: 'Decorations', icon: '🎨', iconPath: '/icons/categories/shelf2.png', borderColor: '#E96D88', bgColor: '#FCDEE6', order: 6 },
};

// Surface subtypes with their icons
export const SURFACE_TYPE_ICONS = {
  monitor: '🖥️', // Emoji fallback
  board: '/icons/categories/white-board.png',
} as const;

export type SurfaceType = 'monitor' | 'board';

export type PropCatalogEntry = {
  id: string;
  label: string;
  url: string;
  anchor?: AnchorConfig;
  defaultRotation?: [number, number, number]; // Default rotation in radians [x, y, z]
  defaultScale?: number; // Default scale multiplier (e.g., 0.5 = 50%, 2 = 200%)
  surfaces?: PropSurfaceConfig[];
  primaryCategory: PropCategory; // Primary category used for sorting
  categories: PropCategory[]; // All categories this prop belongs to (max 3)
  surfaceType?: SurfaceType; // For surface category props: monitor or board
};

export const PROP_CATALOG: PropCatalogEntry[] = [
  {
    id: 'desk-default',
    label: 'Desk',
    url: '/models/DeskTopPlane.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    primaryCategory: 'desk',
    categories: ['desk', 'surface'],
    surfaceType: 'board', // Desk is a horizontal surface/board
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
    primaryCategory: 'desk-accessories',
    categories: ['desk-accessories', 'electronics'],
  },
  {
    id: 'monitor-basic',
    label: 'Monitor',
    url: '/models/monitor_processed.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultRotation: [0, -Math.PI / 2, 0] as [number, number, number], // Face desk forward (-90° Y-rotation)
    primaryCategory: 'surface',
    categories: ['surface', 'electronics'],
    surfaceType: 'monitor',
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

  // Simple Props (9) - Optimal scale ratios
  {
    id: 'Computer-Mouse',
    label: 'Computer Mouse',
    url: '/models/Computer-Mouse.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 2, // Optimal: 2x
    primaryCategory: 'electronics',
    categories: ['electronics', 'desk-accessories'],
  },
  {
    id: 'Mousepad',
    label: 'Mousepad',
    url: '/models/Mousepad.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 0.15, // Optimal: 0.15x
    primaryCategory: 'desk-accessories',
    categories: ['desk-accessories'],
  },
  {
    id: 'Mug-supplies',
    label: 'Mug Supplies',
    url: '/models/Mug-supplies.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 1.2, // Optimal: 1.2x
    primaryCategory: 'supplies',
    categories: ['supplies', 'desk-accessories'],
  },
  {
    id: 'Notebook',
    label: 'Notebook',
    url: '/models/Notebook.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 0.04, // Optimal: 0.04x
    primaryCategory: 'supplies',
    categories: ['supplies'],
  },
  {
    id: 'Pen',
    label: 'Pen',
    url: '/models/Pen.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 0.03, // Optimal: 0.03x
    primaryCategory: 'supplies',
    categories: ['supplies'],
  },
  {
    id: 'Rubber-Duck',
    label: 'Rubber Duck',
    url: '/models/Rubber-Duck.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 1.7, // Optimal: 1.7x
    primaryCategory: 'decorations',
    categories: ['decorations'],
  },
  {
    id: 'Soda-Can',
    label: 'Soda Can',
    url: '/models/Soda-Can.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 0.02, // Optimal: 0.02x
    primaryCategory: 'desk-accessories',
    categories: ['desk-accessories'],
  },
  {
    id: 'Sticky-notes-pad-thick',
    label: 'Sticky Notes Pad Thick',
    url: '/models/Sticky-notes-pad-thick.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 1.9, // Optimal: 1.9x
    primaryCategory: 'supplies',
    categories: ['supplies'],
  },
  {
    id: 'Tissue-Box',
    label: 'Tissue Box',
    url: '/models/Tissue-Box.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 1.9, // Optimal: 1.9x
    primaryCategory: 'supplies',
    categories: ['supplies'],
  },

  // Props with Interactive Surfaces (1) - Optimal scale ratios
  {
    id: 'Whiteboard1',
    label: 'Whiteboard',
    url: '/models/Whiteboard1.glb',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 0.1, // Optimal: 0.1x
    primaryCategory: 'surface',
    categories: ['surface'],
    surfaceType: 'board',
    surfaces: [
      {
        id: createSurfaceId('Whiteboard1-wall'),
        kind: 'wall',
        nodeName: 'WhiteBoardSurface',
        options: { normalSide: 'positive' },
      },
    ],
  },

  // Props with Interactive Surfaces (3) - 2025-10-24 Batch
  {
    id: 'modified-corner-desk',
    label: 'Modified Corner Desk',
    url: '/models/modified-corner-desk.glb?v=20251025',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 2.5, // Normalized to 1x in UI
    primaryCategory: 'desk',
    categories: ['desk', 'surface'],
    surfaceType: 'board',
    surfaces: [
      {
        id: createSurfaceId('modified-corner-desk-desk'),
        kind: 'desk',
        nodeName: 'desk-top-plane',
        options: { normalSide: 'positive' },
      },
    ],
  },
  {
    id: 'grey-computer-desk',
    label: 'Grey Computer Desk',
    url: '/models/Grey-Computer-Desk.glb',
    anchor: {
      type: 'bbox',
      align: { x: 'center', y: 'min', z: 'center' },
    },
    primaryCategory: 'desk',
    categories: ['desk', 'surface'],
    surfaceType: 'board',
    surfaces: [
      {
        id: createSurfaceId('grey-computer-desk-desk'),
        kind: 'desk',
        nodeName: 'desk-top-plane',
        options: { normalSide: 'positive' },
      },
    ],
  },
  {
    id: 'tan-desk',
    label: 'Tan Desk',
    url: '/models/Tan-Desk.glb?v=20251025',
    anchor: { type: 'bbox', align: { x: 'center', y: 'min', z: 'center' } },
    defaultScale: 1.75, // Normalized to 1x in UI
    primaryCategory: 'desk',
    categories: ['desk', 'surface'],
    surfaceType: 'board',
    surfaces: [
      {
        id: createSurfaceId('tan-desk-desk'),
        kind: 'desk',
        nodeName: 'desk-top-plane',
        options: { normalSide: 'positive' },
      },
    ],
  },
];
