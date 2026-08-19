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
      chatScrollTop: 0,
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

  it('wraps an unbroken user message inside a narrow chat panel', () => {
    const longToken = 'https://example.test/' + 'a'.repeat(160);
    useChatStore.setState({
      messages: [{
        id: 'user-long',
        role: 'user',
        content: longToken,
        timestamp: '2026-07-31T00:00:00.000Z',
        status: 'complete',
      }],
    });

    render(<ChatMessages />);

    const bubble = screen.getByText(longToken);
    expect(bubble).toHaveClass('min-w-0', 'max-w-full', '[overflow-wrap:anywhere]');
    expect(bubble.parentElement).toHaveClass('min-w-0', 'max-w-[90%]');
  });

  it('does not expose provider-pending state as a queued chat badge', () => {
    useChatStore.setState({
      messages: [{
        id: 'legacy-queued-user',
        role: 'user',
        content: 'Continue after this action',
        timestamp: '2026-08-19T00:00:00.000Z',
        status: 'queued',
        source: 'operator',
      }],
    });

    render(<ChatMessages />);

    expect(screen.getByText('Continue after this action')).toBeInTheDocument();
    expect(screen.queryByText('Queued')).not.toBeInTheDocument();
    expect(screen.queryByText('排队中')).not.toBeInTheDocument();
  });

  it('keeps following streaming output after restoring a saved bottom position', () => {
    let nextFrameId = 0;
    let scrollHeight = 1_000;
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
    useChatStore.setState({ chatScrollTop: 900 });

    const { container } = render(<ChatMessages />);
    const scroller = container.firstElementChild as HTMLDivElement;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    });
    act(flushFrames);
    expect(scroller.scrollTop).toBe(900);

    scrollHeight = 1_100;
    act(() => {
      useChatStore.getState().appendMessage({
        id: 'assistant-live',
        role: 'assistant',
        content: 'streamed output',
        timestamp: '2026-07-31T00:00:01.000Z',
        status: 'streaming',
      });
    });
    act(flushFrames);

    expect(scroller.scrollTop).toBe(1_100);
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

  it('stops following as soon as the operator wheels upward from the bottom', () => {
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
    scroller.scrollTop = 900;
    fireEvent.scroll(scroller);

    fireEvent.wheel(scroller, { deltaY: -20 });
    act(() => {
      useChatStore.getState().appendMessage({
        id: 'assistant-live',
        role: 'assistant',
        content: 'live update before the browser scroll event',
        timestamp: '2026-07-31T00:00:01.000Z',
        status: 'streaming',
      });
    });
    act(flushFrames);

    expect(scroller.scrollTop).toBe(900);
  });
});
