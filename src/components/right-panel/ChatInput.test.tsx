import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores';
import type { AgentAttachment } from '@/types';
import { ChatInput } from './ChatInput';

const settings = {
  version: 1 as const,
  executionMode: 'wsl' as const,
  wslDistribution: 'Ubuntu-24.04',
  claudeExecutable: '/usr/bin/claude',
  model: null,
  settingSources: ['user', 'project', 'local'] as const,
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
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'agent:settings:get') return settings;
    if (channel === 'agent:attachments:pick') return [imageAttachment];
    if (channel === 'agent:settings:update') return { ...settings, model: 'custom-model' };
    return undefined;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(() => vi.fn()), once: vi.fn(), send: vi.fn() },
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
        state: 'ready', sdkAvailable: true, backend: 'claude-agent-sdk', authenticated: true,
        model: 'runtime-model', claudeSessionId: null, pendingRequests: 0, historyLength: 0,
        lastError: null, executionMode: 'wsl', runtimeLabel: 'WSL · Ubuntu-24.04',
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

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('agent:settings:update', expect.objectContaining({ model: 'custom-model' })));
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
