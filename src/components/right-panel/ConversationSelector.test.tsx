import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores';
import { ConversationSelector } from './ConversationSelector';

describe('ConversationSelector', () => {
  const newConversation = vi.fn(async () => {});
  const switchBranch = vi.fn(async () => {});

  beforeEach(() => {
    newConversation.mockClear();
    switchBranch.mockClear();
    useChatStore.setState({
      activeProjectId: 'project-a',
      activeBranchId: 'main',
      branches: [
        {
          id: 'main',
          title: 'Initial reconnaissance',
          createdAt: '2026-07-31T00:00:00.000Z',
          messageCount: 4,
        },
        {
          id: 'conversation-2',
          title: 'Web attack path',
          createdAt: '2026-07-31T00:01:00.000Z',
          messageCount: 2,
        },
      ],
      isProcessing: false,
      newConversation,
      switchBranch,
    });
  });

  it('selects a persisted conversation', () => {
    render(<ConversationSelector />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Select conversation' }), {
      target: { value: 'conversation-2' },
    });

    expect(switchBranch).toHaveBeenCalledWith('conversation-2');
  });

  it('creates a new conversation from the sidebar', () => {
    render(<ConversationSelector />);

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));

    expect(newConversation).toHaveBeenCalledOnce();
  });

  it('disables conversation changes while Claude is running', () => {
    useChatStore.setState({ isProcessing: true });
    render(<ConversationSelector />);

    expect(screen.getByRole('combobox', { name: 'Select conversation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
  });
});
