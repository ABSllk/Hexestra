import { create } from 'zustand';
import { isManagedRecordKind, type ManagedRecordKind, type ProjectWorkspaceState } from '@/types';
import type { BrowserPostBody } from '@electron/contracts/browser';
import type { TrafficSummary } from '@electron/contracts/traffic';

export type TabType = 'terminal' | 'editor' | 'browser' | 'traffic' | 'replay' | 'report' | 'record' | 'settings' | 'welcome';

export interface TabDefinition {
  id: string;
  type: TabType;
  title: string;
  icon?: string;
  closable: boolean;
  data?: Record<string, unknown>;
}

interface TabStore {
  projectId: string | null;
  // State
  tabs: TabDefinition[];
  activeTabId: string | null;
  nextTabNumber: number;

  // Actions
  openTab: (tab: Omit<TabDefinition, 'id'>) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (tabId: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  updateTabData: (tabId: string, data: Record<string, unknown>) => void;
  hydrateProject: (projectId: string, workspace: ProjectWorkspaceState) => void;
  resetProject: () => void;

  // Derived helper
  activeTab: () => TabDefinition | null;
}

const DEFAULT_WORKSPACE: ProjectWorkspaceState = {
  tabs: [{ id: 'welcome-0', type: 'welcome', title: 'Welcome', closable: false }],
  activeTabId: 'welcome-0',
  nextTabNumber: 1,
};

export const useTabStore = create<TabStore>((set, get) => ({
  projectId: null,
  tabs: DEFAULT_WORKSPACE.tabs,
  activeTabId: DEFAULT_WORKSPACE.activeTabId,
  nextTabNumber: DEFAULT_WORKSPACE.nextTabNumber,

  openTab: (tab) => {
    const id = `${tab.type}-${get().nextTabNumber}`;
    set((s) => ({
      tabs: [...s.tabs, { ...tab, id }],
      activeTabId: id,
      nextTabNumber: s.nextTabNumber + 1,
    }));
    return id;
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === tabId);
    const newTabs = tabs.filter((t) => t.id !== tabId);

    let newActive = activeTabId;
    if (activeTabId === tabId) {
      if (newTabs.length === 0) {
        newActive = null;
      } else {
        newActive = newTabs[Math.min(idx, newTabs.length - 1)].id;
      }
    }

    set({ tabs: newTabs, activeTabId: newActive });
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  closeAllTabs: () => set({ tabs: [], activeTabId: null }),

  closeOtherTabs: (tabId) =>
    set((s) => ({
      tabs: s.tabs.filter((t) => t.id === tabId || !t.closable),
      activeTabId: tabId,
    })),

  updateTabTitle: (tabId, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    })),

  updateTabData: (tabId, data) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, data: { ...t.data, ...data } } : t)),
    })),

  hydrateProject: (projectId, workspace) => set({
    projectId,
    tabs: workspace.tabs.map((tab) => ({ ...tab })),
    activeTabId: workspace.activeTabId,
    nextTabNumber: workspace.nextTabNumber,
  }),

  resetProject: () => set({
    projectId: null,
    tabs: DEFAULT_WORKSPACE.tabs.map((tab) => ({ ...tab })),
    activeTabId: DEFAULT_WORKSPACE.activeTabId,
    nextTabNumber: DEFAULT_WORKSPACE.nextTabNumber,
  }),

  activeTab: () => {
    const { tabs, activeTabId } = get();
    return tabs.find((t) => t.id === activeTabId) ?? null;
  },
}));

export function serializeProjectWorkspace(state: Pick<TabStore, 'tabs' | 'activeTabId' | 'nextTabNumber'>): ProjectWorkspaceState {
  return {
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      type: tab.type,
      title: tab.title,
      closable: tab.closable,
      data: persistedTabData(tab),
    })),
    activeTabId: state.activeTabId,
    nextTabNumber: state.nextTabNumber,
  };
}

export type SettingsPage = 'general' | 'connection' | 'traffic' | 'burp' | 'skills' | 'mcp';

export function openSettingsTab(page: SettingsPage = 'general') {
  const store = useTabStore.getState();
  const existing = store.tabs.find((tab) => tab.type === 'settings');
  if (existing) {
    store.updateTabData(existing.id, { settingsPage: page });
    store.setActiveTab(existing.id);
    return existing.id;
  }
  return store.openTab({ type: 'settings', title: 'Settings', closable: true, data: { settingsPage: page } });
}

export function openBrowserTab(url = 'https://example.com/', postBody?: BrowserPostBody) {
  return useTabStore.getState().openTab({
    type: 'browser',
    title: 'Browser',
    icon: 'browser',
    closable: true,
    data: { url, ...(postBody ? { postBody } : {}) },
  });
}

export function openTrafficFlowTab(flow: Pick<TrafficSummary, 'id' | 'method' | 'url' | 'host'>) {
  const store = useTabStore.getState();
  const existing = store.tabs.find((tab) => tab.type === 'traffic' && tab.data?.flowId === flow.id);
  if (existing) {
    store.setActiveTab(existing.id);
    return existing.id;
  }

  return store.openTab({
    type: 'traffic',
    title: trafficFlowTitle(flow),
    icon: 'activity',
    closable: true,
    data: { flowId: flow.id },
  });
}

export function openReplayTab(session: { id: string; sourceFlowId: string }, title = 'Hexestra Repeater') {
  const store = useTabStore.getState();
  const existing = store.tabs.find((tab) => tab.type === 'replay' && tab.data?.replaySessionId === session.id);
  if (existing) {
    store.setActiveTab(existing.id);
    return existing.id;
  }
  return store.openTab({
    type: 'replay',
    title,
    icon: 'activity',
    closable: true,
    data: { replaySessionId: session.id, sourceFlowId: session.sourceFlowId },
  });
}

export function openRecordTab(recordKind: ManagedRecordKind, recordId: string, title: string) {
  const store = useTabStore.getState();
  const existing = store.tabs.find((tab) => (
    tab.type === 'record'
    && tab.data?.recordKind === recordKind
    && tab.data?.recordId === recordId
  ));
  if (existing) {
    store.setActiveTab(existing.id);
    return existing.id;
  }
  return store.openTab({
    type: 'record',
    title,
    icon: recordKind === 'vulnerability' ? 'vulnerability' : 'report',
    closable: true,
    data: { recordKind, recordId },
  });
}

function persistedTabData(tab: TabDefinition) {
  if (tab.type === 'terminal' && (tab.data?.managedShell === true || typeof tab.data?.shellProfileId === 'string')) {
    return {
      managedShell: true,
      shellProfileId: typeof tab.data?.shellProfileId === 'string' ? tab.data.shellProfileId : undefined,
    };
  }
  if (tab.type === 'editor' && typeof tab.data?.filePath === 'string') {
    return { filePath: tab.data.filePath };
  }
  if (tab.type === 'browser' && typeof tab.data?.url === 'string') {
    return { url: tab.data.url };
  }
  if (tab.type === 'traffic' && typeof tab.data?.flowId === 'string') {
    return { flowId: tab.data.flowId };
  }
  if (tab.type === 'replay' && typeof tab.data?.replaySessionId === 'string') {
    return { replaySessionId: tab.data.replaySessionId };
  }
  if (tab.type === 'record'
    && isManagedRecordKind(tab.data?.recordKind)
    && typeof tab.data?.recordId === 'string') {
    return { recordKind: tab.data.recordKind, recordId: tab.data.recordId };
  }
  return undefined;
}

function trafficFlowTitle(flow: Pick<TrafficSummary, 'method' | 'url' | 'host'>) {
  let path = flow.url;
  try {
    const url = new URL(flow.url);
    path = `${url.pathname}${url.search}`;
  } catch {
    // Keep the original URL when a partially captured request cannot be parsed.
  }
  const target = `${flow.host}${path}`;
  return `${flow.method} ${target.length > 34 ? `${target.slice(0, 31)}…` : target}`;
}
