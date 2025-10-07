import { create } from 'zustand';
import type { Vec3, DockOffset } from './genericPropsStore';
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
  dockOffset?: DockOffset;
};

/**
 * Discriminated union of all undoable actions
 */
export type UndoAction =
  | { type: 'spawn'; propId: string; snapshot: GenericPropSnapshot }
  | { type: 'delete'; propId: string; snapshot: GenericPropSnapshot }
  | { type: 'move'; propId: string; before: Vec3; after: Vec3 }
  | { type: 'rotate'; propId: string; before: Vec3; after: Vec3 }
  | { type: 'scale'; propId: string; before: Vec3; after: Vec3 }
  | { type: 'dock'; propId: string; beforeDocked: boolean; afterDocked: boolean; beforePos: Vec3; afterPos: Vec3; dockOffset?: DockOffset }
  | { type: 'undock'; propId: string; beforeDocked: boolean; afterDocked: boolean; beforePos: Vec3; afterPos: Vec3; dockOffset?: DockOffset };

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
