import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNetMapStore, useSessionStore } from '@/stores';
import type { AssetRecord, GraphNode } from '@/types';
import { TargetsTab } from './TargetsTab';

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
    expect(screen.getByText('nginx, React')).toBeInTheDocument();
  });
});
