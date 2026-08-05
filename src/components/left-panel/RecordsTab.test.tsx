import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNetMapStore, useSessionStore, useTabStore } from '@/stores';
import { RecordsTab } from './RecordsTab';

describe('RecordsTab', () => {
  beforeEach(() => {
    useSessionStore.setState({
      currentSession: {
        id: 'project-1', name: 'Project', status: 'active', opsecLevel: 'balanced', autonomyLevel: 'medium',
        basePath: 'C:/project', targetCount: 1, findingCount: 1, vulnerabilityCount: 1,
        createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
      },
      findings: [{
        id: 'finding-1', assetId: 'host-1', title: 'Admin lead', kind: 'lead', confidence: 'high', status: 'active',
        description: 'Reusable lead.', evidenceIds: [], createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
      }],
      vulnerabilities: [{
        id: 'vulnerability-1', assetId: 'host-1', title: 'Admin bypass', severity: 'high', status: 'confirmed',
        description: '1. Open /admin.\n2. Observe access.', impact: 'Admin access.', remediation: 'Require authentication.',
        findingIds: ['finding-1'], evidenceIds: [], createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
      }],
      evidenceRecords: [{
        id: 'evidence-1', assetId: 'host-1', title: 'HTTP response', tool: 'curl', kind: 'http',
        content: 'HTTP/1.1 200 OK', findingIds: [], vulnerabilityIds: [], observedAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
      }],
      reports: [{
        id: 'report-1', title: 'Final report', status: 'final', summary: 'Summary',
        content: '# Result\n\nOne issue.', findingIds: [], vulnerabilityIds: [], createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
      }],
    });
    useNetMapStore.setState({
      nodes: [{ id: 'host-1', label: '192.0.2.10', type: 'host', status: 'scanned', portCount: 0, vulnCount: 0 }],
      edges: [], selectedNodeId: null, highlightedNodeIds: [], layout: 'force', isLoading: false, error: null,
    });
    useTabStore.setState({ tabs: [], activeTabId: null, nextTabNumber: 1 });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke: vi.fn(async () => undefined), on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
    });
  });

  it('browses managed Evidence and selects its linked asset', () => {
    render(<RecordsTab />);
    fireEvent.click(screen.getByRole('button', { name: /Evidence 1/i }));
    fireEvent.click(screen.getByText('HTTP response'));
    expect(useNetMapStore.getState().selectedNodeId).toBe('host-1');
    expect(useTabStore.getState().activeTab()).toMatchObject({ type: 'record', data: { recordKind: 'evidence', recordId: 'evidence-1' } });
    expect(screen.queryByText('HTTP/1.1 200 OK')).not.toBeInTheDocument();
  });

  it('renders managed Report Markdown', () => {
    render(<RecordsTab />);
    fireEvent.click(screen.getByRole('button', { name: /Reports 1/i }));
    fireEvent.click(screen.getByText('Final report'));
    expect(useTabStore.getState().activeTab()).toMatchObject({ type: 'record', data: { recordKind: 'report', recordId: 'report-1' } });
    expect(screen.queryByRole('heading', { name: 'Result' })).not.toBeInTheDocument();
  });

  it('offers open, copy, export, and delete actions from every record list', () => {
    render(<RecordsTab />);

    for (const [tabName, recordTitle] of [
      [/Findings 1/i, 'Admin lead'],
      [/Vulns 1/i, 'Admin bypass'],
      [/Evidence 1/i, 'HTTP response'],
      [/Reports 1/i, 'Final report'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: tabName }));
      fireEvent.contextMenu(screen.getByText(recordTitle));
      expect(screen.getByRole('menuitem', { name: 'Open details' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Copy as JSON' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Export Markdown…' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /^Delete / })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
    }
  });
});
