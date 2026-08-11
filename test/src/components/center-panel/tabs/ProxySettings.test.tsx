import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EGRESS_PROXY_IPC } from '@electron/contracts/egress-proxy';
import { ProxySettings } from '@/components/center-panel/tabs/ProxySettings';
import { I18nProvider } from '@/i18n';
import { useEgressProxyStore, useSessionStore } from '@/stores';

describe('ProxySettings', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    useSessionStore.setState({ currentSession: { id: 'project-1', name: 'Project' } as never });
    useEgressProxyStore.setState({ projectId: null, status: null, diagnostic: null, nodes: [], nodeTestResult: null, chains: [], busy: null, error: null });
    invoke.mockReset();
    invoke.mockImplementation((channel: string) => {
      if (channel === EGRESS_PROXY_IPC.STATUS) return Promise.resolve({
        projectId: 'project-1', revision: 1, state: 'off', enabled: false,
        activeChainId: null, activeChainName: null, mixedPort: null, tcpReady: false,
        udpReady: false, exitIp: null, lastCheckedAt: null, error: null,
        chainLatencyMs: null, latencyCheckedAt: null, nodeLatencyMs: {},
      });
      if (channel === EGRESS_PROXY_IPC.RUNTIME_DIAGNOSE) return Promise.resolve({ configuredPath: null, exists: false, executable: false, version: null, supported: false, error: 'Select runtime', warning: null });
      if (channel === EGRESS_PROXY_IPC.NODES_LIST || channel === EGRESS_PROXY_IPC.CHAINS_LIST) return Promise.resolve([]);
      if (channel === EGRESS_PROXY_IPC.NODES_IMPORT_BATCH) return Promise.resolve([{ id: 'node-1', name: 'Exit', protocol: 'trojan', tcp: true, udp: false, updatedAt: '2026-08-10T00:00:00.000Z' }]);
      return Promise.resolve(null);
    });
    Object.defineProperty(window, 'hexestra', { configurable: true, value: { invoke, on: vi.fn(() => () => undefined), once: vi.fn(), send: vi.fn() } });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  });

  it('loads only sanitized projections and batch imports one URI per line', async () => {
    render(<I18nProvider><ProxySettings /></I18nProvider>);
    expect(await screen.findByText('Project Proxy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on proxy' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/enforcement/i);
    expect(document.body.textContent).not.toContain('controller-secret');

    const batch = 'trojan://secret@127.0.0.1:443#Exit\n\nsocks5://127.0.0.1:1080#Hop';
    fireEvent.click(screen.getByRole('button', { name: 'Open node import' }));
    fireEvent.change(screen.getByLabelText('URIs (one per line)'), { target: { value: batch } });
    fireEvent.click(screen.getByRole('button', { name: 'Import nodes' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(EGRESS_PROXY_IPC.NODES_IMPORT_BATCH, batch));
  });

  it('combines a scrollable node library with click-to-add chain composition', async () => {
    const nodes = [
      { id: 'node-1', name: 'First', protocol: 'trojan', tcp: true, udp: false, updatedAt: '2026-08-10T00:00:00.000Z' },
      { id: 'node-2', name: 'Second', protocol: 'socks5', tcp: true, udp: true, updatedAt: '2026-08-10T00:00:00.000Z' },
    ];
    invoke.mockImplementation((channel: string) => {
      if (channel === EGRESS_PROXY_IPC.STATUS) return Promise.resolve({
        projectId: 'project-1', revision: 1, state: 'off', enabled: false,
        activeChainId: null, activeChainName: null, mixedPort: null, tcpReady: false,
        udpReady: false, exitIp: null, lastCheckedAt: null, error: null,
        chainLatencyMs: null, latencyCheckedAt: null, nodeLatencyMs: {},
      });
      if (channel === EGRESS_PROXY_IPC.RUNTIME_DIAGNOSE) return Promise.resolve({ configuredPath: null, exists: false, executable: false, version: null, supported: false, error: 'Select runtime', warning: null });
      if (channel === EGRESS_PROXY_IPC.NODES_LIST) return Promise.resolve(nodes);
      if (channel === EGRESS_PROXY_IPC.CHAINS_LIST) return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<I18nProvider><ProxySettings /></I18nProvider>);

    expect(await screen.findByText('Nodes and chains')).toBeInTheDocument();
    expect(screen.getByTestId('proxy-node-library-scroll')).toHaveClass('flex-1', 'overflow-y-auto');
    const nodeLibrary = screen.getByTestId('proxy-node-library');
    const chainEditor = screen.getByTestId('proxy-chain-editor');
    const workspace = nodeLibrary.closest('.ui-card');
    expect(workspace).toHaveClass('h-[25rem]', 'flex', 'overflow-hidden');
    expect(workspace?.querySelectorAll(':scope > .ui-card')).toHaveLength(0);
    expect(nodeLibrary).toHaveStyle({ width: '304px' });
    expect(chainEditor).toHaveClass('flex-1', 'min-w-0');
    expect(screen.queryByLabelText('URIs (one per line)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select proxy chain')).toBeInTheDocument();
    expect(screen.queryByText('Known routing boundary')).not.toBeInTheDocument();

    Object.defineProperty(workspace, 'clientWidth', { configurable: true, value: 1_000 });
    const resizer = screen.getByRole('separator', { name: 'Resize node library' });
    expect(resizer).toHaveAttribute('aria-valuenow', '304');
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(nodeLibrary).toHaveStyle({ width: '320px' });
    expect(resizer).toHaveAttribute('aria-valuenow', '320');
    fireEvent.pointerDown(resizer, { pointerId: 1, button: 0, clientX: 320 });
    fireEvent.pointerMove(resizer, { pointerId: 1, clientX: 380 });
    fireEvent.pointerUp(resizer, { pointerId: 1, clientX: 380 });
    expect(nodeLibrary).toHaveStyle({ width: '380px' });

    const collapseLibrary = screen.getByRole('button', { name: 'Collapse node library' });
    expect(collapseLibrary).toHaveAttribute('aria-expanded', 'true');
    collapseLibrary.focus();
    fireEvent.click(collapseLibrary);
    expect(nodeLibrary).toHaveStyle({ width: '48px' });
    expect(screen.queryByRole('separator', { name: 'Resize node library' })).not.toBeInTheDocument();
    const expandLibrary = screen.getByRole('button', { name: 'Expand node library (2 nodes, 0 selected)' });
    expect(expandLibrary).toHaveAttribute('aria-expanded', 'false');
    expect(expandLibrary).toHaveFocus();
    expect(document.getElementById('proxy-node-library-content')).toHaveClass('hidden');
    fireEvent.click(expandLibrary);
    expect(nodeLibrary).toHaveStyle({ width: '380px' });

    const addFirst = screen.getByRole('button', { name: 'Add node to chain: First' });
    fireEvent.click(addFirst);
    const flow = screen.getByLabelText('Proxy chain traffic order');
    expect(flow).toHaveClass('flex-1', 'items-center');
    expect(within(flow).getByText('First')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Already in chain: First' })).toBeDisabled();
    const addSecond = screen.getByRole('button', { name: 'Add node to chain: Second' });
    expect(addSecond).toBeEnabled();
    fireEvent.click(addSecond);

    fireEvent.click(within(flow).getByRole('button', { name: 'Move node earlier: Second' }));
    expect(flow.textContent?.indexOf('Second')).toBeLessThan(flow.textContent?.indexOf('First') ?? 0);

    const firstFlowNode = within(flow).getByText('First').closest('[draggable="true"]');
    const secondFlowNode = within(flow).getByText('Second').closest('[draggable="true"]');
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'node-1') };
    fireEvent.dragStart(firstFlowNode!, { dataTransfer });
    fireEvent.dragOver(secondFlowNode!, { dataTransfer });
    fireEvent.drop(secondFlowNode!, { dataTransfer });
    expect(flow.textContent?.indexOf('First')).toBeLessThan(flow.textContent?.indexOf('Second') ?? 0);

    fireEvent.click(within(flow).getByRole('button', { name: 'Remove node: First' }));
    expect(screen.getByRole('button', { name: 'Add node to chain: First' })).toBeEnabled();
  });

  it('does not show a compatibility warning for a runnable different version', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === EGRESS_PROXY_IPC.STATUS) return Promise.resolve({
        projectId: 'project-1', revision: 1, state: 'off', enabled: false,
        activeChainId: null, activeChainName: null, mixedPort: null, tcpReady: false,
        udpReady: false, exitIp: null, lastCheckedAt: null, error: null,
        chainLatencyMs: null, latencyCheckedAt: null, nodeLatencyMs: {},
      });
      if (channel === EGRESS_PROXY_IPC.RUNTIME_DIAGNOSE) return Promise.resolve({
        configuredPath: 'C:\\mihomo.exe', exists: true, executable: true,
        version: '1.19.21', supported: true, error: null,
        warning: null,
      });
      if (channel === EGRESS_PROXY_IPC.NODES_LIST || channel === EGRESS_PROXY_IPC.CHAINS_LIST) return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<I18nProvider><ProxySettings /></I18nProvider>);
    expect(await screen.findByText('Project Proxy')).toBeInTheDocument();
    expect(screen.queryByText(/differs from the tested/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unsupported/i)).not.toBeInTheDocument();
  });

  it('shows per-hop and total latency without TCP or UDP readiness labels', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === EGRESS_PROXY_IPC.STATUS) return Promise.resolve({
        projectId: 'project-1', revision: 3, state: 'ready', enabled: true,
        activeChainId: 'chain-1', activeChainName: 'Two hop', mixedPort: 41000,
        tcpReady: true, udpReady: true, exitIp: '203.0.113.8', lastCheckedAt: null, error: null,
        chainLatencyMs: 64, latencyCheckedAt: '2026-08-10T00:00:00.000Z',
        nodeLatencyMs: { 'node-1': 28, 'node-2': 64 },
      });
      if (channel === EGRESS_PROXY_IPC.RUNTIME_DIAGNOSE) return Promise.resolve({
        configuredPath: 'C:\\mihomo.exe', exists: true, executable: true,
        version: '1.19.21', supported: true, error: null, warning: null,
      });
      if (channel === EGRESS_PROXY_IPC.NODES_LIST) return Promise.resolve([
        { id: 'node-1', name: 'Hop', protocol: 'hysteria2', tcp: true, udp: true, updatedAt: '2026-08-10T00:00:00.000Z' },
        { id: 'node-2', name: 'Exit', protocol: 'vless', tcp: true, udp: true, updatedAt: '2026-08-10T00:00:00.000Z' },
      ]);
      if (channel === EGRESS_PROXY_IPC.CHAINS_LIST) return Promise.resolve([
        { id: 'chain-1', name: 'Two hop', nodeIds: ['node-1', 'node-2'] },
      ]);
      if (channel === EGRESS_PROXY_IPC.CHAINS_TEST) return Promise.resolve({
        chainId: 'chain-1', tcpReady: true, udpReady: true, latencyMs: 64,
        nodeLatencyMs: { 'node-1': 28, 'node-2': 64 }, error: null,
      });
      if (channel === EGRESS_PROXY_IPC.NODES_TEST) return Promise.resolve({
        checkedAt: '2026-08-10T00:01:00.000Z',
        nodeLatencyMs: { 'node-1': 18, 'node-2': null },
      });
      return Promise.resolve(null);
    });

    render(<I18nProvider><ProxySettings /></I18nProvider>);

    expect((await screen.findAllByText('Two hop')).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('TCP READY');
    expect(document.body.textContent).not.toContain('UDP READY');

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(EGRESS_PROXY_IPC.NODES_TEST));
    expect(await screen.findByText('18 ms')).toBeInTheDocument();
    expect(screen.getByText('TIMEOUT')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Select proxy chain'), { target: { value: 'chain-1' } });
    expect(await screen.findByText('28 ms')).toBeInTheDocument();
    expect(screen.getAllByText('64 ms').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: 'Test chain' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(EGRESS_PROXY_IPC.CHAINS_TEST, 'project-1', 'chain-1'));
    expect(await screen.findByText('Total chain latency: 64 ms')).toBeInTheDocument();
  });

  it('shows a timed-out hop inside the active multi-hop flow', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === EGRESS_PROXY_IPC.STATUS) return Promise.resolve({
        projectId: 'project-1', revision: 4, state: 'ready', enabled: true,
        activeChainId: 'chain-1', activeChainName: 'Two hop', mixedPort: 41000,
        tcpReady: false, udpReady: false, exitIp: null, lastCheckedAt: null, error: null,
        chainLatencyMs: null, latencyCheckedAt: '2026-08-10T00:00:00.000Z',
        nodeLatencyMs: { 'node-1': 28, 'node-2': null },
      });
      if (channel === EGRESS_PROXY_IPC.RUNTIME_DIAGNOSE) return Promise.resolve({
        configuredPath: 'C:\\mihomo.exe', exists: true, executable: true,
        version: '1.19.21', supported: true, error: null, warning: null,
      });
      if (channel === EGRESS_PROXY_IPC.NODES_LIST) return Promise.resolve([
        { id: 'node-1', name: 'Hop', protocol: 'hysteria2', tcp: true, udp: true, updatedAt: '2026-08-10T00:00:00.000Z' },
        { id: 'node-2', name: 'Exit', protocol: 'vless', tcp: true, udp: true, updatedAt: '2026-08-10T00:00:00.000Z' },
      ]);
      if (channel === EGRESS_PROXY_IPC.CHAINS_LIST) return Promise.resolve([
        { id: 'chain-1', name: 'Two hop', nodeIds: ['node-1', 'node-2'] },
      ]);
      return Promise.resolve(null);
    });

    render(<I18nProvider><ProxySettings /></I18nProvider>);
    fireEvent.change(await screen.findByLabelText('Select proxy chain'), { target: { value: 'chain-1' } });

    const flow = screen.getByLabelText('Proxy chain traffic order');
    expect(within(flow).getByText('28 ms')).toBeInTheDocument();
    expect(within(flow).getByText('TIMEOUT')).toBeInTheDocument();
  });

  it('ignores stale status events for the active project', () => {
    useEgressProxyStore.setState({ projectId: 'project-1', status: {
      projectId: 'project-1', revision: 5, state: 'ready', enabled: true,
      activeChainId: 'chain-1', activeChainName: 'Current', mixedPort: 40000,
      tcpReady: true, udpReady: false, exitIp: '203.0.113.8', lastCheckedAt: null,
      error: null, chainLatencyMs: null, latencyCheckedAt: null, nodeLatencyMs: {},
    } });
    useEgressProxyStore.getState().applyEvent({ projectId: 'project-1', revision: 4, state: 'blocked' });
    expect(useEgressProxyStore.getState().status?.state).toBe('ready');
  });
});
