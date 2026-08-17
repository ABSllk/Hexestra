import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeRefineryLibraryView } from '@/components/left-panel/KnowledgeRefineryLibraryView';
import { useChatStore, useKnowledgeRefineryStore, useSessionStore } from '@/stores';

describe('KnowledgeRefineryLibraryView', () => {
  const invoke = vi.fn(async () => undefined);
  const load = vi.fn(async () => {});
  const newConversation = vi.fn(async () => true);
  const sendMessage = vi.fn(async (_content: string) => {});

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn(() => () => {}),
        once: vi.fn(),
        send: vi.fn(),
      },
    });
    useSessionStore.setState({
      currentSession: {
        id: 'project-1',
        name: 'Project 1',
        status: 'active',
        opsecLevel: 'balanced',
        autonomyLevel: 'medium',
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
        basePath: 'D:\\project-1',
        targetCount: 0,
        findingCount: 0,
        vulnerabilityCount: 0,
      },
    });
    useKnowledgeRefineryStore.setState({
      projectId: 'project-1',
      sources: [{
        id: 'source-abc-123',
        kind: 'document',
        name: 'manual.md',
        fingerprint: 'fingerprint',
        format: 'markdown',
        size: 128,
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
        sourceAvailable: true,
        diagnostics: [],
      }],
      jobs: [],
      loading: false,
      error: null,
      selectedSourceId: 'source-abc-123',
      selectedJobId: null,
      load,
    });
    useChatStore.setState({
      activeProjectId: 'project-1',
      activeBranchId: 'main',
      isProcessing: false,
      error: null,
      newConversation,
      sendMessage,
    });
  });

  it('creates a normal conversation before sending the visible source distill command', async () => {
    const order: string[] = [];
    newConversation.mockImplementationOnce(async () => { order.push('new'); return true; });
    sendMessage.mockImplementationOnce(async (content: string) => { order.push(content); });

    render(<KnowledgeRefineryLibraryView />);
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('/distill source:source-abc-123'));
    expect(order).toEqual(['new', '/distill source:source-abc-123']);
    expect(invoke).not.toHaveBeenCalledWith('refinery:jobs:create-from-source', expect.anything(), expect.anything());
  });

  it('does not send when creating the new conversation fails', async () => {
    newConversation.mockResolvedValueOnce(false);
    useChatStore.setState({ error: 'Conversation creation failed.' });

    render(<KnowledgeRefineryLibraryView />);
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Conversation creation failed.');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
