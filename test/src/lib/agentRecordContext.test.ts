import { describe, expect, it } from 'vitest';
import { buildSelectedRecordContextTab, type ManagedRecordContextSource } from '@/lib/agentRecordContext';

const source: ManagedRecordContextSource = {
  findings: [{
    id: 'finding-1',
    assetId: 'asset-1',
    title: 'Admin endpoint',
    kind: 'lead',
    confidence: 'high',
    status: 'active',
    description: 'Latest finding description',
    evidenceIds: ['evidence-1'],
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
  }],
  vulnerabilities: [{
    id: 'vulnerability-1',
    assetId: 'asset-1',
    title: 'SQL injection',
    severity: 'high',
    status: 'confirmed',
    description: 'Numbered reproduction steps',
    impact: 'Database access',
    remediation: 'Use parameters',
    findingIds: ['finding-1'],
    evidenceIds: ['evidence-1'],
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
  }],
  evidenceRecords: [{
    id: 'evidence-1',
    assetId: 'asset-1',
    title: 'Scanner response',
    tool: 'curl',
    kind: 'http-response',
    content: 'HTTP/1.1 200 OK',
    findingIds: ['finding-1'],
    vulnerabilityIds: ['vulnerability-1'],
    observedAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
  }],
  reports: [{
    id: 'report-1',
    title: 'Assessment report',
    status: 'draft',
    summary: 'Current summary',
    content: '# Current report',
    findingIds: ['finding-1'],
    vulnerabilityIds: ['vulnerability-1'],
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
  }],
};

describe('selected managed-record Agent context', () => {
  it.each([
    ['finding', 'finding-1', 'Admin endpoint'],
    ['vulnerability', 'vulnerability-1', 'SQL injection'],
    ['evidence', 'evidence-1', 'Scanner response'],
    ['report', 'report-1', 'Assessment report'],
  ] as const)('serializes the current %s record', (recordKind, recordId, title) => {
    const context = buildSelectedRecordContextTab({
      id: `record-${recordId}`,
      type: 'record',
      data: { recordKind, recordId },
    }, source);

    expect(context).toMatchObject({
      tabId: `record-${recordId}`,
      title,
      type: 'record',
    });
    const [serialized] = context!.contentPreview.split('\nRecord locator:');
    expect(JSON.parse(serialized)).toMatchObject({ recordKind, id: recordId, title });
    expect(context!.contentPreview).toContain(`Record locator: ${recordKind}:${recordId}`);
  });

  it('omits non-record, malformed, and missing record tabs', () => {
    expect(buildSelectedRecordContextTab({ id: 'terminal-1', type: 'terminal' }, source)).toBeNull();
    expect(buildSelectedRecordContextTab({ id: 'record-1', type: 'record', data: { recordKind: 'unknown', recordId: 'finding-1' } }, source)).toBeNull();
    expect(buildSelectedRecordContextTab({ id: 'record-2', type: 'record', data: { recordKind: 'finding', recordId: 'missing' } }, source)).toBeNull();
  });
});
