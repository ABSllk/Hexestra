import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore, useNetMapStore, useSessionStore } from '@/stores';
import type { AssetRecord, GraphNode, Session, Target } from '@/types';
import { AssetWorkspaceTab } from './AssetWorkspaceTab';

const now = '2026-07-19T00:00:00.000Z';
const asset: AssetRecord = {
  id: 'domain-api', key: 'domain:api.example.com', type: 'domain', label: 'api.example.com', status: 'scanned',
  properties: { domain: 'api.example.com' }, tags: [], vulnCount: 0, firstSeen: now, lastUpdated: now,
};
const node: GraphNode = { id: asset.id, key: asset.key, label: asset.label, type: asset.type, status: asset.status, properties: asset.properties, portCount: 0, vulnCount: 0 };
const session: Session = { id: 'session-1', name: 'Test', status: 'active', scope: { inScope: ['example.com'], outOfScope: [], targets: [] }, opsecLevel: 'balanced', autonomyLevel: 'medium', createdAt: now, updatedAt: now, targetCount: 0, findingCount: 0, vulnerabilityCount: 0, basePath: 'test' };

describe('AssetWorkspaceTab', () => {
  beforeEach(() => {
    useSessionStore.setState({ currentSession: session, targets: [], assets: [asset], scanRuns: [{ id: 'scan-1', tool: 'subfinder', startedAt: now, completedAt: now, changeCount: 1 }], assetChanges: [{ id: 'change-1', scanRunId: 'scan-1', assetId: asset.id, kind: 'asset_added', label: 'domain api.example.com', observedAt: now }], updateScope: vi.fn() });
    useNetMapStore.setState({ nodes: [{ id: 'local-operator', label: 'THIS DEVICE', type: 'local', status: 'scanned', portCount: 0, vulnCount: 0 }, node], edges: [], selectedNodeId: null, highlightedNodeIds: [], layout: 'force', isLoading: false, error: null });
    useChatStore.setState({ sendMessage: vi.fn(), isProcessing: false });
  });

  it('searches assets and exposes scan changes', () => {
    render(<AssetWorkspaceTab />);
    expect(screen.getAllByText('api.example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Search assets')).toHaveLength(1);
    expect(screen.queryByLabelText('Filter asset type')).not.toBeInTheDocument();
    fireEvent.focus(screen.getByLabelText('Search assets'));
    expect(screen.getByLabelText('Filter asset type')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Search assets')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search assets'), { target: { value: 'missing' } });
    expect(screen.getByText('No matching assets')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'changes' }));
    expect(screen.getByText('domain api.example.com')).toBeInTheDocument();
    expect(screen.getByText(/subfinder/i)).toBeInTheDocument();
  });

  it('collapses only the filters on outside interaction and keeps the query', () => {
    render(<AssetWorkspaceTab />);
    const search = screen.getByLabelText('Search assets');
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'api' } });
    expect(screen.getByLabelText('Filter asset type')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'changes' }));

    expect(screen.queryByLabelText('Filter asset type')).not.toBeInTheDocument();
    expect(search).toHaveValue('api');
  });

  it('edits project scope from the same workspace', () => {
    render(<AssetWorkspaceTab />);
    fireEvent.click(screen.getByRole('button', { name: 'scope' }));
    fireEvent.change(screen.getByLabelText('Out of Scope'), { target: { value: 'auth.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Scope' }));
    expect(useSessionStore.getState().updateScope).toHaveBeenCalledWith(expect.objectContaining({ outOfScope: ['auth.example.com'] }));
  });

  it('selects inventory assets without rendering a sidebar detail pane', () => {
    render(<AssetWorkspaceTab />);
    fireEvent.click(screen.getByRole('button', { name: /api\.example\.com/i }));
    expect(useNetMapStore.getState().selectedNodeId).toBe(node.id);
    expect(screen.queryByText('Details')).not.toBeInTheDocument();
  });

  it('asks the Agent to define an empty project scope', () => {
    useSessionStore.setState({ currentSession: { ...session, scope: { inScope: [], outOfScope: [], targets: [] } } });
    render(<AssetWorkspaceTab />);
    fireEvent.click(screen.getByRole('button', { name: 'scope' }));
    fireEvent.click(screen.getByRole('button', { name: 'Define Scope with Agent' }));
    expect(useChatStore.getState().sendMessage).toHaveBeenCalledWith(expect.stringContaining('scope_update'));
  });

  it('keeps host inventory rows compact when service details exist', () => {
    const host: Target = {
      id: 'host-api', ip: '192.0.2.80', hostname: 'api.internal', domains: ['api.internal'],
      status: 'scanned', tags: ['nmap'], vulnCount: 0, firstSeen: now, lastUpdated: now,
      ports: [
        { id: 'host-api:22/tcp', port: 22, protocol: 'tcp', state: 'open', service: 'ssh', version: 'OpenSSH 9.6', firstSeen: now, lastSeen: now },
        { id: 'host-api:443/tcp', port: 443, protocol: 'tcp', state: 'open', service: 'https', version: '1.25', firstSeen: now, lastSeen: now },
      ],
      services: [
        { port: 22, protocol: 'tcp', name: 'ssh', product: 'OpenSSH', version: '9.6' },
        { port: 443, protocol: 'tcp', name: 'https', product: 'nginx', version: '1.25' },
      ],
    };
    const hostNode: GraphNode = { id: host.id, key: `host:${host.ip}`, label: host.hostname!, type: 'host', status: host.status, ip: host.ip, hostname: host.hostname, portCount: 2, vulnCount: 0 };
    useSessionStore.setState({ targets: [host], assets: [] });
    useNetMapStore.setState({ nodes: [{ id: 'local-operator', label: 'THIS DEVICE', type: 'local', status: 'scanned', portCount: 0, vulnCount: 0 }, hostNode], edges: [], selectedNodeId: null, highlightedNodeIds: [], layout: 'force', isLoading: false, error: null });

    render(<AssetWorkspaceTab />);
    fireEvent.click(screen.getByRole('button', { name: /api\.internal/i }));

    expect(useNetMapStore.getState().selectedNodeId).toBe(host.id);
    expect(screen.getByText('2 ports')).toBeInTheDocument();
    expect(screen.queryByText('22/tcp')).not.toBeInTheDocument();
  });

  it('does not render detail actions for an out-of-scope asset in the sidebar', () => {
    useNetMapStore.setState((state) => ({ ...state, nodes: state.nodes.map((item) => item.id === node.id ? { ...item, status: 'out_of_scope' } : item), selectedNodeId: node.id }));
    render(<AssetWorkspaceTab />);
    expect(screen.queryByRole('button', { name: 'Out of scope' })).not.toBeInTheDocument();
  });
});
