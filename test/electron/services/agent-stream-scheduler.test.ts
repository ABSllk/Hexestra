import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentStreamScheduler } from '@electron/services/agent-stream-scheduler';

afterEach(() => vi.useRealTimers());

describe('AgentStreamScheduler', () => {
  it('emits the first update immediately and coalesces a token burst', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T00:00:00.000Z'));
    const emit = vi.fn();
    const scheduler = new AgentStreamScheduler();

    scheduler.schedule(emit);
    for (let index = 0; index < 100; index += 1) scheduler.schedule(emit);
    expect(emit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(99);
    expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('cancels a trailing update before the final message is emitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T00:00:00.000Z'));
    const emit = vi.fn();
    const scheduler = new AgentStreamScheduler();
    scheduler.schedule(emit);
    scheduler.schedule(emit);
    scheduler.cancel();
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
