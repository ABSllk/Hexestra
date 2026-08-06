import { create } from 'zustand';

export type LeftPanelView = 'targets' | 'tasktree' | 'records' | 'files' | 'traffic' | 'shells';

interface AppStore {
  // Left panel
  leftPanelView: LeftPanelView;
  setLeftPanelView: (view: LeftPanelView) => void;

  // Bottom panel
  isNetMapVisible: boolean;
  toggleNetMap: () => void;
  setNetMapVisible: (visible: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  leftPanelView: 'targets',
  setLeftPanelView: (view) => set({ leftPanelView: view }),

  isNetMapVisible: true,
  toggleNetMap: () => set((s) => ({ isNetMapVisible: !s.isNetMapVisible })),
  setNetMapVisible: (visible) => set({ isNetMapVisible: visible }),
}));
