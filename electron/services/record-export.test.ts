// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { managedRecordFilename, managedRecordMarkdown } from './record-export';

describe('managed record export', () => {
  it('exports a vulnerability with a required reproduction section', () => {
    const markdown = managedRecordMarkdown('vulnerability', {
      id: 'vulnerability-1',
      assetId: 'host-1',
      title: 'Path traversal',
      severity: 'high',
      status: 'confirmed',
      description: '1. Request /download?file=../../etc/hosts.\n2. Observe host file contents.',
      impact: 'Reads server files.',
      remediation: 'Canonicalize and constrain paths.',
      findingIds: [],
      evidenceIds: ['evidence-1'],
      createdAt: '2026-08-04T00:00:00Z',
      updatedAt: '2026-08-04T00:00:00Z',
    });

    expect(markdown).toContain('## Reproduction Steps');
    expect(markdown).toContain('1. Request /download?file=../../etc/hosts.');
    expect(markdown).toContain('## Impact');
  });

  it('sanitizes Windows-unsafe filename characters', () => {
    expect(managedRecordFilename('report', 'Final: api/example?')).toBe('Final_ api_example_.md');
  });
});
