// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAssetRecord } from './asset-record';
import { AssetGraphRepository } from './asset-graph.repository';

const now = '2026-07-19T00:00:00.000Z';

describe('AssetGraphRepository', () => {
  let directory: string;
  let repository: AssetGraphRepository;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-graph-'));
    repository = new AssetGraphRepository(directory);
  });

  afterEach(() => {
    repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('stores hosts, endpoints, and non-host assets in one engagement database', () => {
    const target = repository.upsertTarget({
      id: 'host-1', ip: '192.0.2.10', hostname: 'api.example.com', domains: ['api.example.com'],
      status: 'scanned', tags: ['nmap'], vulnCount: 0, aiSummary: 'Public API host.',
      ports: [{ id: 'host-1:443/tcp', port: 443, protocol: 'tcp', state: 'open', service: 'https', version: 'nginx', firstSeen: now, lastSeen: now }],
      services: [{ port: 443, protocol: 'tcp', name: 'https', product: 'nginx' }],
      firstSeen: now, lastUpdated: now,
    });
    const domain = repository.upsertAsset(createAssetRecord('domain', 'api.example.com'));
    repository.upsertRelation(domain.id, target.id, 'resolves_to', { tool: 'nmap' });

    expect(fs.existsSync(path.join(directory, '.hexestra', 'engagement.db'))).toBe(true);
    expect(repository.listTargets()[0]).toMatchObject({
      id: 'host-1',
      ports: [expect.objectContaining({ port: 443, service: 'https', version: 'nginx' })],
      services: [expect.objectContaining({ name: 'https', product: 'nginx' })],
    });
    expect(repository.listAssets()).toEqual([expect.objectContaining({ id: domain.id })]);
    expect(repository.listRelations()).toEqual([
      expect.objectContaining({ source: domain.id, target: target.id, type: 'resolves_to' }),
    ]);
  });

  it('deduplicates one host identity and increments relation evidence', () => {
    const base = {
      id: 'host-a', ip: '192.0.2.20', domains: [], status: 'untested', tags: [], ports: [], services: [],
      vulnCount: 0, firstSeen: now, lastUpdated: now,
    };
    const first = repository.upsertTarget(base);
    const second = repository.upsertTarget({ ...base, id: 'host-b', hostname: 'shared.example.com', status: 'scanned' });
    repository.upsertRelation(undefined, first.id, 'connected_to', { tool: 'nmap' });
    repository.upsertRelation(undefined, first.id, 'connected_to', { tool: 'nmap' });

    expect(second.id).toBe(first.id);
    expect(repository.listTargets()).toHaveLength(1);
    expect(repository.listRelations()[0].metadata?.evidenceCount).toBe('2');
  });

  it('never persists the scope-derived out-of-scope projection', () => {
    const target = repository.upsertTarget({
      id: 'host-scope', ip: '198.51.100.10', domains: [], status: 'out_of_scope', tags: [],
      ports: [], services: [], vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    const candidate = createAssetRecord('domain', 'outside.example.net');
    const asset = repository.upsertAsset({ ...candidate, status: 'out_of_scope' });

    expect(target.status).toBe('untested');
    expect(asset.status).toBe('untested');
  });

  it('persists the Domain graph layout state', () => {
    repository.upsertTarget({
      id: 'host-1', ip: '192.0.2.30', domains: [], status: 'untested', tags: [], ports: [], services: [],
      vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    repository.updateLayoutState({
      view: { x: 12, y: 8, scale: 1.4 },
      positions: { 'host-1': { x: 220, y: 90 } },
    });

    expect(repository.getLayoutState()).toMatchObject({
      view: { x: 12, y: 8, scale: 1.4 }, positions: { 'host-1': { x: 220, y: 90 } },
    });
  });

  it('rolls back a failed graph transaction', () => {
    expect(() => repository.transaction(() => {
      repository.upsertAsset(createAssetRecord('domain', 'rollback.example.com'));
      throw new Error('stop');
    })).toThrow('stop');
    expect(repository.listAssets()).toEqual([]);
  });

  it('records scan history and material asset changes', () => {
    const target = repository.upsertTarget({
      id: 'host-change', ip: '192.0.2.40', domains: [], status: 'scanned', tags: [], ports: [], services: [],
      vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    const runId = repository.recordScanRun('nmap', target.id);
    repository.recordAssetChange(runId, {
      assetId: target.id,
      kind: 'endpoint_added',
      field: '443/tcp',
      label: '192.0.2.40 exposed 443/tcp https',
      after: 'open | https | nginx',
    });

    expect(repository.listScanRuns()[0]).toMatchObject({ id: runId, tool: 'nmap', changeCount: 1 });
    expect(repository.listAssetChanges()[0]).toMatchObject({
      scanRunId: runId, assetId: target.id, kind: 'endpoint_added', field: '443/tcp',
    });
  });

  it('stores asset-linked and project-level Findings without changing risk counts', () => {
    const target = repository.upsertTarget({
      id: 'host-finding', ip: '192.0.2.50', domains: [], status: 'scanned', tags: [], ports: [], services: [],
      vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    const finding = repository.upsertFinding({
      assetId: target.id,
      title: 'Exposed administrative interface',
      kind: 'lead',
      confidence: 'high',
      status: 'active',
      description: 'HTTP 200 on /admin',
    });
    const projectFinding = repository.upsertFinding({ title: 'The operator prefers low-noise validation', kind: 'note' });
    repository.upsertFinding({ ...finding, status: 'used' });

    expect(repository.listFindings()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: finding.id, status: 'used', assetId: target.id }),
      expect.objectContaining({ id: projectFinding.id, assetId: undefined }),
    ]));
    expect(repository.getTarget(target.id)?.vulnCount).toBe(0);
  });

  it('refreshes both asset risk counts when a Vulnerability is reassigned', () => {
    const base = {
      domains: [], status: 'scanned' as const, tags: [], ports: [], services: [],
      vulnCount: 0, firstSeen: now, lastUpdated: now,
    };
    const first = repository.upsertTarget({ ...base, id: 'host-first', ip: '192.0.2.60' });
    const second = repository.upsertTarget({ ...base, id: 'host-second', ip: '192.0.2.61' });
    const vulnerability = repository.upsertVulnerability({
      assetId: first.id,
      title: 'Validated weakness moved after attribution review',
      severity: 'high',
    });

    repository.upsertVulnerability({ ...vulnerability, assetId: second.id });

    expect(repository.getTarget(first.id)?.vulnCount).toBe(0);
    expect(repository.getTarget(second.id)?.vulnCount).toBe(1);
  });

  it('stores linked Evidence, Findings, Vulnerabilities, and Reports as one managed record graph', () => {
    const target = repository.upsertTarget({
      id: 'host-records', ip: '192.0.2.70', domains: [], status: 'scanned', tags: [], ports: [], services: [],
      vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    const evidence = repository.upsertEvidence({
      assetId: target.id,
      title: 'Admin endpoint response',
      tool: 'curl',
      kind: 'http-response',
      content: 'HTTP/1.1 200 OK',
    });
    const finding = repository.upsertFinding({
      assetId: target.id,
      title: 'Administrative endpoint exposed',
      kind: 'lead',
      confidence: 'high',
      evidenceIds: [evidence.id],
    });
    const vulnerability = repository.upsertVulnerability({
      assetId: target.id,
      title: 'Unauthenticated administrative endpoint',
      severity: 'high',
      description: 'The endpoint permits administrative access without authentication.',
      impact: 'An external actor can change configuration.',
      remediation: 'Require authentication and restrict network access.',
      findingIds: [finding.id],
      evidenceIds: [evidence.id],
    });
    const report = repository.upsertReport({
      title: 'Assessment summary',
      status: 'final',
      summary: 'One confirmed exposure.',
      content: [
        '# Assessment summary',
        '',
        '## Unauthenticated administrative endpoint',
        '',
        '### Reproduction Steps',
        '',
        '1. Request the administrative endpoint without authentication.',
        '',
        '### Observable Results',
        '',
        'The server returns the protected administrative interface.',
      ].join('\n'),
      findingIds: [finding.id],
      vulnerabilityIds: [vulnerability.id],
    });

    expect(repository.listEvidence()[0]).toMatchObject({ id: evidence.id, findingIds: [finding.id], vulnerabilityIds: [vulnerability.id] });
    expect(repository.listFindings()[0]).toMatchObject({ id: finding.id, evidenceIds: [evidence.id] });
    expect(repository.listVulnerabilities()[0]).toMatchObject({ id: vulnerability.id, findingIds: [finding.id], evidenceIds: [evidence.id] });
    expect(repository.listReports()[0]).toMatchObject({ id: report.id, status: 'final', findingIds: [finding.id], vulnerabilityIds: [vulnerability.id] });
    expect(repository.getTarget(target.id)?.vulnCount).toBe(1);
  });

  it('enforces complete reproduction coverage only for final linked reports', () => {
    const target = repository.upsertTarget({
      id: 'host-report-validation', ip: '192.0.2.73', domains: [], status: 'scanned', tags: [],
      ports: [], services: [], vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    const vulnerability = repository.upsertVulnerability({
      assetId: target.id,
      title: 'Authorization bypass',
      description: '1. Request /admin as a standard user.\n2. Observe HTTP 200.',
    });

    expect(repository.upsertReport({
      title: 'Incomplete working draft',
      status: 'draft',
      content: '# Notes',
      vulnerabilityIds: [vulnerability.id],
    }).status).toBe('draft');
    expect(() => repository.upsertReport({
      title: 'Missing linked title',
      status: 'final',
      content: '### Reproduction Steps\n\n1. Request /admin.\n\n### Observable Results\n\nHTTP 200.',
      vulnerabilityIds: [vulnerability.id],
    })).toThrow(/missing linked Vulnerability title/);
    expect(() => repository.upsertReport({
      title: 'Unnumbered final report',
      status: 'final',
      content: '## Authorization bypass\n\n### Reproduction Steps\n\nRequest /admin.\n\n### Observable Results\n\nHTTP 200.',
      vulnerabilityIds: [vulnerability.id],
    })).toThrow(/requires numbered steps/);
    expect(() => repository.upsertReport({
      title: 'Missing observable result',
      status: 'final',
      content: '## Authorization bypass\n\n### Reproduction Steps\n\n1. Request /admin.',
      vulnerabilityIds: [vulnerability.id],
    })).toThrow(/Observable Results/);

    expect(repository.upsertReport({
      title: 'Complete final report',
      status: 'final',
      content: '## Authorization bypass\n\n### 复现步骤\n\n1. 以普通用户请求 /admin。\n\n### 可观察结果\n\n返回 HTTP 200 和管理页面。',
      vulnerabilityIds: [vulnerability.id],
    })).toMatchObject({ status: 'final', vulnerabilityIds: [vulnerability.id] });
  });

  it('deletes managed records while retaining linked records and pruning references', () => {
    const target = repository.upsertTarget({
      id: 'host-delete', ip: '192.0.2.72', domains: [], status: 'scanned', tags: [], ports: [], services: [],
      vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    const evidence = repository.upsertEvidence({ assetId: target.id, title: 'Raw response', content: 'HTTP 200' });
    const finding = repository.upsertFinding({ title: 'Reusable lead', evidenceIds: [evidence.id] });
    const vulnerability = repository.upsertVulnerability({
      assetId: target.id,
      title: 'Validated weakness',
      description: '1. Send the request.\n2. Observe the protected response.',
      findingIds: [finding.id],
      evidenceIds: [evidence.id],
    });
    const report = repository.upsertReport({
      title: 'Linked report', content: '# Report', findingIds: [finding.id], vulnerabilityIds: [vulnerability.id],
    });

    expect(repository.deleteManagedRecord('finding', finding.id)).toBe(true);
    expect(repository.listFindings()).toEqual([]);
    expect(repository.listVulnerabilities()[0]).toMatchObject({ id: vulnerability.id, findingIds: [] });
    expect(repository.listReports()[0]).toMatchObject({ id: report.id, findingIds: [], vulnerabilityIds: [vulnerability.id] });
    expect(repository.listEvidence()).toHaveLength(1);

    expect(repository.deleteManagedRecord('vulnerability', vulnerability.id)).toBe(true);
    expect(repository.listVulnerabilities()).toEqual([]);
    expect(repository.listReports()[0]).toMatchObject({ id: report.id, vulnerabilityIds: [] });
    expect(repository.getTarget(target.id)?.vulnCount).toBe(0);
    expect(repository.listEvidence()).toHaveLength(1);

    expect(repository.deleteManagedRecord('evidence', evidence.id)).toBe(true);
    expect(repository.listEvidence()).toEqual([]);
    expect(repository.deleteManagedRecord('report', report.id)).toBe(true);
    expect(repository.listReports()).toEqual([]);
    expect(repository.deleteManagedRecord('report', report.id)).toBe(false);
  });

  it('rejects a missing Evidence link before creating the Finding', () => {
    const target = repository.upsertTarget({
      id: 'host-invalid-link', ip: '192.0.2.71', domains: [], status: 'scanned', tags: [], ports: [], services: [],
      vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    expect(() => repository.upsertFinding({
      assetId: target.id,
      title: 'Unsupported record',
      evidenceIds: ['evidence-missing'],
    })).toThrow('Evidence evidence-missing not found');
    expect(repository.listFindings()).toEqual([]);
  });
});
