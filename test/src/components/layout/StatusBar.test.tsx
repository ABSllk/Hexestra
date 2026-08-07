import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore, useSessionStore } from '@/stores';
import { StatusBar } from '@/components/layout/StatusBar';

describe('StatusBar NetMap control', () => {
  beforeEach(() => {
    useAppStore.setState({ isNetMapVisible: false });
    useSessionStore.setState({
      currentSession: null,
      targets: [],
      assets: [],
    });
  });

  it('keeps a visible restore button after the NetMap panel is closed', () => {
    render(<StatusBar />);

    const restore = screen.getByRole('button', { name: 'Show NetMap' });
    expect(restore).toHaveTextContent('NetMap: OFF');

    fireEvent.click(restore);

    expect(useAppStore.getState().isNetMapVisible).toBe(true);
    expect(screen.getByRole('button', { name: 'Hide NetMap' })).toHaveTextContent('NetMap: ON');
  });
});
