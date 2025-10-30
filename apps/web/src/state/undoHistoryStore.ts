import { create } from 'zustand';
import type { Vec3, DockOffset, DockAttachment, DockState } from './genericPropsStore';
import { createSnapshotFromProp, type GenericPropSnapshot } from './genericPropsStore';

/**
 * Full snapshot of a generic prop's state for restoration after deletion
 */
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
  beforeSnapshot: GenericPropSnapshot;
  afterSnapshot: GenericPropSnapshot;
  beforeDocked: boolean;
  beforePosition: Vec3;
  beforeRotation: Vec3;
  beforeOffset?: DockOffset;
  beforeAttachment?: DockAttachment;
  beforeState: DockState;
  afterDocked: boolean;
  afterPosition: Vec3;
  afterRotation: Vec3;
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

export type { GenericPropSnapshot } from './genericPropsStore';
