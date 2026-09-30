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

    fireEvent.click(screen.getByRole('button', { name: 'Conversation history' }));
    fireEvent.click(screen.getByRole('option', { name: /Web attack path.*2 messages/ }));

    expect(switchBranch).toHaveBeenCalledWith('conversation-2');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conversation history' })).toHaveFocus();
  });

  it('shows history only in the floating list and marks the active conversation', () => {
    render(<ConversationSelector />);
    const trigger = screen.getByRole('button', { name: 'Conversation history' });
    expect(screen.queryByText('Initial reconnaissance')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: /Initial reconnaissance/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Web attack path/ })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByRole('option', { name: /Initial reconnaissance/ }));
    expect(switchBranch).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('closes history on outside click or Escape and restores keyboard focus', () => {
    render(<ConversationSelector />);
    const trigger = screen.getByRole('button', { name: 'Conversation history' });
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('keeps history and the new-conversation menu mutually exclusive', () => {
    render(<ConversationSelector />);
    const history = screen.getByRole('button', { name: 'Conversation history' });
    const create = screen.getByRole('button', { name: 'New conversation' });
    fireEvent.click(history);
    fireEvent.click(create);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(create).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(history, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(create).toHaveAttribute('aria-expanded', 'false');
  });

  it('handles an empty project history', () => {
    useChatStore.setState({ branches: [] });
    render(<ConversationSelector />);
    fireEvent.click(screen.getByRole('button', { name: 'Conversation history' }));
    expect(screen.getByText('No conversation selected')).toBeInTheDocument();
  });

  it('disables conversation controls without a project', () => {
    useChatStore.setState({ activeProjectId: null, branches: [] });
    render(<ConversationSelector />);
    expect(screen.getByRole('button', { name: 'Conversation history' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
  });

  it('supports keyboard navigation in the conversation menu', () => {
    render(<ConversationSelector />);

    const trigger = screen.getByRole('button', { name: 'Conversation history' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('option', { name: /Initial reconnaissance.*4 messages/ }), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('option', { name: /Web attack path.*2 messages/ }), { key: 'Enter' });

    expect(switchBranch).toHaveBeenCalledWith('conversation-2');
  });

  it('creates a new conversation from the sidebar', () => {
    render(<ConversationSelector />);

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));

    expect(newConversation).toHaveBeenCalledWith('codex');
  });

  it('closes the backend menu on outside click or Escape', () => {
    render(<ConversationSelector />);
    const trigger = screen.getByRole('button', { name: 'New conversation' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('keeps conversation changes available while Claude is running', () => {
    useChatStore.setState({ isProcessing: true });
    render(<ConversationSelector />);

    expect(screen.getByRole('button', { name: 'Conversation history' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'New conversation' })).not.toBeDisabled();
  });
});
