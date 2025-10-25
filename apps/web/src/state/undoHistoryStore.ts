import { create } from 'zustand';
import type { Vec3, DockOffset, DockAttachment, DockState, GenericProp } from './genericPropsStore';
import type { AnchorConfig } from '@/canvas/props/GLTFProp';

/**
 * Full snapshot of a generic prop's state for restoration after deletion
 */
export type GenericPropSnapshot = {
  id: string;
  catalogId: string;
  label?: string;
  url: string;
  anchor?: AnchorConfig;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  docked: boolean;
  locked: boolean;
  dockOffset?: DockOffset;
  dockState: DockState;
  dockAttachment?: DockAttachment;
};

export function createSnapshotFromProp(prop: GenericProp): GenericPropSnapshot {
  return {
    id: prop.id,
    catalogId: prop.catalogId ?? '',
    label: prop.label,
    url: prop.url,
    anchor: prop.anchor,
    position: [prop.position[0], prop.position[1], prop.position[2]],
    rotation: [prop.rotation[0], prop.rotation[1], prop.rotation[2]],
    scale: [prop.scale[0], prop.scale[1], prop.scale[2]],
    docked: prop.docked,
    locked: prop.locked,
    dockOffset: prop.dockOffset
      ? { ...prop.dockOffset }
      : undefined,
    dockState: prop.dockState,
    dockAttachment: prop.dockAttachment
      ? {
          ...prop.dockAttachment,
          offsetUV: { ...prop.dockAttachment.offsetUV },
          surfaceSnapshot: prop.dockAttachment.surfaceSnapshot
            ? prop.dockAttachment.surfaceSnapshot.type === 'rect'
              ? { ...prop.dockAttachment.surfaceSnapshot }
              : {
                  ...prop.dockAttachment.surfaceSnapshot,
                  points: prop.dockAttachment.surfaceSnapshot.points.map(([x, y]) => [x, y] as [number, number]),
                  obb: prop.dockAttachment.surfaceSnapshot.obb
                    ? {
                        center: [...prop.dockAttachment.surfaceSnapshot.obb.center] as [number, number],
                        right: [...prop.dockAttachment.surfaceSnapshot.obb.right] as [number, number],
                        up: [...prop.dockAttachment.surfaceSnapshot.obb.up] as [number, number],
                        extents: [...prop.dockAttachment.surfaceSnapshot.obb.extents] as [number, number],
                      }
                    : undefined,
                }
            : undefined,
        }
      : undefined,
  };
}

/**
 * Discriminated union of all undoable actions
 */
export type UndoAction =
  | { type: 'spawn'; propId: string; snapshot: GenericPropSnapshot }
  | { type: 'delete'; propId: string; snapshot: GenericPropSnapshot }
  | { type: 'move'; propId: string; before: Vec3; after: Vec3 }
  | { type: 'rotate'; propId: string; before: Vec3; after: Vec3 }
  | { type: 'scale'; propId: string; before: Vec3; after: Vec3 }
  | {
      type: 'dock';
      propId: string;
      beforeDocked: boolean;
      afterDocked: boolean;
      beforePos: Vec3;
      afterPos: Vec3;
      dockOffset?: DockOffset;
      dockAttachment?: DockAttachment;
      beforeState?: DockState;
      afterState?: DockState;
    }
  | {
      type: 'undock';
      propId: string;
      beforeDocked: boolean;
      afterDocked: boolean;
      beforePos: Vec3;
      afterPos: Vec3;
      dockOffset?: DockOffset;
      dockAttachment?: DockAttachment;
      beforeState?: DockState;
      afterState?: DockState;
    }
  | {
      type: 'desk-swap';
      oldDesk: GenericPropSnapshot;
      newDesk: GenericPropSnapshot;
      attachments: DeskSwapAttachmentSnapshot[];
    };

export type DeskSwapAttachmentSnapshot = {
  propId: string;
  beforeDocked: boolean;
  beforeOffset?: DockOffset;
  beforeAttachment?: DockAttachment;
  beforeState: DockState;
  afterDocked: boolean;
  afterOffset?: DockOffset;
  afterAttachment?: DockAttachment;
  afterState: DockState;
};

type UndoHistoryState = {
  actions: UndoAction[];
  maxDepth: number;
};

type UndoHistoryActions = {
  push: (action: UndoAction) => void;
  undo: () => UndoAction | null;
  clear: () => void;
};

const MAX_UNDO_DEPTH = 50;

export const useUndoHistoryStore = create<UndoHistoryState & UndoHistoryActions>((set, get) => ({
  actions: [],
  maxDepth: MAX_UNDO_DEPTH,

  push: (action) => {
    set((state) => {
      const newActions = [...state.actions, action];
      // Enforce max depth (FIFO removal)
      if (newActions.length > state.maxDepth) {
        newActions.shift();
      }
      return { actions: newActions };
    });
  },

  undo: () => {
    const { actions } = get();
    if (actions.length === 0) return null;

    const lastAction = actions[actions.length - 1];
    set({ actions: actions.slice(0, -1) });
    return lastAction;
  },

  clear: () => {
    set({ actions: [] });
  },
}));
