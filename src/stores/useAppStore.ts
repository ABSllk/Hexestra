import { create } from 'zustand';

export type LeftPanelView = 'targets' | 'tasktree' | 'records' | 'files' | 'traffic' | 'shells';

interface AppStore {
  // Left panel
  leftPanelView: LeftPanelView;
  isLeftPanelOpen: boolean;
  setLeftPanelView: (view: LeftPanelView) => void;
  toggleLeftPanelView: (view: LeftPanelView) => void;
  setLeftPanelOpen: (open: boolean) => void;

  // Bottom panel
  isNetMapVisible: boolean;
  toggleNetMap: () => void;
  setNetMapVisible: (visible: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  leftPanelView: 'targets',
  isLeftPanelOpen: true,
  setLeftPanelView: (view) => set({ leftPanelView: view, isLeftPanelOpen: true }),
  toggleLeftPanelView: (view) => set((state) => ({
    leftPanelView: view,
    isLeftPanelOpen: view === state.leftPanelView ? !state.isLeftPanelOpen : true,
  })),
  setLeftPanelOpen: (open) => set({ isLeftPanelOpen: open }),

  isNetMapVisible: true,
  toggleNetMap: () => set((s) => ({ isNetMapVisible: !s.isNetMapVisible })),
  setNetMapVisible: (visible) => set({ isNetMapVisible: visible }),
}));
