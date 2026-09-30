import { beforeEach, describe, expect, it } from 'vitest';
import { openKnowledgeRefineryTab, openTrafficFlowTab, serializeProjectWorkspace, useTabStore } from '@/stores/useTabStore';

describe('useTabStore project workspaces', () => {
  beforeEach(() => useTabStore.getState().resetProject());

  it('automatically opens Welcome after the last tab or all tabs are closed', () => {
    const store = useTabStore.getState();
    store.closeTab('welcome-0');
    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTab()).toMatchObject({ type: 'welcome', closable: true });
    expect(state.nextTabNumber).toBe(2);
    store.openTab({ type: 'settings', title: 'Settings', closable: true });
    store.closeAllTabs();
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(useTabStore.getState().activeTab()).toMatchObject({ type: 'welcome', closable: true });
  });

  it('restores legacy Welcome as closable and repairs empty workspaces', () => {
    const store = useTabStore.getState();
    store.hydrateProject('legacy', { tabs: [{ id: 'welcome-0', type: 'welcome', title: 'Welcome', closable: false }], activeTabId: 'welcome-0', nextTabNumber: 1 });
    expect(useTabStore.getState().activeTab()?.closable).toBe(true);
    store.hydrateProject('empty', { tabs: [], activeTabId: null, nextTabNumber: 8 });
    expect(useTabStore.getState().activeTab()).toMatchObject({ id: 'welcome-8', type: 'welcome', closable: true });
    expect(useTabStore.getState().nextTabNumber).toBe(9);
  });

  it('replaces the complete workspace when switching projects', () => {
    useTabStore.getState().hydrateProject('project-a', {
      tabs: [{ id: 'terminal-1', type: 'terminal', title: 'A terminal', closable: true }],
      activeTabId: 'terminal-1',
      nextTabNumber: 2,
    });
    expect(useTabStore.getState()).toMatchObject({
      projectId: 'project-a',
      activeTabId: 'terminal-1',
    });

    useTabStore.getState().hydrateProject('project-b', {
      tabs: [{ id: 'browser-4', type: 'browser', title: 'B browser', closable: true, data: { url: 'https://b.test' } }],
      activeTabId: 'browser-4',
      nextTabNumber: 5,
    });
    expect(useTabStore.getState().tabs).toEqual([
      { id: 'browser-4', type: 'browser', title: 'B browser', closable: true, data: { url: 'https://b.test' } },
    ]);
  });

  it('persists only restorable tab metadata', () => {
    const workspace = serializeProjectWorkspace({
      tabs: [
        { id: 'terminal-1', type: 'terminal', title: 'Terminal', closable: true, data: { output: 'do not persist' } },
        { id: 'editor-2', type: 'editor', title: 'Notes', closable: true, data: { filePath: 'notes.md', content: 'transient' } },
        { id: 'browser-3', type: 'browser', title: 'Browser', closable: true, data: { url: 'https://example.test', contentPreview: 'transient' } },
        { id: 'traffic-4', type: 'traffic', title: 'GET example.test/api', closable: true, data: { flowId: 'flow-1', transient: true } },
      ],
      activeTabId: 'browser-3',
      nextTabNumber: 5,
    });

    expect(workspace.tabs.map((tab) => tab.data)).toEqual([
      undefined,
      { filePath: 'notes.md' },
      { url: 'https://example.test' },
      { flowId: 'flow-1' },
    ]);
  });

  it('omits transient remote editor tabs from project workspace state', () => {
    const workspace = serializeProjectWorkspace({
      tabs: [{ id: 'remote-1', type: 'editor', title: 'remote.txt', closable: true, transient: true, data: { fileSource: 'remote', filePath: '/tmp/remote.txt' } }],
      activeTabId: 'remote-1',
      nextTabNumber: 2,
    });
    expect(workspace.tabs).toEqual([]);
    expect(workspace.activeTabId).toBeNull();
  });

  it('opens one reusable detail tab per traffic flow', () => {
    const summary = {
      id: 'flow-1',
      method: 'GET',
      url: 'https://example.test/api?full=true',
      host: 'example.test',
    };

    const firstId = openTrafficFlowTab(summary);
    const secondId = openTrafficFlowTab(summary);

    expect(secondId).toBe(firstId);
    expect(useTabStore.getState().tabs.filter((tab) => tab.type === 'traffic')).toEqual([
      expect.objectContaining({ id: firstId, data: { flowId: 'flow-1' } }),
    ]);
    expect(useTabStore.getState().activeTabId).toBe(firstId);
  });

  it('keeps one reusable refinery workspace and persists only its selected job', () => {
    const firstId = openKnowledgeRefineryTab('refinery-job-1');
    const secondId = openKnowledgeRefineryTab('refinery-job-2');
    expect(secondId).toBe(firstId);
    expect(useTabStore.getState().activeTab()).toMatchObject({ type: 'refinery', data: { jobId: 'refinery-job-2' } });
    expect(serializeProjectWorkspace(useTabStore.getState()).tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'refinery', data: { jobId: 'refinery-job-2' } }),
    ]));
  });

  it('opens a retained source in the reusable refinery text viewer', () => {
    const firstId = openKnowledgeRefineryTab('refinery-job-1');
    const secondId = openKnowledgeRefineryTab(undefined, 'source-1');

    expect(secondId).toBe(firstId);
    expect(useTabStore.getState().activeTab()).toMatchObject({ type: 'refinery', data: { sourceId: 'source-1', jobId: null } });
    expect(serializeProjectWorkspace(useTabStore.getState()).tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'refinery', data: { sourceId: 'source-1' } }),
    ]));
  });
});
