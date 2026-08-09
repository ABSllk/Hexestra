import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TabBar } from '@/components/center-panel/TabBar';
import { useTabStore } from '@/stores';

describe('TabBar overflow behavior', () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [
        { id: 'welcome-0', type: 'welcome', title: 'Welcome', closable: false },
        { id: 'terminal-1', type: 'terminal', title: 'Short', closable: true },
        { id: 'editor-2', type: 'editor', title: 'A much longer tab title', closable: true },
      ],
      activeTabId: 'welcome-0',
      nextTabNumber: 3,
    });
  });

  it('renders every tab with the same fixed width', () => {
    render(<TabBar />);

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveClass('w-40', 'flex-none');
    }
  });

  it('converts a vertical wheel gesture into horizontal scrolling when tabs overflow', () => {
    render(<TabBar />);
    const tabList = screen.getByRole('tablist');
    Object.defineProperties(tabList, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 480 },
    });
    tabList.scrollLeft = 0;

    fireEvent.wheel(tabList, { deltaX: 0, deltaY: 80 });

    expect(tabList.scrollLeft).toBe(80);
  });

  it('keeps the active tab visible when selection changes', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    render(<TabBar />);
    scrollIntoView.mockClear();

    fireEvent.click(screen.getByRole('tab', { name: /A much longer tab title/ }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });
});
