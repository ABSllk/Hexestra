import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore, useNetMapStore, usePentestTreeStore, useSessionStore } from '@/stores';
import type { GraphNode, Session, Target } from '@/types';
import { NetMapAssetDetails } from '@/components/bottom-panel/NetMapAssetDetails';

const now = '2026-08-03T00:00:00.000Z';
const session: Session = {
  id: 'session-netmap-details',
  name: 'NetMap details',
  status: 'active',
  scope: { inScope: ['api.internal'], outOfScope: [], targets: [] },
  opsecLevel: 'balanced',
  autonomyLevel: 'medium',
  createdAt: now,
  updatedAt: now,
  targetCount: 1,
  findingCount: 0,
  vulnerabilityCount: 0,
  basePath: 'test',
};
const target: Target = {
  id: 'host-api',
  ip: '192.0.2.80',
  hostname: 'api.internal',
  domains: ['api.internal'],
  status: 'scanned',
  tags: ['nmap'],
  vulnCount: 0,
  firstSeen: now,
  lastUpdated: now,
  ports: [
    { id: 'host-api:22/tcp', port: 22, protocol: 'tcp', state: 'open', service: 'ssh', version: 'OpenSSH 9.6', firstSeen: now, lastSeen: now },
    { id: 'host-api:443/tcp', port: 443, protocol: 'tcp', state: 'open', service: 'https', version: '1.25', firstSeen: now, lastSeen: now },
  ],
  services: [
    { port: 22, protocol: 'tcp', name: 'ssh', product: 'OpenSSH', version: '9.6' },
    { port: 443, protocol: 'tcp', name: 'https', product: 'nginx', version: '1.25' },
  ],
};
const node: GraphNode = {
  id: target.id,
  key: `host:${target.ip}`,
  label: target.hostname!,
  type: 'host',
  status: target.status,
  ip: target.ip,
  hostname: target.hostname,
  portCount: 2,
  vulnCount: 0,
};

describe('NetMapAssetDetails', () => {
  beforeEach(() => {
    useSessionStore.setState({ currentSession: session, targets: [target], assets: [] });
    useNetMapStore.setState({ nodes: [node], selectedNodeId: node.id });
    useChatStore.setState({ sendMessage: vi.fn(), isProcessing: false });
    usePentestTreeStore.setState({ upsertTask: vi.fn() });
  });

  it('renders complete host and service details in the NetMap overlay', () => {
    render(<NetMapAssetDetails nodeId={node.id} onClose={vi.fn()} />);

    expect(screen.getByRole('complementary', { name: 'Asset details for api.internal' })).toBeInTheDocument();
    expect(screen.getByText('192.0.2.80')).toBeInTheDocument();
    expect(screen.getByText('22/tcp')).toBeInTheDocument();
    expect(screen.getByText('443/tcp')).toBeInTheDocument();
    expect(screen.getByText('nginx 1.25')).toBeInTheDocument();
  });

  it('closes through the supplied navigation action', () => {
    const onClose = vi.fn();
    render(<NetMapAssetDetails nodeId={node.id} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close asset details' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not offer an Agent rescan for an out-of-scope node', () => {
    useNetMapStore.setState({ nodes: [{ ...node, status: 'out_of_scope' }] });
    render(<NetMapAssetDetails nodeId={node.id} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Out of scope' })).toBeDisabled();
  });
});
