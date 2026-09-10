import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNetMapStore, useSessionStore } from '@/stores';
import type { AssetRecord, GraphNode } from '@/types';
import { TargetsTab } from '@/components/left-panel/TargetsTab';

const now = '2026-07-18T00:00:00.000Z';
const asset: AssetRecord = {
  id: 'domain-api', key: 'domain:api.example.com', type: 'domain',
  label: 'api.example.com', status: 'scanned',
  properties: { domain: 'api.example.com', technologies: ['nginx', 'React'] },
  tags: ['subfinder'], vulnCount: 0, firstSeen: now, lastUpdated: now,
};
const node: GraphNode = {
  id: asset.id, key: asset.key, label: asset.label, type: asset.type,
  status: asset.status, properties: asset.properties, portCount: 0, vulnCount: 0,
};

describe('TargetsTab asset inventory', () => {
  beforeEach(() => {
    useSessionStore.setState({ targets: [], assets: [asset] });
    useNetMapStore.setState({
      nodes: [{
        id: 'local-operator', label: 'THIS DEVICE', type: 'local', status: 'scanned',
        portCount: 0, vulnCount: 0,
      }, node],
      edges: [], selectedNodeId: null, highlightedNodeIds: [],
      layout: 'force', isLoading: false, error: null,
    });
  });

  it('lists typed non-host assets and renders their details on selection', () => {
    render(<TargetsTab />);

    expect(screen.getByText('1 asset discovered')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /api\.example\.com/i }));
    expect(useNetMapStore.getState().selectedNodeId).toBe(asset.id);
    expect(screen.getAllByText('api.example.com').length).toBeGreaterThan(1);
    expect(screen.getAllByText('api.example.com').every((element) => element.hasAttribute('data-presentation-sensitive'))).toBe(true);
    expect(screen.getByText('nginx, React')).toBeInTheDocument();
  });

  it('shows identity credential values', () => {
    const identity: AssetRecord = {
      ...asset,
      id: 'identity-visible', key: 'identity:local:realm:alice', type: 'identity', label: 'alice',
      properties: { provider: 'local', realm: 'realm', principal: 'alice', credential_password: 'visible-password' },
    };
    useSessionStore.setState({ assets: [identity] });
    useNetMapStore.setState({
      nodes: [{ ...node, id: identity.id, key: identity.key, type: identity.type, label: identity.label, properties: identity.properties }],
      selectedNodeId: identity.id,
    });
    render(<TargetsTab />);
    expect(screen.getByText('visible-password')).toBeInTheDocument();
  });
});
