import { beforeEach, describe, expect, it } from 'vitest';
import { openTrafficFlowTab, serializeProjectWorkspace, useTabStore } from './useTabStore';

describe('useTabStore project workspaces', () => {
  beforeEach(() => useTabStore.getState().resetProject());

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
});
