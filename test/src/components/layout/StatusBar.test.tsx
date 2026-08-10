import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, useEgressProxyStore, useSessionStore, useTabStore } from '@/stores';
import { StatusBar } from '@/components/layout/StatusBar';

describe('StatusBar NetMap control', () => {
  beforeEach(() => {
    useAppStore.setState({ isNetMapVisible: false });
    useSessionStore.setState({
      currentSession: null,
      targets: [],
      assets: [],
    });
    useEgressProxyStore.setState({ projectId: null, status: null, load: vi.fn(async () => undefined) });
    useTabStore.getState().resetProject();
  });

  it('keeps a visible restore button after the NetMap panel is closed', () => {
    render(<StatusBar />);

    const restore = screen.getByRole('button', { name: 'Show NetMap' });
    expect(restore).toHaveTextContent('NETMAPOFF');

    fireEvent.click(restore);

    expect(useAppStore.getState().isNetMapVisible).toBe(true);
    expect(screen.getByRole('button', { name: 'Hide NetMap' })).toHaveTextContent('NETMAPON');
  });

  it('shows the named colored proxy state and disables enforcement when clicked', async () => {
    const setEnabled = vi.fn(async () => undefined);
    useSessionStore.setState({
      currentSession: { id: 'project-1', name: 'Project', findingCount: 0, vulnerabilityCount: 0 } as never,
    });
    useEgressProxyStore.setState({
      projectId: 'project-1',
      status: {
        projectId: 'project-1', revision: 7, state: 'ready', enabled: true,
        activeChainId: 'chain-1', activeChainName: 'Two hop', mixedPort: 41000,
        tcpReady: true, udpReady: false, exitIp: '203.0.113.8',
        lastCheckedAt: '2026-08-10T00:00:00.000Z', error: null,
        chainLatencyMs: 87, latencyCheckedAt: '2026-08-10T00:00:00.000Z', nodeLatencyMs: {},
      },
      setEnabled,
    });
    render(<StatusBar />);
    const proxy = screen.getByRole('button', { name: /Proxy exit 203\.0\.113\.8, status READY/ });
    expect(proxy).toHaveTextContent('PROXYREADY');
    expect(proxy).toHaveClass('text-status-success');
    expect(proxy.querySelector('.bg-status-success')).not.toBeNull();
    expect(proxy).toHaveAttribute('title', expect.stringContaining('203.0.113.8'));
    expect(proxy).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(proxy);
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith(false));
    expect(useTabStore.getState().activeTab()?.type).toBe('welcome');
  });

  it('shows the direct exit IP while off and enables enforcement when clicked', async () => {
    const setEnabled = vi.fn(async () => undefined);
    useSessionStore.setState({
      currentSession: { id: 'project-1', name: 'Project', findingCount: 0, vulnerabilityCount: 0 } as never,
    });
    useEgressProxyStore.setState({
      projectId: 'project-1',
      status: {
        projectId: 'project-1', revision: 8, state: 'off', enabled: false,
        activeChainId: 'chain-1', activeChainName: 'Two hop', mixedPort: null,
        tcpReady: false, udpReady: false, exitIp: '198.51.100.4',
        lastCheckedAt: '2026-08-10T00:01:00.000Z', error: null,
        chainLatencyMs: null, latencyCheckedAt: null, nodeLatencyMs: {},
      },
      setEnabled,
    });
    render(<StatusBar />);

    const proxy = screen.getByRole('button', { name: /Local exit 198\.51\.100\.4, status OFF/ });
    expect(proxy).toHaveTextContent('PROXYOFF');
    expect(proxy).toHaveClass('text-text-muted');
    expect(proxy.querySelector('.bg-text-muted')).not.toBeNull();
    expect(proxy).toHaveAttribute('title', expect.stringContaining('198.51.100.4'));
    fireEvent.click(proxy);
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith(true));
  });
});
