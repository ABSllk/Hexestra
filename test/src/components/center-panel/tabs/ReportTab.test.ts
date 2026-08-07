import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore, usePentestTreeStore, useSessionStore } from '@/stores';
import { buildReport, ReportTab } from '@/components/center-panel/tabs/ReportTab';

const sendMessage = vi.fn(async (_content: string) => {});

beforeEach(() => {
  sendMessage.mockClear();
  useSessionStore.setState({
    currentSession: {
      id: 'project-1', name: 'Assessment', createdAt: '', updatedAt: '', status: 'active',
      opsecLevel: 'balanced', autonomyLevel: 'medium', basePath: '', targetCount: 0,
      findingCount: 0, vulnerabilityCount: 0,
    },
    targets: [],
    findings: [],
    vulnerabilities: [],
    reports: [],
  });
  usePentestTreeStore.setState({ tasks: [] });
  useChatStore.setState({ activeProjectId: 'project-1', isProcessing: false, sendMessage });
});

describe('buildReport', () => {
  it('includes numbered reproduction steps for every vulnerability', () => {
    const report = buildReport('Assessment', [], [], [], [{
      id: 'vulnerability-1',
      assetId: 'host-1',
      title: 'Authorization bypass',
      severity: 'high',
      status: 'confirmed',
      description: '1. Sign in as a standard user.\n2. Request /admin and observe HTTP 200.',
      impact: 'Administrative access.',
      remediation: 'Enforce authorization.',
      findingIds: [],
      evidenceIds: [],
      createdAt: '2026-08-04T00:00:00Z',
      updatedAt: '2026-08-04T00:00:00Z',
    }]);

    expect(report).toContain('#### Reproduction Steps');
    expect(report).toContain('1. Sign in as a standard user.');
    expect(report).toContain('2. Request /admin and observe HTTP 200.');
  });

  it('delegates formal report generation to the dedicated Agent Skill', async () => {
    render(createElement(ReportTab, { tabId: 'report-preview' }));

    fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(sendMessage.mock.calls[0][0]).toContain('$hexestra-report');
    expect(sendMessage.mock.calls[0][0]).toContain('Assessment');
  });
});
