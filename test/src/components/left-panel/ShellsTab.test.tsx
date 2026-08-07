import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHELL_IPC } from '@electron/contracts/shell';

const mocks = vi.hoisted(() => ({
  projectId: 'project-1' as string | null,
  openTab: vi.fn(() => 'terminal-2'),
  updateTabData: vi.fn(),
  invoke: vi.fn(),
  queueAgentContext: vi.fn(),
}));

vi.mock('@/stores', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector({
    currentSession: mocks.projectId ? { id: mocks.projectId } : null,
    targets: [{ id: 'target-1', ip: '127.0.0.1', hostname: 'local.test', status: 'active' }],
    assets: [],
  }),
  useTabStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ openTab: mocks.openTab, updateTabData: mocks.updateTabData }),
    { getState: () => ({ tabs: [], setActiveTab: vi.fn() }) },
  ),
  useChatStore: (selector: (state: unknown) => unknown) => selector({ queueAgentContext: mocks.queueAgentContext }),
}));

import { ShellsTab } from '@/components/left-panel/ShellsTab';

describe('ShellsTab', () => {
  beforeEach(() => {
    mocks.projectId = 'project-1';
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === SHELL_IPC.PROFILE_LIST) return [{
        id: 'profile-1', name: 'Local PowerShell', kind: 'local', assetRole: 'target',
        shellFlavor: 'powershell', createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z',
      }];
      return [];
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke: mocks.invoke, on: vi.fn(() => () => {}) },
    });
  });

  it('shows project Shell profiles', async () => {
    render(<ShellsTab />);
    await waitFor(() => expect(screen.getByText('Local PowerShell')).toBeInTheDocument());
    expect(mocks.invoke).toHaveBeenCalledWith(SHELL_IPC.PROFILE_LIST, 'project-1');
  });

  it('opens the compact connection editor without adding a terminal toolbar', async () => {
    render(<ShellsTab />);
    fireEvent.click(screen.getByRole('button', { name: /Connection/i }));
    expect(await screen.findByText('New connection')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save connection' })).toBeInTheDocument();
  });

  it('deletes a stopped reverse listener through the existing listener IPC', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === SHELL_IPC.LISTENER_LIST) return [{
        profile: {
          id: 'listener-1',
          name: 'Loopback listener',
          bindAddress: '127.0.0.1',
          port: 4444,
          shellFlavor: 'raw',
          createdAt: '2026-08-03T00:00:00.000Z',
          updatedAt: '2026-08-03T00:00:00.000Z',
        },
        state: 'stopped',
        sessionCount: 0,
      }];
      return [];
    });

    render(<ShellsTab />);
    const deleteButton = await screen.findByRole('button', { name: 'Delete listener' });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      SHELL_IPC.LISTENER_DELETE,
      'project-1',
      'listener-1',
    ));
  });

  it('opens the Connect Builder from a listener', async () => {
    mocks.invoke.mockImplementation(async (channel: string, request?: { templateId?: string }) => {
      if (channel === SHELL_IPC.LISTENER_LIST) return [{
        profile: {
          id: 'listener-1', name: 'Loopback listener', bindAddress: '127.0.0.1', port: 4444,
          shellFlavor: 'raw', createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z',
        },
        state: 'stopped', sessionCount: 0,
      }];
      if (channel === SHELL_IPC.CONNECT_TEMPLATE_LIST) return [{
        id: 'bash-tcp', label: 'Bash TCP', target: 'Linux / WSL', runtime: 'Bash',
        shell: '/bin/bash', pty: 'partial', note: 'Local fixture only.',
      }];
      if (channel === SHELL_IPC.CONNECT_COMMAND_BUILD) return {
        listenerId: 'listener-1',
        template: { id: request?.templateId ?? 'bash-tcp', label: 'Bash TCP', target: 'Linux / WSL', runtime: 'Bash', shell: '/bin/bash', pty: 'partial', note: 'Local fixture only.' },
        callbackAddress: '127.0.0.1', callbackPort: 4444,
        command: 'local command', localOnly: true, warning: 'Local test only.', obfuscation: 'none',
      };
      return [];
    });

    render(<ShellsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    expect(await screen.findByRole('region', { name: 'Payload Generator' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Generated connection command')).toHaveValue('local command'));
  });
});
