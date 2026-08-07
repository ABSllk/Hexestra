import { describe, expect, it } from 'vitest';
import {
  createConversationBranch,
  createDefaultProjectState,
  mergeProjectState,
  normalizeProjectState,
} from '@electron/services/project-state';

describe('project state', () => {
  it('gives invalid persisted input a complete isolated default state', () => {
    expect(normalizeProjectState({})).toEqual(createDefaultProjectState());
    expect(createDefaultProjectState().workspace).toMatchObject({
      activeTabId: 'terminal-1',
      nextTabNumber: 2,
    });
    expect(createDefaultProjectState().workspace.tabs.map((tab) => tab.type))
      .toEqual(['welcome', 'terminal']);
  });

  it('merges one project without mutating the prior project snapshot', () => {
    const projectA = createDefaultProjectState();
    const projectB = mergeProjectState(projectA, {
      preferences: { permissionMode: 'auto' },
      agent: {
        activeBranchId: 'branch-b',
        branches: [createConversationBranch('branch-b', 'Branch B', {
          runtime: {
            backendId: 'claude',
            sessionId: 'claude-project-b',
            connectionFingerprint: 'native:test',
          },
          messages: [{
            id: 'message-b',
            role: 'assistant',
            content: 'Only project B can see this.',
            timestamp: '2026-07-18T00:00:00.000Z',
            status: 'complete',
          }],
        })],
      },
    });

    expect(projectA.preferences.permissionMode).toBe('default');
    expect(projectA.agent.branches[0].messages).toEqual([]);
    expect(projectB.preferences.permissionMode).toBe('auto');
    expect(projectB.agent.branches[0].runtime?.sessionId).toBe('claude-project-b');
  });

  it('keeps a branch backend identity independent of Claude runtime fields', () => {
    const branch = createConversationBranch('codex-branch', 'Future backend', { backendId: 'codex' });
    expect(branch.backendId).toBe('codex');
    expect(branch.runtime).toBeNull();
  });

  it('maps the former Claude SDK backend label during migration', () => {
    const state = normalizeProjectState({
      version: 5,
      agent: {
        activeBranchId: 'main',
        branches: [{ id: 'main', title: 'Main', backendId: 'claude-agent-sdk', messages: [] }],
      },
    });
    expect(state.agent.branches[0].backendId).toBe('claude');
  });

  it('normalizes interrupted timelines and removes transient tab data', () => {
    const state = normalizeProjectState({
      version: 2,
      agent: {
        activeBranchId: 'main',
        branches: [{
          id: 'main',
          title: 'Main',
          claudeSessionId: null,
          connectionFingerprint: null,
          createdAt: '2026-07-18T00:00:00.000Z',
          messages: [{
            id: 'interrupted',
            role: 'assistant',
            content: 'partial',
            timestamp: '2026-07-18T00:00:00.000Z',
            status: 'streaming',
            sdkMessageId: 'sdk-message-1',
            activities: [{ id: 'tool-1', kind: 'tool', status: 'running', output: 'partial' }],
            attachments: [{
              id: 'attachment-1', name: 'screen.png', path: 'C:\\screen.png', kind: 'image',
              mimeType: 'image/png', size: 42, base64: 'must-not-persist',
            }],
          }],
        }],
      },
      workspace: {
        tabs: [
          { id: 'terminal-1', type: 'terminal', title: 'Terminal', closable: true, data: { output: 'secret' } },
          { id: 'browser-2', type: 'browser', title: 'Browser', closable: true, data: { url: 'https://example.test', contentPreview: 'transient' } },
          { id: 'record-3', type: 'record', title: 'Finding', closable: true, data: { recordKind: 'finding', recordId: 'finding-1', payload: 'transient' } },
        ],
        activeTabId: 'missing',
        nextTabNumber: 3,
      },
    });

    expect(state.agent.branches[0].messages[0]).toMatchObject({
      status: 'complete',
      backendMessageId: 'sdk-message-1',
    });
    expect(state.agent.branches[0].messages[0].activities?.[0])
      .toMatchObject({ status: 'complete' });
    expect(state.agent.branches[0].messages[0].attachments).toEqual([{
      id: 'attachment-1', name: 'screen.png', path: 'C:\\screen.png', kind: 'image',
      mimeType: 'image/png', size: 42,
    }]);
    expect(state.workspace.activeTabId).toBe('terminal-1');
    expect(state.workspace.tabs[0].data).toBeUndefined();
    expect(state.workspace.tabs[1].data).toEqual({ url: 'https://example.test' });
    expect(state.workspace.tabs[2].data).toEqual({ recordKind: 'finding', recordId: 'finding-1' });
  });

  it('preserves complete long conversations when project state is reloaded', () => {
    const messages = Array.from({ length: 501 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: index === 500 ? 'x'.repeat(120_001) : `Turn ${index}`,
      timestamp: '2026-08-01T00:00:00.000Z',
      status: 'complete' as const,
      ...(index === 499 ? {
        activities: Array.from({ length: 101 }, (__, activityIndex) => ({
          id: `activity-${activityIndex}`,
          kind: 'text' as const,
          status: 'complete' as const,
          content: `Activity ${activityIndex}`,
        })),
      } : {}),
    }));

    const state = normalizeProjectState({
      version: 2,
      agent: {
        activeBranchId: 'main',
        branches: [{
          id: 'main',
          title: 'Long conversation',
          claudeSessionId: null,
          connectionFingerprint: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          messages,
        }],
      },
    });

    expect(state.agent.branches[0].messages).toHaveLength(501);
    expect(state.agent.branches[0].messages[499].activities).toHaveLength(101);
    expect(state.agent.branches[0].messages[500].content).toHaveLength(120_001);
  });

  it('restores the traffic tab and keeps proxy endpoints on loopback', () => {
    const state = normalizeProjectState({
      version: 2,
      traffic: {
        enabled: true,
        interceptRequests: true,
        interceptResponses: false,
        listenHost: '0.0.0.0',
        listenPort: 61_234,
        burp: {
          enabled: true,
          mcpUrl: 'https://example.test/sse',
        },
      },
      workspace: {
        tabs: [{ id: 'traffic-2', type: 'traffic', title: 'Traffic', closable: true }],
        activeTabId: 'traffic-2',
        nextTabNumber: 3,
      },
    });

    expect(state.workspace).toMatchObject({ activeTabId: 'traffic-2' });
    expect(state.workspace.tabs[0]).toMatchObject({ id: 'traffic-2', type: 'traffic' });
    expect(state.traffic).toMatchObject({
      enabled: true,
      interceptRequests: true,
      listenHost: '127.0.0.1',
      listenPort: 61_234,
      burp: {
        enabled: true,
        bridgeHost: '127.0.0.1',
        bridgePort: 9_877,
        bridgeToken: '',
        mcpUrl: 'http://127.0.0.1:9876/sse',
      },
    });
  });

  it('migrates version 2 projects to version 3 shell state and persists only restorable terminal metadata', () => {
    const migrated = normalizeProjectState({
      version: 2,
      workspace: {
        tabs: [{ id: 'terminal-2', type: 'terminal', title: 'SSH', closable: true, data: {
          managedShell: true,
          shellProfileId: 'profile-1',
          shellSessionId: 'must-not-persist',
          contentPreview: 'secret output',
        } }],
        activeTabId: 'terminal-2',
        nextTabNumber: 3,
      },
    });

    expect(migrated.version).toBe(6);
    expect(migrated.shells).toEqual({ profiles: [], listeners: [] });
    expect(migrated.workspace.tabs[0].data).toEqual({ managedShell: true, shellProfileId: 'profile-1' });
  });

  it('migrates persisted subagent runs and marks in-flight children interrupted after restart', () => {
    const migrated = normalizeProjectState({
      version: 4,
      agent: {
        activeBranchId: 'main',
        branches: [{
          id: 'main',
          title: 'Main',
          claudeSessionId: null,
          connectionFingerprint: null,
          createdAt: '2026-07-18T00:00:00.000Z',
          messages: [],
          subagentRuns: [{
            id: 'run-1',
            taskId: 'task-1',
            agentType: 'Explore',
            description: 'Inspect headers',
            status: 'running',
            startedAt: '2026-07-18T00:00:00.000Z',
            updatedAt: '2026-07-18T00:01:00.000Z',
            activities: [{ id: 'activity-1', kind: 'text', status: 'streaming', content: 'partial' }],
          }],
        }],
      },
      workspace: { tabs: [] },
    });

    expect(migrated.version).toBe(6);
    expect(migrated.agent.branches[0].subagentRuns[0]).toMatchObject({
      id: 'run-1',
      status: 'interrupted',
      agentType: 'Explore',
    });
    expect(migrated.agent.branches[0].subagentRuns[0].activities[0].status).toBe('streaming');
  });

  it('persists replay tabs and bounded explicit Agent context in version 4 state', () => {
    const state = normalizeProjectState({
      version: 4,
      workspace: {
        tabs: [{ id: 'replay-4', type: 'replay', title: 'Repeater', closable: true, data: { replaySessionId: `replay-${'a'.repeat(32)}`, draft: 'secret' } }],
        activeTabId: 'replay-4', nextTabNumber: 5,
      },
      agent: {
        activeBranchId: 'main',
        branches: [{
          id: 'main', title: 'Main', claudeSessionId: null, connectionFingerprint: null,
          createdAt: '2026-08-03T00:00:00.000Z',
          messages: [{
            id: 'message-1', role: 'user', content: 'Analyze it', timestamp: '2026-08-03T00:00:00.000Z', status: 'complete',
            contextRefs: [
              { kind: 'browser-page', projectId: 'project-1', tabId: 'browser-1', url: 'https://example.test/', title: 'Example', selectionText: 'x'.repeat(20_000) },
              { kind: 'shell-command', projectId: 'project-1', listenerId: 'listener-1', templateId: 'bash-tcp', templateLabel: 'Bash TCP', callbackAddress: '127.0.0.1', callbackPort: 4444, command: 'local command', localOnly: true },
            ],
          }],
        }],
      },
    });
    expect(state.workspace.tabs[0].data).toEqual({ replaySessionId: `replay-${'a'.repeat(32)}` });
    expect(state.agent.branches[0].messages[0].contextRefs?.[0]).toMatchObject({ kind: 'browser-page' });
    expect(state.agent.branches[0].messages[0].contextRefs?.[0]).toHaveProperty('selectionText', 'x'.repeat(12_000));
    expect(state.agent.branches[0].messages[0].contextRefs?.[1]).toMatchObject({
      kind: 'shell-command', listenerId: 'listener-1', command: 'local command', localOnly: true,
    });
  });
});
