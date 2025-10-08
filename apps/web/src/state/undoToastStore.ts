import { create } from 'zustand';

type UndoToastState = {
  message: string | null;
  isVisible: boolean;
};

type UndoToastActions = {
  show: (message: string) => void;
  hide: () => void;
};

export const useUndoToastStore = create<UndoToastState & UndoToastActions>((set) => ({
  message: null,
  isVisible: false,

  show: (message) => {
    set({ message, isVisible: true });
  },

  hide: () => {
    set({ isVisible: false });
  },
}));
