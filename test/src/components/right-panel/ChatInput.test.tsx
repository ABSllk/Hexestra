import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores';
import type { AgentAttachment } from '@/types';
import { ChatInput } from '@/components/right-panel/ChatInput';

const settings = {
  version: 2 as const,
  defaultBackendId: 'claude' as const,
  backends: { claude: {
    version: 1 as const,
    executionMode: 'wsl' as const,
    wslDistribution: 'Ubuntu-24.04',
    claudeExecutable: '/usr/bin/claude',
    model: null,
    settingSources: ['user', 'project', 'local'] as const,
  } },
};

const imageAttachment: AgentAttachment = {
  id: 'attachment-image',
  name: 'screen.png',
  path: 'C:\\screen.png',
  kind: 'image',
  mimeType: 'image/png',
  size: 3,
  base64: 'YWJj',
};

describe('ChatInput composer', () => {
  const sendMessage = vi.fn(async () => {});
  const setPermissionMode = vi.fn();
  const setAutonomyLevel = vi.fn();
  const refreshStatus = vi.fn(async () => {});
  let commandDiscoveryFails = false;
  const eventHandlers = new Map<string, (...args: unknown[]) => void>();
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'agent:settings:get') return settings;
    if (channel === 'agent:commands:list') {
      if (commandDiscoveryFails) throw new Error('Runtime command discovery failed');
      return [
        { name: 'compact', description: 'Compact conversation', argumentHint: '[instructions]', aliases: [] },
        { name: 'context', description: 'Show context usage', argumentHint: '', aliases: [] },
        { name: 'cost', description: 'Show usage', argumentHint: '', aliases: ['usage'] },
        { name: 'doctor', description: 'Check Claude Code health', argumentHint: '', aliases: [] },
      ];
    }
    if (channel === 'claude:skills:list') return {
      runtimeLabel: 'WSL · Ubuntu-24.04',
      projectAvailable: true,
      items: [{
        id: 'project:enabled:recon-helper', name: 'recon-helper',
        description: 'Run the project recon workflow', scope: 'project', enabled: true,
        sourcePath: '/project/.claude/skills/recon-helper/SKILL.md',
      }],
      errors: [],
    };
    if (channel === 'agent:attachments:pick') return [imageAttachment];
    if (channel === 'agent:settings:update') return { ...settings, backends: { claude: { ...settings.backends.claude, model: 'custom-model' } } };
    return undefined;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    commandDiscoveryFails = false;
    eventHandlers.clear();
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn((channel: string, callback: (...args: unknown[]) => void) => {
          eventHandlers.set(channel, callback);
          return () => eventHandlers.delete(channel);
        }),
        once: vi.fn(),
        send: vi.fn(),
      },
    });
    useChatStore.setState({
      sendMessage,
      setPermissionMode,
      setAutonomyLevel,
      refreshStatus,
      permissionMode: 'default',
      autonomyLevel: 'medium',
      isProcessing: false,
      composerText: '',
      composerContextRefs: [],
      composerFocusNonce: 0,
      agentStatus: {
        state: 'ready', available: true, backendId: 'claude', authenticated: true,
        model: 'runtime-model', backendSessionId: null, pendingRequests: 0, historyLength: 0,
        lastError: null, runtimeMode: 'wsl', runtimeLabel: 'WSL · Ubuntu-24.04',
      },
    });
  });

  it('keeps mode and autonomy choices collapsed until their triggers are clicked', async () => {
    render(<ChatInput />);
    expect(screen.queryByRole('button', { name: 'AUTO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'high' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Claude mode ASK' }));
    fireEvent.click(screen.getByRole('button', { name: 'AUTO' }));
    expect(setPermissionMode).toHaveBeenCalledWith('auto');

    fireEvent.click(screen.getByRole('button', { name: 'Autonomy medium' }));
    fireEvent.click(screen.getByRole('button', { name: 'high' }));
    expect(setAutonomyLevel).toHaveBeenCalledWith('high');
  });

  it('attaches an image and sends it with the current prompt', async () => {
    render(<ChatInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Add files or images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add images' }));
    expect(await screen.findByText('screen.png')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Message AI assistant...'), { target: { value: 'Inspect this screenshot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('Inspect this screenshot', [imageAttachment]));
  });

  it('keeps attachments staged instead of silently dropping them for a slash command', async () => {
    render(<ChatInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Add files or images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add images' }));
    expect(await screen.findByText('screen.png')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Message AI assistant...'), { target: { value: '/compact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Send slash commands without attachments or staged context.')).toBeInTheDocument();
    expect(screen.getByText('screen.png')).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('offers keyboard command completion and renders the selected command as a token', async () => {
    render(<ChatInput />);
    const composer = screen.getByRole('combobox');

    fireEvent.change(composer, { target: { value: '/co' } });
    expect(screen.getByRole('listbox', { name: 'Command suggestions' })).toHaveClass('bottom-full', 'mb-2');
    expect(screen.getByRole('listbox', { name: 'Command suggestions' })).not.toHaveClass('bottom-[3.25rem]');
    expect(screen.getByRole('option', { name: /\/compact/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /\/context/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /\/cost/ })).toBeInTheDocument();

    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Edit command /compact' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Command arguments…')).toHaveValue('');

    fireEvent.keyDown(screen.getByPlaceholderText('Command arguments…'), { key: 'Enter' });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('/compact', []));
  });

  it('uses the runtime command catalog, aliases, and argument hints', async () => {
    render(<ChatInput />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('agent:commands:list', null));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/doc' } });
    expect(await screen.findByRole('option', { name: /\/doctor/ })).toHaveTextContent('Check Claude Code health');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/usa' } });
    expect(await screen.findByRole('option', { name: /\/usage/ })).toHaveTextContent('Show usage');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/comp' } });
    expect(await screen.findByRole('option', { name: /\/compact/ })).toHaveTextContent('[instructions]');
  });

  it('replaces the runtime catalog when Claude reports command changes', async () => {
    render(<ChatInput />);
    await waitFor(() => expect(eventHandlers.has('agent:commands-changed')).toBe(true));
    eventHandlers.get('agent:commands-changed')?.({
      sessionId: null,
      commands: [{ name: 'review', description: 'Review changes', argumentHint: '[focus]', aliases: [] }],
    });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/rev' } });
    expect(await screen.findByRole('option', { name: /\/review/ })).toHaveTextContent('Review changes');
    expect(screen.queryByRole('option', { name: /\/doctor/ })).not.toBeInTheDocument();
  });

  it('falls back to enabled Claude Skills when runtime discovery fails', async () => {
    commandDiscoveryFails = true;
    render(<ChatInput />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('claude:skills:list', null));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/rec' } });
    expect(screen.getByRole('option', { name: /\/recon-helper/ })).toHaveTextContent('Run the project recon workflow');
  });

  it('updates the global model from the collapsed model menu', async () => {
    render(<ChatInput />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('agent:settings:get'));
    expect(screen.getByText('MODEL')).toBeInTheDocument();
    expect(screen.queryByText('runtime-model')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Model runtime-model' }));
    expect(screen.getByLabelText('Model')).toHaveClass('bottom-[3.25rem]');
    expect(screen.getByLabelText('Model')).not.toHaveClass('bottom-full');
    fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'custom-model' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply model' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('agent:settings:update', expect.objectContaining({
      backends: expect.objectContaining({ claude: expect.objectContaining({ model: 'custom-model' }) }),
    })));
  });

  it('shows removable Agent context chips without sending automatically', () => {
    useChatStore.getState().queueAgentContext({
      kind: 'browser-page', projectId: 'project-1', tabId: 'browser-1',
      url: 'https://example.test/', title: 'Example', selectionText: 'untrusted page text',
    }, 'Analyze the selected browser text.');
    render(<ChatInput />);
    expect(screen.getByText('Selection: untrusted page text')).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Selection: untrusted page text' }));
    expect(screen.queryByText('Selection: untrusted page text')).not.toBeInTheDocument();
  });

  it('renders a removable local Shell command context chip', () => {
    useChatStore.getState().queueAgentContext({
      kind: 'shell-command', projectId: 'project-1', listenerId: 'listener-1',
      templateId: 'bash-tcp', templateLabel: 'Bash TCP', callbackAddress: '127.0.0.1',
      callbackPort: 4444, command: 'local command', localOnly: true,
    }, 'Explain this local command.');
    render(<ChatInput />);
    expect(screen.getByText('Bash TCP: 127.0.0.1:4444')).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bash TCP: 127.0.0.1:4444' }));
    expect(screen.queryByText('Bash TCP: 127.0.0.1:4444')).not.toBeInTheDocument();
  });
});
