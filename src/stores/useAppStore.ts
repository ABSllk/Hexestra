import { create } from 'zustand';

export type LeftPanelView = 'targets' | 'tasktree' | 'records' | 'files' | 'traffic' | 'shells';
export type Theme = 'dark' | 'light';

interface AppStore {
  // Left panel
  leftPanelView: LeftPanelView;
  setLeftPanelView: (view: LeftPanelView) => void;

  // Theme
  theme: Theme;
  toggleTheme: () => void;

  // Bottom panel
  isNetMapVisible: boolean;
  toggleNetMap: () => void;
  setNetMapVisible: (visible: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  leftPanelView: 'targets',
  setLeftPanelView: (view) => set({ leftPanelView: view }),

  theme: 'dark',
  toggleTheme: () =>
    set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

  isNetMapVisible: true,
  toggleNetMap: () => set((s) => ({ isNetMapVisible: !s.isNetMapVisible })),
  setNetMapVisible: (visible) => set({ isNetMapVisible: visible }),
}));
