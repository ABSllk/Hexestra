import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNetMapStore, useSessionStore, useTabStore } from '@/stores';
import { RecordDetailTab } from '@/components/center-panel/tabs/RecordDetailTab';

describe('RecordDetailTab', () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [{ id: 'record-1', type: 'record', title: 'Admin lead', closable: true, data: { recordKind: 'finding', recordId: 'finding-1' } }],
      activeTabId: 'record-1', nextTabNumber: 2,
    });
    useSessionStore.setState({
      findings: [{ id: 'finding-1', assetId: 'host-1', title: 'Admin lead', kind: 'lead', confidence: 'high', status: 'active', description: 'Useful project knowledge.', evidenceIds: ['evidence-1'], createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }],
      vulnerabilities: [], evidenceRecords: [{ id: 'evidence-1', assetId: 'host-1', title: 'Raw nmap output', tool: 'nmap', kind: 'command_output', content: '22/tcp open ssh', findingIds: ['finding-1'], vulnerabilityIds: [], observedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }], reports: [],
      upsertFinding: vi.fn(async () => null),
    });
    useNetMapStore.setState({ nodes: [{ id: 'host-1', label: 'api.example.com', type: 'host', status: 'scanned', portCount: 0, vulnCount: 0 }] });
  });

  it('renders current project data and edits it from the center workspace', () => {
    render(<RecordDetailTab tabId="record-1" />);
    expect(screen.getByRole('heading', { name: 'Admin lead' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Useful project knowledge.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Finding kind'), { target: { value: 'hypothesis' } });
    expect(useSessionStore.getState().upsertFinding).toHaveBeenCalledWith(expect.objectContaining({ id: 'finding-1', kind: 'hypothesis' }));
  });

  it('leaves Evidence detail content outside presentation masking', () => {
    useTabStore.setState({
      tabs: [{ id: 'record-evidence', type: 'record', title: 'Raw nmap output', closable: true, data: { recordKind: 'evidence', recordId: 'evidence-1' } }],
      activeTabId: 'record-evidence',
      nextTabNumber: 2,
    });

    render(<RecordDetailTab tabId="record-evidence" />);

    expect(screen.getByRole('heading', { name: 'Raw nmap output' })).not.toHaveAttribute('data-presentation-sensitive');
    expect(screen.getByText(/api\.example\.com \/ nmap/)).not.toHaveAttribute('data-presentation-sensitive');
    expect(screen.getByText('22/tcp open ssh')).not.toHaveAttribute('data-presentation-sensitive');
  });

  it('shows linked record titles and opens them as center tabs', () => {
    render(<RecordDetailTab tabId="record-1" />);
    expect(screen.queryByText('evidence-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Raw nmap output' }));

    expect(useTabStore.getState().activeTab()).toMatchObject({
      type: 'record',
      title: 'Raw nmap output',
      data: { recordKind: 'evidence', recordId: 'evidence-1' },
    });
  });

  it('replaces the description draft when a different Finding tab becomes active', () => {
    useTabStore.setState({
      tabs: [
        { id: 'record-1', type: 'record', title: 'Admin lead', closable: true, data: { recordKind: 'finding', recordId: 'finding-1' } },
        { id: 'record-2', type: 'record', title: 'TLS lead', closable: true, data: { recordKind: 'finding', recordId: 'finding-2' } },
      ],
      activeTabId: 'record-1',
      nextTabNumber: 3,
    });
    useSessionStore.setState({
      findings: [
        ...useSessionStore.getState().findings,
        { id: 'finding-2', assetId: 'host-1', title: 'TLS lead', kind: 'observation', confidence: 'medium', status: 'active', description: 'The second Finding description.', evidenceIds: [], createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' },
      ],
    });
    const view = render(<RecordDetailTab tabId="record-1" />);
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Unsaved first Finding draft.' } });

    view.rerender(<RecordDetailTab tabId="record-2" />);

    expect(screen.getByDisplayValue('The second Finding description.')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Unsaved first Finding draft.')).not.toBeInTheDocument();
  });
});
