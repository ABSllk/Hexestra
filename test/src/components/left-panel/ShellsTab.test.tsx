import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHELL_IPC } from '@electron/contracts/shell';
import { DIALOG_IPC } from '@electron/contracts/dialog';
import { ConfirmDialogProvider } from '@/components/shared';

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
    vi.clearAllMocks();
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

  it('separates WebShell endpoint input mode from the target OS shell flavor', async () => {
    render(<ShellsTab />);
    fireEvent.click(screen.getByRole('button', { name: /Connection/i }));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'webshell' } });

    expect(await screen.findByLabelText('WebShell command mode')).toHaveValue('auto');
    expect(screen.getByText('Shell flavor')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('WebShell command mode'), { target: { value: 'php_eval' } });
    expect(screen.getByLabelText('WebShell command mode')).toHaveValue('php_eval');
  });

  it('shows the resolved WebShell endpoint mode on a live session', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === SHELL_IPC.SESSION_LIST) return [{
        id: 'shell-web', projectId: 'project-1', profileId: 'profile-web', kind: 'webshell',
        title: 'PHP endpoint', state: 'ready', revision: 1, shellFlavor: 'posix', webshellCommandMode: 'php_eval',
        capabilities: { resize: false, interrupt: true, exitCode: true, agentExecute: true },
        createdAt: '2026-08-09T00:00:00.000Z', lastActivityAt: '2026-08-09T00:00:00.000Z',
      }];
      return [];
    });

    render(<ShellsTab />);
    expect(await screen.findByText('PHP eval · posix')).toBeInTheDocument();
  });

  it('shows WebShell diagnostics and invokes explicit verification', async () => {
    const health = {
      profileId: 'profile-web', status: 'degraded', adapterId: 'antsword.v2.php', runtime: 'php',
      shellFlavor: 'posix', latencyMs: 87, consecutiveFailures: 2, successRate: 0.75,
      lastCheckedAt: '2026-08-09T00:00:00.000Z', lastSuccessAt: '2026-08-08T00:00:00.000Z',
      lastError: 'previous timeout',
      systemInfo: { os: 'Linux', hostname: 'fixture-host', user: 'www-data', cwd: '/var/www', runtimeVersion: 'PHP 8.3' },
    };
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === SHELL_IPC.PROFILE_LIST) return [{
        id: 'profile-web', name: 'PHP endpoint', kind: 'webshell', assetRole: 'infrastructure', shellFlavor: 'posix',
        webshell: {
          adapterId: 'antsword.v2.php', runtime: 'php', url: 'https://example.test/run', method: 'POST',
          headers: [], bodyKind: 'form', responseExtract: 'body', responseEncoding: 'utf-8', allowInvalidTls: false,
          antsword: { passwordParameter: 'pass', encoder: 'raw' },
        },
        createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z',
      }];
      if (channel === SHELL_IPC.PROFILE_HEALTH) return [health];
      if (channel === SHELL_IPC.PROFILE_VERIFY) return { ...health, status: 'healthy', consecutiveFailures: 0 };
      return [];
    });

    render(<ShellsTab />);
    expect(await screen.findByText(/antsword\.v2\.php · degraded · 87ms · 2 fail/)).toBeInTheDocument();
    expect(screen.queryByTitle('infrastructure')).not.toBeInTheDocument();
    const profileActions = screen.getByRole('group', { name: 'PHP endpoint actions' });
    expect(profileActions).toHaveClass('shrink-0', 'items-center', 'justify-center');
    expect(within(profileActions).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Verify PHP endpoint',
      'Edit PHP endpoint',
      'Delete PHP endpoint',
    ]);
    expect(screen.getAllByTitle(/Host: fixture-host/)[0]).toHaveAttribute('title', expect.stringContaining('Success rate: 75%'));
    expect(screen.getAllByTitle(/Host: fixture-host/)[0]).toHaveAttribute('title', expect.stringContaining('Runtime version: PHP 8.3'));

    const verifyButton = screen.getByRole('button', { name: 'Verify PHP endpoint' });
    expect(verifyButton).toHaveClass('ui-icon-button', 'h-5', 'w-5');
    expect(verifyButton).not.toHaveTextContent('Verify');
    fireEvent.click(verifyButton);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      SHELL_IPC.PROFILE_VERIFY,
      'project-1',
      'profile-web',
    ));
    expect(await screen.findByText(/antsword\.v2\.php · healthy · 87ms · 0 fail/)).toBeInTheDocument();
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

  it('confirms and deletes a session through the existing disconnect IPC', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === SHELL_IPC.SESSION_LIST) return [{
        id: 'shell-1', projectId: 'project-1', profileId: 'profile-1', kind: 'local',
        title: 'Local PowerShell', state: 'ready', revision: 1, shellFlavor: 'powershell',
        capabilities: { resize: true, interrupt: true, exitCode: true, agentExecute: true },
        createdAt: '2026-08-03T00:00:00.000Z', lastActivityAt: '2026-08-03T00:00:00.000Z',
      }];
      if (channel === DIALOG_IPC.CONFIRM) return true;
      return [];
    });

    render(<ConfirmDialogProvider><ShellsTab /></ConfirmDialogProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete session' }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      SHELL_IPC.SESSION_DISCONNECT,
      'project-1',
      'shell-1',
    ));
  });

  it('keeps a session connected when deletion is canceled', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === SHELL_IPC.SESSION_LIST) return [{
        id: 'shell-1', projectId: 'project-1', profileId: 'profile-1', kind: 'local',
        title: 'Local PowerShell', state: 'ready', revision: 1, shellFlavor: 'powershell',
        capabilities: { resize: true, interrupt: true, exitCode: true, agentExecute: true },
        createdAt: '2026-08-03T00:00:00.000Z', lastActivityAt: '2026-08-03T00:00:00.000Z',
      }];
      if (channel === DIALOG_IPC.CONFIRM) return false;
      return [];
    });

    render(<ConfirmDialogProvider><ShellsTab /></ConfirmDialogProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete session' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      DIALOG_IPC.CONFIRM,
      expect.objectContaining({ tone: 'danger' }),
    ));
    expect(mocks.invoke).not.toHaveBeenCalledWith(SHELL_IPC.SESSION_DISCONNECT, 'project-1', 'shell-1');
  });
});
