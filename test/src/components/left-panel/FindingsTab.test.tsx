import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNetMapStore, useSessionStore, useTabStore } from '@/stores';
import type { AsmFinding } from '@/types';
import { FindingsTab } from '@/components/left-panel/FindingsTab';

const finding: AsmFinding = { id: 'finding-1', assetId: 'host-1', title: 'Admin interface exposed', kind: 'lead', confidence: 'high', status: 'active', description: 'HTTP 200 on the administrative route.', evidenceIds: ['evidence-1'], createdAt: '2026-07-19T00:00:00Z', updatedAt: '2026-07-19T00:00:00Z' };

describe('FindingsTab', () => {
  beforeEach(() => {
    useSessionStore.setState({ findings: [finding], upsertFinding: vi.fn(async () => finding) });
    useNetMapStore.setState({ nodes: [{ id: 'host-1', label: '192.0.2.10', type: 'host', status: 'vulnerable', portCount: 1, vulnCount: 1 }], edges: [], selectedNodeId: 'host-1', highlightedNodeIds: [], layout: 'force', isLoading: false, error: null });
    useTabStore.setState({ tabs: [], activeTabId: null, nextTabNumber: 1 });
  });

  it('opens the linked finding as a center workspace tab', () => {
    render(<FindingsTab />);
    fireEvent.click(screen.getByText('Admin interface exposed'));
    expect(useTabStore.getState().activeTab()).toMatchObject({
      type: 'record',
      data: { recordKind: 'finding', recordId: finding.id },
    });
    expect(screen.queryByDisplayValue('HTTP 200 on the administrative route.')).not.toBeInTheDocument();
  });
});
