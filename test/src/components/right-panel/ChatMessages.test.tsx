import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores';
import { ChatMessages } from '@/components/right-panel/ChatMessages';

describe('ChatMessages conversation branches', () => {
  const branchFromMessage = vi.fn(async () => {});

  beforeEach(() => {
    branchFromMessage.mockClear();
    useChatStore.setState({
      messages: [{
        id: 'user-1',
        role: 'user',
        content: 'Scan the original target',
        timestamp: '2026-07-31T00:00:00.000Z',
        status: 'complete',
      }],
      branches: [{
        id: 'main',
        title: 'Main',
        backendId: 'claude',
        createdAt: '2026-07-31T00:00:00.000Z',
        messageCount: 1,
      }],
      activeBranchId: 'main',
      isProcessing: false,
      branchFromMessage,
    });
  });

  it('edits a completed user message and submits a branch retry', () => {
    render(<ChatMessages />);

    fireEvent.click(screen.getByRole('button', {
      name: 'Edit message and create branch',
    }));
    const editor = screen.getByRole('textbox', { name: 'Edited message' });
    fireEvent.change(editor, { target: { value: 'Scan the edited target' } });

    expect(screen.getByText(/project assets.*remain shared/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Branch & retry' }));

    expect(branchFromMessage).toHaveBeenCalledWith('user-1', 'Scan the edited target');
  });

  it('stops following live output while the operator is reading older messages', () => {
    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const flushFrames = () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    };

    const { container } = render(<ChatMessages />);
    act(flushFrames);
    const scroller = container.firstElementChild as HTMLDivElement;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);

    act(() => {
      useChatStore.getState().appendMessage({
        id: 'assistant-live',
        role: 'assistant',
        content: 'live',
        timestamp: '2026-07-31T00:00:01.000Z',
        status: 'streaming',
      });
    });
    expect(scroller.scrollTop).toBe(100);

    scroller.scrollTop = 900;
    fireEvent.scroll(scroller);
    act(() => {
      useChatStore.getState().appendMessage({
        id: 'assistant-live',
        role: 'assistant',
        content: 'live update',
        timestamp: '2026-07-31T00:00:01.000Z',
        status: 'streaming',
      });
    });
    act(flushFrames);
    expect(scroller.scrollTop).toBe(1_000);
  });
});
