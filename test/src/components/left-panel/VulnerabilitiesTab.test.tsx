import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNetMapStore, useSessionStore, useTabStore } from '@/stores';
import type { VulnerabilityRecord } from '@/types';
import { VulnerabilitiesTab } from '@/components/left-panel/VulnerabilitiesTab';

const vulnerability: VulnerabilityRecord = {
  id: 'vulnerability-1', assetId: 'host-1', title: 'Unauthenticated admin access',
  severity: 'high', status: 'confirmed', description: 'Admin route has no authentication.',
  impact: 'Configuration can be changed.', remediation: 'Require authentication.',
  findingIds: ['finding-1'], evidenceIds: ['evidence-1'],
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
};

describe('VulnerabilitiesTab', () => {
  beforeEach(() => {
    useSessionStore.setState({ vulnerabilities: [vulnerability], upsertVulnerability: vi.fn(async () => vulnerability) });
    useNetMapStore.setState({ nodes: [{ id: 'host-1', label: '192.0.2.10', type: 'host', status: 'vulnerable', portCount: 1, vulnCount: 1 }], edges: [], selectedNodeId: null, highlightedNodeIds: [], layout: 'force', isLoading: false, error: null });
    useTabStore.setState({ tabs: [], activeTabId: null, nextTabNumber: 1 });
  });

  it('opens validated weakness details in the center workspace', () => {
    render(<VulnerabilitiesTab />);
    expect(screen.queryByRole('button', { name: 'Create vulnerability' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Unauthenticated admin access'));
    expect(useNetMapStore.getState().selectedNodeId).toBe('host-1');
    expect(useTabStore.getState().activeTab()).toMatchObject({ type: 'record', data: { recordKind: 'vulnerability', recordId: vulnerability.id } });
    expect(screen.queryByDisplayValue('Configuration can be changed.')).not.toBeInTheDocument();
  });
});
