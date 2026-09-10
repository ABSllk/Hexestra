import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextIndicator } from '@/components/right-panel/ContextIndicator';
import { useChatStore, useNetMapStore } from '@/stores';

describe('ContextIndicator presentation privacy', () => {
  const toggleTabSharing = vi.fn();

  beforeEach(() => {
    toggleTabSharing.mockClear();
    useChatStore.setState({
      contextTabs: [{
        tabId: 'browser-1',
        title: 'analytics.example.test',
        type: 'browser',
        contentPreview: 'https://analytics.example.test',
        isShared: true,
      }],
      toggleTabSharing,
    });
    useNetMapStore.setState({
      nodes: [
        { id: 'host-1', label: 'archlinux', type: 'host', status: 'scanned', portCount: 0, vulnCount: 0 },
        { id: 'host-2', label: 'gateway', type: 'host', status: 'scanned', portCount: 0, vulnCount: 0 },
      ],
      edges: [{ id: 'edge-1', source: 'host-1', target: 'host-2', type: 'connected_to' }],
      selectedNodeId: 'host-1',
    });
  });

  it('marks selected targets and shared tab titles without obscuring the eye control', () => {
    render(<ContextIndicator />);

    expect(screen.getByText('archlinux · 1')).toHaveAttribute('data-presentation-sensitive');
    expect(screen.getByText('analytics.example.test')).toHaveAttribute('data-presentation-sensitive');

    fireEvent.click(screen.getByRole('button', { name: 'analytics.example.test' }));
    expect(toggleTabSharing).toHaveBeenCalledWith('browser-1');
  });
});
