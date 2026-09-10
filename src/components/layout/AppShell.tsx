import { useEffect, useMemo } from 'react';
import { FourPanelLayout } from './FourPanelLayout';
import { StatusBar } from './StatusBar';
import { LeftPanelContainer } from '@/components/left-panel/LeftPanelContainer';
import { TabContainer } from '@/components/center-panel/TabContainer';
import { AIChatSidebar } from '@/components/right-panel/AIChatSidebar';
import { NetMapView } from '@/components/bottom-panel/NetMapView';
import { ErrorBoundary } from '@/components/shared';
import { projectNetMapNodes } from '@/lib/networkGraph';
import { useAppStore, useChatStore, useNetMapStore, usePentestTreeStore, useSessionStore, useTabStore } from '@/stores';
import { openBrowserTab, openSettingsTab, serializeProjectWorkspace } from '@/stores/useTabStore';
import type { ProjectWorkspaceState } from '@/types';
import { TitleBar } from './TitleBar';
import { BROWSER_IPC, type BrowserContextActionEvent, type BrowserOpenTabEvent } from '@electron/contracts/browser';
import { isSessionDataChangedEvent } from '@electron/contracts/session';
import { usePresentationMode } from '@/hooks/usePresentationMode';
import { SHORTCUT_COMMAND_EVENT, isShortcutCommandId, type ShortcutCommandId } from '@electron/contracts/shortcuts';

export function AppShell() {
  const presentationMode = usePresentationMode();
  const currentSessionId = useSessionStore((state) => state.currentSession?.id);
  const targets = useSessionStore((state) => state.targets);
  const assets = useSessionStore((state) => state.assets);
  const netmapEdges = useSessionStore((state) => state.netmapEdges);
  const loadTargets = useSessionStore((state) => state.loadTargets);
  const loadNetMap = useSessionStore((state) => state.loadNetMap);
  const loadFiles = useSessionStore((state) => state.loadFiles);
  const loadAsm = useSessionStore((state) => state.loadAsm);
  const loadTasks = usePentestTreeStore((state) => state.loadTasks);
  const setGraphData = useNetMapStore((state) => state.setGraphData);
  const selectNode = useNetMapStore((state) => state.selectNode);
  const activateProject = useChatStore((state) => state.activateProject);
  const deactivateProject = useChatStore((state) => state.deactivateProject);
  const tabProjectId = useTabStore((state) => state.projectId);
  const tabs = useTabStore((state) => state.tabs);
  const activeTabId = useTabStore((state) => state.activeTabId);
  const nextTabNumber = useTabStore((state) => state.nextTabNumber);
  const workspaceKey = useMemo(
    () => JSON.stringify(serializeProjectWorkspace({ tabs, activeTabId, nextTabNumber })),
    [activeTabId, nextTabNumber, tabs],
  );
  const browserTabIdsKey = useMemo(
    () => JSON.stringify(tabs.filter((tab) => tab.type === 'browser').map((tab) => tab.id)),
    [tabs],
  );

  useEffect(() => {
    if (!window.hexestra) return;
    return window.hexestra.on(SHORTCUT_COMMAND_EVENT, (value: unknown) => {
      if (isShortcutCommandId(value)) runApplicationShortcutCommand(value, presentationMode.toggle);
    });
  }, [presentationMode.toggle]);

  useEffect(() => {
    if (!window.hexestra) return;
    const removeOpenTab = window.hexestra.on(BROWSER_IPC.OPEN_TAB, (value: unknown) => {
      const event = value as BrowserOpenTabEvent;
      if (!event || event.projectId !== useTabStore.getState().projectId || typeof event.url !== 'string') return;
      openBrowserTab(event.url, event.postBody);
    });
    const removeContextAction = window.hexestra.on(BROWSER_IPC.CONTEXT_ACTION, (value: unknown) => {
      const event = value as BrowserContextActionEvent;
      if (!event || event.projectId !== useTabStore.getState().projectId) return;
      const ref = {
        kind: 'browser-page' as const,
        projectId: event.projectId,
        tabId: event.tabId,
        url: event.url,
        title: event.title,
        ...(event.selectionText ? { selectionText: event.selectionText } : {}),
        ...(event.linkUrl ? { linkUrl: event.linkUrl, linkText: event.linkText } : {}),
      };
      const prompt = event.action === 'ask-selection'
        ? 'Analyze the selected browser text.'
        : event.action === 'ask-link'
          ? 'Analyze this link in the context of the current project.'
          : 'Analyze the current browser page.';
      useChatStore.getState().queueAgentContext(ref, prompt);
    });
    return () => {
      removeOpenTab();
      removeContextAction();
    };
  }, []);

  useEffect(() => {
    if (!currentSessionId) {
      deactivateProject();
      useTabStore.getState().resetProject();
      return;
    }
    const requestedSessionId = currentSessionId;
    void activateProject(requestedSessionId)
      .then((workspace) => {
        if (useSessionStore.getState().currentSession?.id === requestedSessionId) {
          useTabStore.getState().hydrateProject(requestedSessionId, workspace);
        }
      })
      .catch((error) => console.error('[Project] Failed to activate project:', error));
  }, [activateProject, currentSessionId, deactivateProject]);

  useEffect(() => {
    if (!window.hexestra || !currentSessionId || tabProjectId !== currentSessionId) return;
    const timeout = window.setTimeout(() => {
      const workspace = JSON.parse(workspaceKey) as ProjectWorkspaceState;
      void window.hexestra.invoke('project:update', currentSessionId, { workspace });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [currentSessionId, tabProjectId, workspaceKey]);

  useEffect(() => {
    if (!window.hexestra) return;
    const projectId = currentSessionId && tabProjectId === currentSessionId ? currentSessionId : null;
    const tabIds = projectId ? JSON.parse(browserTabIdsKey) as string[] : [];
    void window.hexestra.invoke(BROWSER_IPC.RECONCILE, { projectId, tabIds })
      .catch((error) => console.error('[Browser] Failed to reconcile tabs:', error));
  }, [browserTabIdsKey, currentSessionId, tabProjectId]);

  useEffect(() => {
    if (!currentSessionId) {
      setGraphData([], []);
      selectNode(null);
      return;
    }
    selectNode(null);
    void loadTargets(currentSessionId);
    void loadNetMap(currentSessionId);
    void loadFiles();
    void loadTasks(currentSessionId);
    void loadAsm(currentSessionId);
  }, [currentSessionId, loadAsm, loadFiles, loadNetMap, loadTargets, loadTasks, selectNode, setGraphData]);

  useEffect(() => {
    if (!window.hexestra) return;
    return window.hexestra.on('session:data-changed', (payload: unknown) => {
      if (!isSessionDataChangedEvent(payload)) return;
      const change = payload;
      if (change.sessionId !== currentSessionId) return;
      if (change.scope) useSessionStore.getState().applyScope(change.scope);
      if (change.targets) void loadTargets(change.sessionId);
      if (change.netmap) void loadNetMap(change.sessionId);
      if (change.tasks) void loadTasks(change.sessionId);
      if (change.files) void loadFiles();
      if (change.findings || change.vulnerabilities || change.evidence || change.reports || change.changes) void loadAsm(change.sessionId);
    });
  }, [currentSessionId, loadAsm, loadFiles, loadNetMap, loadTargets, loadTasks]);

  useEffect(() => {
    if (!currentSessionId) return;
    setGraphData(projectNetMapNodes(targets, assets), netmapEdges);
  }, [assets, currentSessionId, netmapEdges, setGraphData, targets]);

  return (
    <div
      className="h-screen flex flex-col bg-canvas"
      data-presentation-mode={presentationMode.enabled ? 'true' : 'false'}
    >
      <TitleBar />
      {/* Main resizable layout */}
      <div className="flex-1 min-h-0">
        <FourPanelLayout
          leftPanel={<ErrorBoundary label="Left panel" compact><LeftPanelContainer /></ErrorBoundary>}
          centerPanel={<ErrorBoundary label="Workspace" compact><TabContainer /></ErrorBoundary>}
          rightPanel={<ErrorBoundary label="AI sidebar" compact><AIChatSidebar /></ErrorBoundary>}
          bottomPanel={<ErrorBoundary label="NetMap" compact><NetMapView /></ErrorBoundary>}
        />
      </div>

      {/* Status bar at the very bottom */}
      <StatusBar />
    </div>
  );
}

export function runApplicationShortcutCommand(commandId: ShortcutCommandId, togglePresentationMode: () => void) {
  const tabs = useTabStore.getState();
  switch (commandId) {
    case 'presentation.toggle':
      togglePresentationMode();
      return;
    case 'project.openFolder':
      void useSessionStore.getState().openProjectFolder().catch((error) => console.error('[Project] Open Folder failed:', error));
      return;
    case 'project.createFolder':
      void useSessionStore.getState().createProjectFolder().catch((error) => console.error('[Project] New Project Folder failed:', error));
      return;
    case 'workspace.newTerminal':
      tabs.openTab({ type: 'terminal', title: 'Terminal', closable: true });
      return;
    case 'workspace.openBrowser':
      openBrowserTab();
      return;
    case 'settings.open':
      openSettingsTab();
      return;
    case 'tabs.closeActive': {
      const active = tabs.activeTab();
      if (active?.closable) tabs.closeTab(active.id);
      return;
    }
    case 'tabs.next':
      activateAdjacentTab(1);
      return;
    case 'tabs.previous':
      activateAdjacentTab(-1);
      return;
    case 'view.toggleNetMap':
      useAppStore.getState().toggleNetMap();
      return;
    case 'view.openTraffic':
      useAppStore.getState().setLeftPanelView('traffic');
      return;
    case 'editor.save':
    case 'terminal.copy':
    case 'terminal.paste':
      return;
  }
}

function activateAdjacentTab(direction: -1 | 1) {
  const store = useTabStore.getState();
  if (!store.tabs.length) return;
  const currentIndex = store.tabs.findIndex((tab) => tab.id === store.activeTabId);
  const startIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (startIndex + direction + store.tabs.length) % store.tabs.length;
  const next = store.tabs[nextIndex];
  if (next) store.setActiveTab(next.id);
}
