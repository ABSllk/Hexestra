// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAssetRecord } from '@electron/services/asset-record';
import { AssetGraphRepository } from '@electron/services/asset-graph.repository';

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
      id: expect.stringMatching(/^AST-host-/),
      ports: [expect.objectContaining({ port: 443, service: 'https', version: 'nginx' })],
      services: [expect.objectContaining({ name: 'https', product: 'nginx' })],
    });
    expect(repository.listAssets()).toEqual(expect.arrayContaining([expect.objectContaining({ id: domain.id })]));
    expect(repository.listRelations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: domain.id, target: target.id, type: 'resolves_to' }),
    ]));
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

  it('persists operational status independently from scope annotations', () => {
    const target = repository.upsertTarget({
      id: 'host-scope', ip: '198.51.100.10', domains: [], status: 'scanned', tags: [],
      ports: [], services: [], vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    const candidate = createAssetRecord('domain', 'outside.example.net');
    const asset = repository.upsertAsset({ ...candidate, status: 'scanned' });

    expect(target.status).toBe('scanned');
    expect(asset.status).toBe('scanned');
  });

  it('persists the Domain graph layout state', () => {
    const host = repository.upsertTarget({
      id: 'host-1', ip: '192.0.2.30', domains: [], status: 'untested', tags: [], ports: [], services: [],
      vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    repository.updateLayoutState({
      view: { x: 12, y: 8, scale: 1.4 },
      positions: { [host.id]: { x: 220, y: 90 } },
    });

    expect(repository.getLayoutState()).toMatchObject({
      perspective: 'domain',
      view: { x: 12, y: 8, scale: 1.4 }, positions: { [host.id]: { x: 220, y: 90 } },
    });
  });

  it('migrates v3 data through v5 with a backup, materialized Port and Service assets, and preserved records', () => {
    const migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-v3-migration-'));
    const legacy = new AssetGraphRepository(migrationDirectory);
    const host = legacy.upsertTarget({
      id: 'legacy-host', ip: '203.0.113.10', domains: ['legacy.example.com'], status: 'scanned', tags: ['legacy'],
      ports: [{ id: 'legacy:443/tcp', port: 443, protocol: 'tcp', state: 'open', service: 'https', version: 'nginx', firstSeen: now, lastSeen: now }],
      services: [{ port: 443, protocol: 'tcp', name: 'https', product: 'nginx' }],
      vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    const domain = legacy.upsertAsset(createAssetRecord('domain', 'legacy.example.com'));
    legacy.upsertRelation(domain.id, host.id, 'resolves_to', { tool: 'legacy' });
    const evidence = legacy.upsertEvidence({ assetId: host.id, title: 'Legacy evidence', tool: 'nmap', kind: 'scan', content: '443/tcp open' });
    const finding = legacy.upsertFinding({ assetId: host.id, title: 'Legacy finding', evidenceIds: [evidence.id] });
    const vulnerability = legacy.upsertVulnerability({ assetId: host.id, title: 'Legacy vulnerability', findingIds: [finding.id], evidenceIds: [evidence.id] });
    const report = legacy.upsertReport({ title: 'Legacy report', content: '# Legacy', findingIds: [finding.id], vulnerabilityIds: [vulnerability.id] });
    legacy.updateLayoutState({ perspective: 'domain', view: { x: 7, y: 9, scale: 1.3 }, positions: { [domain.id]: { x: 50, y: 60 } } });
    const databasePath = legacy.databasePath;
    legacy.close();

    const downgrade = new DatabaseSync(databasePath);
    const endpoint = downgrade.prepare('SELECT * FROM endpoints').get() as {
      port_asset_id: string; host_asset_id: string; port: number; protocol: string; state: string;
      service: string | null; version: string | null; product: string | null; extra: string | null;
      first_seen: string; last_seen: string;
    };
    downgrade.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE endpoints;
      CREATE TABLE endpoints (
        id TEXT PRIMARY KEY, host_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        port INTEGER NOT NULL, protocol TEXT NOT NULL, state TEXT NOT NULL, service TEXT,
        version TEXT, product TEXT, extra TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
        UNIQUE(host_asset_id, port, protocol)
      );
    `);
    downgrade.prepare(`INSERT INTO endpoints VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`legacy:${endpoint.port}/${endpoint.protocol}`, endpoint.host_asset_id, endpoint.port, endpoint.protocol, endpoint.state,
        endpoint.service, endpoint.version, endpoint.product, endpoint.extra, endpoint.first_seen, endpoint.last_seen);
    downgrade.exec(`
      DELETE FROM relations WHERE source_asset_id IN (SELECT id FROM assets WHERE type IN ('port','service'));
      DELETE FROM assets WHERE type IN ('port','service');
      PRAGMA user_version = 3;
    `);
    downgrade.close();

    const migrated = new AssetGraphRepository(migrationDirectory);
    try {
      expect(fs.existsSync(`${databasePath}.v3-backup`)).toBe(true);
      const versionProbe = new DatabaseSync(databasePath);
      const schemaVersion = (versionProbe.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      versionProbe.close();
      expect(schemaVersion).toBe(5);
      expect(migrated.getTarget(host.id)).toMatchObject({ id: host.id, ports: [expect.objectContaining({ port: 443, service: 'https' })] });
      expect(migrated.listAssets()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: domain.id, type: 'domain' }),
        expect.objectContaining({ type: 'port', properties: expect.objectContaining({ port: 443 }) }),
        expect.objectContaining({ type: 'service', properties: expect.objectContaining({ name: 'https' }) }),
      ]));
      expect(migrated.listEvidence().map((item) => item.id)).toContain(evidence.id);
      expect(migrated.listFindings().map((item) => item.id)).toContain(finding.id);
      expect(migrated.listVulnerabilities().map((item) => item.id)).toContain(vulnerability.id);
      expect(migrated.listReports().map((item) => item.id)).toContain(report.id);
      expect(migrated.getLayoutState('domain')).toMatchObject({ view: { x: 7, y: 9, scale: 1.3 }, positions: { [domain.id]: { x: 50, y: 60 } } });
    } finally {
      migrated.close();
      fs.rmSync(migrationDirectory, { recursive: true, force: true });
    }
  });

  it('upgrades a v4 database with multiple graph perspectives without rerunning the v4 migration', () => {
    const migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-v4-migration-'));
    const legacy = new AssetGraphRepository(migrationDirectory);
    const host = legacy.upsertTarget({
      id: 'legacy-v4-host', ip: '203.0.113.20', domains: [], status: 'scanned', tags: [],
      ports: [], services: [], vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    legacy.updateLayoutState({ perspective: 'domain', view: { x: 1, y: 2, scale: 1.1 } });
    legacy.updateLayoutState({ perspective: 'network', view: { x: 3, y: 4, scale: 1.2 } });
    legacy.updateLayoutState({ perspective: 'application', view: { x: 5, y: 6, scale: 1.3 } });
    const databasePath = legacy.databasePath;
    legacy.close();

    const downgrade = new DatabaseSync(databasePath);
    downgrade.exec('PRAGMA user_version = 4;');
    downgrade.close();

    const migrated = new AssetGraphRepository(migrationDirectory);
    try {
      const versionProbe = new DatabaseSync(databasePath);
      const schemaVersion = (versionProbe.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      versionProbe.close();
      expect(schemaVersion).toBe(5);
      expect(migrated.getTarget(host.id)?.status).toBe('scanned');
      expect(migrated.getLayoutState('domain').view).toEqual({ x: 1, y: 2, scale: 1.1 });
      expect(migrated.getLayoutState('network').view).toEqual({ x: 3, y: 4, scale: 1.2 });
      expect(migrated.getLayoutState('application').view).toEqual({ x: 5, y: 6, scale: 1.3 });
    } finally {
      migrated.close();
      fs.rmSync(migrationDirectory, { recursive: true, force: true });
    }
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
