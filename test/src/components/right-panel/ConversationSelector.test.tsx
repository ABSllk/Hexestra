import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores';
import { ConversationSelector } from '@/components/right-panel/ConversationSelector';

describe('ConversationSelector', () => {
  const newConversation = vi.fn(async () => true);
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
          backendId: 'claude',
          createdAt: '2026-07-31T00:00:00.000Z',
          messageCount: 4,
        },
        {
          id: 'conversation-2',
          title: 'Web attack path',
          backendId: 'claude',
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

    fireEvent.click(screen.getByRole('combobox', { name: 'Select conversation' }));
    fireEvent.click(screen.getByRole('option', { name: /Web attack path.*2 messages/ }));

    expect(switchBranch).toHaveBeenCalledWith('conversation-2');
  });

  it('supports keyboard navigation in the conversation menu', () => {
    render(<ConversationSelector />);

    const trigger = screen.getByRole('combobox', { name: 'Select conversation' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('option', { name: /Initial reconnaissance.*4 messages/ }), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('option', { name: /Web attack path.*2 messages/ }), { key: 'Enter' });

    expect(switchBranch).toHaveBeenCalledWith('conversation-2');
  });

  it('creates a new conversation from the sidebar', () => {
    render(<ConversationSelector />);

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));

    expect(newConversation).toHaveBeenCalledOnce();
  });

  it('keeps conversation changes available while Claude is running', () => {
    useChatStore.setState({ isProcessing: true });
    render(<ConversationSelector />);

    expect(screen.getByRole('combobox', { name: 'Select conversation' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'New conversation' })).not.toBeDisabled();
  });
});
