import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runApplicationShortcutCommand } from '@/components/layout/AppShell';
import { useAppStore, useSessionStore, useTabStore } from '@/stores';

describe('application shortcut commands', () => {
  const togglePresentationMode = vi.fn();
  const openProjectFolder = vi.fn(async () => null);
  const createProjectFolder = vi.fn(async () => null);

  beforeEach(() => {
    vi.clearAllMocks();
    useTabStore.setState({
      projectId: null,
      tabs: [
        { id: 'welcome-0', type: 'welcome', title: 'Welcome', closable: false },
        { id: 'editor-1', type: 'editor', title: 'File', closable: true },
      ],
      activeTabId: 'welcome-0',
      nextTabNumber: 2,
    });
    useAppStore.setState({ leftPanelView: 'targets', isNetMapVisible: true });
    useSessionStore.setState({ openProjectFolder, createProjectFolder });
  });

  it('runs presentation, project, workspace, and view commands through shared actions', () => {
    runApplicationShortcutCommand('presentation.toggle', togglePresentationMode);
    runApplicationShortcutCommand('project.openFolder', togglePresentationMode);
    runApplicationShortcutCommand('project.createFolder', togglePresentationMode);
    runApplicationShortcutCommand('workspace.newTerminal', togglePresentationMode);
    runApplicationShortcutCommand('workspace.openBrowser', togglePresentationMode);
    runApplicationShortcutCommand('settings.open', togglePresentationMode);
    runApplicationShortcutCommand('view.toggleNetMap', togglePresentationMode);
    runApplicationShortcutCommand('view.openTraffic', togglePresentationMode);

    expect(togglePresentationMode).toHaveBeenCalledOnce();
    expect(openProjectFolder).toHaveBeenCalledOnce();
    expect(createProjectFolder).toHaveBeenCalledOnce();
    expect(useTabStore.getState().tabs.map((tab) => tab.type)).toEqual(expect.arrayContaining(['terminal', 'browser', 'settings']));
    expect(useAppStore.getState()).toMatchObject({ isNetMapVisible: false, leftPanelView: 'traffic' });
  });

  it('wraps tab navigation and refuses to close a non-closable tab', () => {
    runApplicationShortcutCommand('tabs.closeActive', togglePresentationMode);
    expect(useTabStore.getState().tabs).toHaveLength(2);

    runApplicationShortcutCommand('tabs.previous', togglePresentationMode);
    expect(useTabStore.getState().activeTabId).toBe('editor-1');
    runApplicationShortcutCommand('tabs.next', togglePresentationMode);
    expect(useTabStore.getState().activeTabId).toBe('welcome-0');

    useTabStore.getState().setActiveTab('editor-1');
    runApplicationShortcutCommand('tabs.closeActive', togglePresentationMode);
    expect(useTabStore.getState().tabs.map((tab) => tab.id)).toEqual(['welcome-0']);
  });

  it('leaves scoped editor and terminal commands to their owning surfaces', () => {
    const before = useTabStore.getState();
    runApplicationShortcutCommand('editor.save', togglePresentationMode);
    runApplicationShortcutCommand('terminal.copy', togglePresentationMode);
    runApplicationShortcutCommand('terminal.paste', togglePresentationMode);
    expect(useTabStore.getState().tabs).toEqual(before.tabs);
    expect(togglePresentationMode).not.toHaveBeenCalled();
  });
});
