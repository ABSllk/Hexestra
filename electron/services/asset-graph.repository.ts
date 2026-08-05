import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  normalizeOperationalAssetStatus,
  type AssetRecord,
} from './asset-record';
import type { ManagedRecordKind } from '../contracts/records';
import { projectDataPath } from './project-registry';

export const LOCAL_ASSET_ID = 'local-operator';
const SCHEMA_VERSION = 3;
const DOMAIN_LAYOUT_KEY = 'domain';

export type RelationType = 'belongs_to' | 'resolves_to' | 'connected_to' | 'attack_path';

export interface GraphRelation {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  label?: string;
  metadata?: Record<string, string>;
}

export interface GraphLayoutState {
  view: { x: number; y: number; scale: number };
  positions: Record<string, { x: number; y: number }>;
}

export type AssetChangeKind = 'asset_added' | 'endpoint_added' | 'endpoint_changed' | 'asset_updated';
export type FindingKind = 'observation' | 'lead' | 'hypothesis' | 'behavior' | 'access' | 'note';
export type FindingConfidence = 'low' | 'medium' | 'high';
export type FindingStatus = 'active' | 'used' | 'archived';
export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type VulnerabilityStatus = 'confirmed' | 'remediation' | 'resolved' | 'accepted';

export interface ScanRunRecord {
  id: string;
  tool: string;
  sourceAssetId?: string;
  startedAt: string;
  completedAt: string;
  changeCount: number;
}

export interface AssetChangeRecord {
  id: string;
  scanRunId: string;
  assetId?: string;
  kind: AssetChangeKind;
  field?: string;
  label: string;
  before?: string;
  after?: string;
  observedAt: string;
}

export interface FindingRecord {
  id: string;
  assetId?: string;
  title: string;
  kind: FindingKind;
  confidence: FindingConfidence;
  status: FindingStatus;
  description: string;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VulnerabilityRecord {
  id: string;
  assetId: string;
  title: string;
  severity: VulnerabilitySeverity;
  status: VulnerabilityStatus;
  description: string;
  impact: string;
  remediation: string;
  cve?: string;
  cwe?: string;
  cvss?: number;
  findingIds: string[];
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceRecord {
  id: string;
  assetId: string;
  sourceAssetId?: string;
  title: string;
  tool: string;
  kind: string;
  content: string;
  findingIds: string[];
  vulnerabilityIds: string[];
  observedAt: string;
  updatedAt: string;
}

export type ReportStatus = 'draft' | 'final';

export interface ReportRecord {
  id: string;
  title: string;
  status: ReportStatus;
  summary: string;
  content: string;
  findingIds: string[];
  vulnerabilityIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function validateFinalReportContent(
  status: ReportStatus,
  content: string,
  vulnerabilities: readonly Pick<VulnerabilityRecord, 'id' | 'title'>[],
) {
  if (status !== 'final' || vulnerabilities.length === 0) return;

  const normalizedContent = content.toLocaleLowerCase();
  const missingTitles = vulnerabilities
    .filter(({ title }) => !normalizedContent.includes(title.trim().toLocaleLowerCase()))
    .map(({ id, title }) => `${id} (${title})`);
  const reproductionSections = markdownSections(content, 'Reproduction Steps?|复现步骤');
  const numberedReproductionSections = reproductionSections.filter((section) => /(?:^|\n)\s*\d+[.)]\s+\S/m.test(section));
  const observableSections = markdownSections(content, 'Observable Results?|可观察结果');
  const errors: string[] = [];
  if (missingTitles.length) errors.push(`missing linked Vulnerability title(s): ${missingTitles.join(', ')}`);
  if (reproductionSections.length < vulnerabilities.length) {
    errors.push(`requires ${vulnerabilities.length} Reproduction Steps section(s), found ${reproductionSections.length}`);
  }
  if (numberedReproductionSections.length < vulnerabilities.length) {
    errors.push(`requires numbered steps in ${vulnerabilities.length} reproduction section(s), found ${numberedReproductionSections.length}`);
  }
  if (observableSections.length < vulnerabilities.length) {
    errors.push(`requires ${vulnerabilities.length} Observable Results section(s), found ${observableSections.length}`);
  }
  if (errors.length) throw new Error(`Final report is incomplete: ${errors.join('; ')}`);
}

function markdownSections(content: string, labelPattern: string) {
  const heading = new RegExp(
    `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?(?:${labelPattern})(?:\\*\\*)?\\s*:?\\s*(?=\\n|$)`,
    'gim',
  );
  const matches = [...content.matchAll(heading)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    return content.slice(start, end);
  });
}

export interface StoredTarget {
  id: string;
  ip: string;
  hostname?: string;
  domains: string[];
  os?: string;
  status: string;
  tags: string[];
  ports: Array<{
    id: string;
    port: number;
    protocol: string;
    state: string;
    service?: string;
    version?: string;
    firstSeen: string;
    lastSeen: string;
  }>;
  services: Array<{
    port: number;
    protocol: string;
    name: string;
    version?: string;
    product?: string;
    extra?: string;
  }>;
  vulnCount: number;
  aiSummary?: string;
  firstSeen: string;
  lastUpdated: string;
}

interface AssetRow {
  id: string;
  semantic_key: string;
  type: string;
  label: string;
  status: string;
  properties_json: string;
  tags_json: string;
  vuln_count: number;
  ai_summary: string | null;
  first_seen: string;
  last_updated: string;
}

interface EndpointRow {
  id: string;
  host_asset_id: string;
  port: number;
  protocol: string;
  state: string;
  service: string | null;
  version: string | null;
  product: string | null;
  extra: string | null;
  first_seen: string;
  last_seen: string;
}

interface RelationRow {
  id: string;
  source_asset_id: string;
  target_asset_id: string;
  type: RelationType;
  label: string | null;
  metadata_json: string;
  evidence_count: number;
  first_seen: string;
  last_seen: string;
}

export class AssetGraphRepository {
  readonly databasePath: string;
  private readonly db: DatabaseSync;

  constructor(sessionPath: string) {
    const statePath = projectDataPath(sessionPath);
    fs.mkdirSync(statePath, { recursive: true });
    this.databasePath = path.join(statePath, 'engagement.db');
    this.db = new DatabaseSync(this.databasePath);
    try {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
      const versionRow = this.db.prepare('PRAGMA user_version').get() as unknown as { user_version: number };
      if (![0, 1, 2, SCHEMA_VERSION].includes(versionRow.user_version)) {
        throw new Error(`Unsupported engagement database schema ${versionRow.user_version}; expected ${SCHEMA_VERSION}`);
      }
      if (versionRow.user_version === 1) this.replaceLegacyFindingSchema();
      this.createSchema();
      if (versionRow.user_version > 0 && versionRow.user_version < 3) {
        this.removeGeneratedRegistrationEvidence();
      }
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      this.ensureLocalAsset();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  private replaceLegacyFindingSchema() {
    this.db.exec(`
      BEGIN IMMEDIATE;
      DROP TABLE IF EXISTS finding_evidence;
      DROP TABLE IF EXISTS findings;
      UPDATE reports SET finding_ids_json = '[]';
      COMMIT;
    `);
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listTargets(): StoredTarget[] {
    const rows = this.db.prepare("SELECT * FROM assets WHERE type = 'host' ORDER BY last_updated DESC").all() as unknown as AssetRow[];
    const endpointStatement = this.db.prepare('SELECT * FROM endpoints WHERE host_asset_id = ? ORDER BY port, protocol');
    return rows.map((row) => this.targetFromRows(
      row,
      endpointStatement.all(row.id) as unknown as EndpointRow[],
    ));
  }

  getTarget(targetId: string): StoredTarget | null {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ? AND type = 'host'").get(targetId) as unknown as AssetRow | undefined;
    if (!row) return null;
    const endpoints = this.db.prepare('SELECT * FROM endpoints WHERE host_asset_id = ? ORDER BY port, protocol').all(row.id) as unknown as EndpointRow[];
    return this.targetFromRows(row, endpoints);
  }

  upsertTarget(candidate: StoredTarget): StoredTarget {
    const now = new Date().toISOString();
    const candidateStatus = normalizeOperationalAssetStatus(candidate.status);
    const existingRow = this.db.prepare("SELECT * FROM assets WHERE semantic_key = ? AND type = 'host'").get(`host:${candidate.ip}`) as unknown as AssetRow | undefined;
    const existing = existingRow ? this.getTarget(existingRow.id) : null;
    const merged: StoredTarget = existing ? {
      ...existing,
      hostname: candidate.hostname || existing.hostname,
      domains: unique([...existing.domains, ...(candidate.domains ?? [])]),
      os: candidate.os || existing.os,
      status: candidateStatus === 'untested' ? existing.status : candidateStatus,
      tags: unique([...existing.tags, ...(candidate.tags ?? [])]),
      ports: mergePorts(existing.ports, candidate.ports ?? [], now),
      services: mergeServices(existing.services, candidate.services ?? []),
      vulnCount: Math.max(existing.vulnCount, candidate.vulnCount ?? 0),
      aiSummary: candidate.aiSummary ?? existing.aiSummary,
      lastUpdated: now,
    } : {
      ...candidate,
      status: candidateStatus,
      domains: unique(candidate.domains ?? []),
      tags: unique(candidate.tags ?? []),
      ports: candidate.ports ?? [],
      services: candidate.services ?? [],
      firstSeen: candidate.firstSeen || now,
      lastUpdated: candidate.lastUpdated || now,
    };
    const id = existing?.id ?? candidate.id;
    const properties = {
      ip: merged.ip,
      ...(merged.hostname ? { hostname: merged.hostname } : {}),
      domains: merged.domains,
      ...(merged.os ? { os: merged.os } : {}),
    };
    this.writeAssetRow({
      id,
      semanticKey: `host:${merged.ip}`,
      type: 'host',
      label: merged.ip,
      status: merged.status,
      properties,
      tags: merged.tags,
      vulnCount: merged.vulnCount,
      aiSummary: merged.aiSummary,
      firstSeen: merged.firstSeen,
      lastUpdated: merged.lastUpdated,
    });
    for (const port of merged.ports) {
      const service = merged.services.find((item) => item.port === port.port && item.protocol === port.protocol);
      this.db.prepare(`
        INSERT INTO endpoints (
          id, host_asset_id, port, protocol, state, service, version, product, extra, first_seen, last_seen
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(host_asset_id, port, protocol) DO UPDATE SET
          state = excluded.state,
          service = COALESCE(excluded.service, endpoints.service),
          version = COALESCE(excluded.version, endpoints.version),
          product = COALESCE(excluded.product, endpoints.product),
          extra = COALESCE(excluded.extra, endpoints.extra),
          last_seen = excluded.last_seen
      `).run(
        `${id}:${port.port}/${port.protocol}`,
        id,
        port.port,
        port.protocol,
        port.state,
        port.service ?? service?.name ?? null,
        port.version ?? service?.version ?? null,
        service?.product ?? null,
        service?.extra ?? null,
        port.firstSeen || now,
        port.lastSeen || now,
      );
    }
    return this.getTarget(id)!;
  }

  updateTarget(targetId: string, changes: Partial<StoredTarget>): StoredTarget {
    const current = this.getTarget(targetId);
    if (!current) throw new Error(`Target ${targetId} not found`);
    return this.upsertTarget({ ...current, ...changes, id: current.id, ip: changes.ip ?? current.ip });
  }

  listAssets(): AssetRecord[] {
    const rows = this.db.prepare("SELECT * FROM assets WHERE type NOT IN ('local', 'host') ORDER BY last_updated DESC").all() as unknown as AssetRow[];
    return rows.map((row) => this.assetFromRow(row));
  }

  upsertAsset(candidate: AssetRecord): AssetRecord {
    const candidateStatus = normalizeOperationalAssetStatus(candidate.status);
    const existingRow = this.db.prepare('SELECT * FROM assets WHERE semantic_key = ?').get(candidate.key) as unknown as AssetRow | undefined;
    const existing = existingRow ? this.assetFromRow(existingRow) : null;
    const now = new Date().toISOString();
    const merged: AssetRecord = existing ? {
      ...existing,
      label: candidate.label || existing.label,
      status: candidateStatus === 'untested' ? existing.status : candidateStatus,
      properties: { ...existing.properties, ...candidate.properties },
      tags: unique([...existing.tags, ...candidate.tags]),
      vulnCount: Math.max(existing.vulnCount, candidate.vulnCount),
      aiSummary: candidate.aiSummary ?? existing.aiSummary,
      lastUpdated: now,
    } : { ...candidate, status: candidateStatus };
    this.writeAssetRow({
      id: existing?.id ?? merged.id,
      semanticKey: merged.key,
      type: merged.type,
      label: merged.label,
      status: merged.status,
      properties: merged.properties,
      tags: merged.tags,
      vulnCount: merged.vulnCount,
      aiSummary: merged.aiSummary,
      firstSeen: merged.firstSeen,
      lastUpdated: merged.lastUpdated,
    });
    return this.assetFromRow(this.db.prepare('SELECT * FROM assets WHERE semantic_key = ?').get(merged.key) as unknown as AssetRow);
  }

  updateAsset(assetId: string, changes: Partial<AssetRecord>): AssetRecord {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ? AND type NOT IN ('local', 'host')").get(assetId) as unknown as AssetRow | undefined;
    if (!row) throw new Error(`Asset ${assetId} not found`);
    const current = this.assetFromRow(row);
    return this.upsertAsset({
      ...current,
      ...changes,
      id: current.id,
      key: current.key,
      type: current.type,
      lastUpdated: new Date().toISOString(),
    });
  }

  hasAsset(assetId: string) {
    return Boolean(this.db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId));
  }

  listRelations(): GraphRelation[] {
    const rows = this.db.prepare('SELECT * FROM relations ORDER BY first_seen, id').all() as unknown as RelationRow[];
    return rows.map((row) => ({
      id: row.id,
      source: row.source_asset_id,
      target: row.target_asset_id,
      type: row.type,
      label: row.label ?? undefined,
      metadata: {
        ...parseObject(row.metadata_json),
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        evidenceCount: String(row.evidence_count),
      },
    }));
  }

  upsertRelation(
    sourceId: string | undefined,
    targetId: string,
    type: RelationType,
    metadata: Record<string, string> = {},
  ): { edge: GraphRelation | null; created: boolean } {
    const source = sourceId && this.hasAsset(sourceId) ? sourceId : LOCAL_ASSET_ID;
    if (!this.hasAsset(targetId) || source === targetId) return { edge: null, created: false };
    const id = `edge:${source}:${type}:${targetId}`;
    const existing = this.db.prepare('SELECT id FROM relations WHERE id = ?').get(id);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO relations (
        id, source_asset_id, target_asset_id, type, label, metadata_json, evidence_count, first_seen, last_seen
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(source_asset_id, target_asset_id, type) DO UPDATE SET
        label = COALESCE(excluded.label, relations.label),
        metadata_json = excluded.metadata_json,
        evidence_count = relations.evidence_count + 1,
        last_seen = excluded.last_seen
    `).run(id, source, targetId, type, metadata.label ?? null, JSON.stringify(metadata), now, now);
    const edge = this.listRelations().find((candidate) => candidate.id === id) ?? null;
    return { edge, created: !existing };
  }

  listEvidence(): EvidenceRecord[] {
    const rows = this.db.prepare('SELECT * FROM evidence ORDER BY updated_at DESC, observed_at DESC').all() as unknown as EvidenceRow[];
    const findingLinks = this.db.prepare('SELECT finding_id FROM finding_evidence WHERE evidence_id = ? ORDER BY finding_id');
    const vulnerabilityLinks = this.db.prepare('SELECT vulnerability_id FROM vulnerability_evidence WHERE evidence_id = ? ORDER BY vulnerability_id');
    return rows.map((row) => evidenceFromRow(
      row,
      (findingLinks.all(row.id) as unknown as Array<{ finding_id: string }>).map((link) => link.finding_id),
      (vulnerabilityLinks.all(row.id) as unknown as Array<{ vulnerability_id: string }>).map((link) => link.vulnerability_id),
    ));
  }

  upsertEvidence(input: Partial<EvidenceRecord> & Pick<EvidenceRecord, 'assetId' | 'title' | 'content'>): EvidenceRecord {
    if (!this.hasAsset(input.assetId)) throw new Error(`Asset ${input.assetId} not found`);
    if (input.sourceAssetId && !this.hasAsset(input.sourceAssetId)) {
      throw new Error(`Source asset ${input.sourceAssetId} not found`);
    }
    const id = input.id ?? `evidence-${crypto.randomUUID()}`;
    const existing = this.db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as unknown as EvidenceRow | undefined;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO evidence (
        id, asset_id, source_asset_id, title, tool, kind, detail, observed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        asset_id=excluded.asset_id, source_asset_id=excluded.source_asset_id,
        title=excluded.title, tool=excluded.tool, kind=excluded.kind,
        detail=excluded.detail, updated_at=excluded.updated_at
    `).run(
      id,
      input.assetId,
      input.sourceAssetId ?? existing?.source_asset_id ?? LOCAL_ASSET_ID,
      input.title.trim().slice(0, 300),
      (input.tool ?? existing?.tool ?? 'manual').trim().slice(0, 100),
      (input.kind ?? existing?.kind ?? 'note').trim().slice(0, 100),
      input.content.slice(0, 500_000),
      existing?.observed_at ?? input.observedAt ?? now,
      now,
    );
    return this.listEvidence().find((record) => record.id === id)!;
  }

  recordScanRun(tool: string, sourceId?: string) {
    const id = `scan-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const source = sourceId && this.hasAsset(sourceId) ? sourceId : LOCAL_ASSET_ID;
    this.db.prepare(`
      INSERT INTO scan_runs (id, tool, source_asset_id, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, tool.slice(0, 100), source, now, now);
    return id;
  }

  listScanRuns(limit = 100): ScanRunRecord[] {
    const rows = this.db.prepare(`
      SELECT s.*, COUNT(c.id) AS change_count
      FROM scan_runs s
      LEFT JOIN asset_changes c ON c.scan_run_id = s.id
      GROUP BY s.id
      ORDER BY s.completed_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(limit, 500))) as unknown as Array<{
      id: string; tool: string; source_asset_id: string | null; started_at: string; completed_at: string; change_count: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      tool: row.tool,
      sourceAssetId: row.source_asset_id ?? undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      changeCount: Number(row.change_count),
    }));
  }

  recordAssetChange(scanRunId: string, change: Omit<AssetChangeRecord, 'id' | 'scanRunId' | 'observedAt'>) {
    const id = `change-${crypto.randomUUID()}`;
    const observedAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO asset_changes (id, scan_run_id, asset_id, kind, field, label, before_value, after_value, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, scanRunId, change.assetId ?? null, change.kind, change.field ?? null,
      change.label.slice(0, 500), change.before ?? null, change.after ?? null, observedAt,
    );
    return { id, scanRunId, observedAt, ...change };
  }

  listAssetChanges(limit = 200): AssetChangeRecord[] {
    const rows = this.db.prepare(`SELECT * FROM asset_changes ORDER BY observed_at DESC LIMIT ?`)
      .all(Math.max(1, Math.min(limit, 1_000))) as unknown as Array<{
        id: string; scan_run_id: string; asset_id: string | null; kind: AssetChangeKind;
        field: string | null; label: string; before_value: string | null; after_value: string | null; observed_at: string;
      }>;
    return rows.map((row) => ({
      id: row.id,
      scanRunId: row.scan_run_id,
      assetId: row.asset_id ?? undefined,
      kind: row.kind,
      field: row.field ?? undefined,
      label: row.label,
      before: row.before_value ?? undefined,
      after: row.after_value ?? undefined,
      observedAt: row.observed_at,
    }));
  }

  listFindings(): FindingRecord[] {
    const rows = this.db.prepare('SELECT * FROM findings ORDER BY updated_at DESC').all() as unknown as FindingRow[];
    const links = this.db.prepare('SELECT evidence_id FROM finding_evidence WHERE finding_id = ? ORDER BY evidence_id');
    return rows.map((row) => findingFromRow(
      row,
      (links.all(row.id) as unknown as Array<{ evidence_id: string }>).map((link) => link.evidence_id),
    ));
  }

  upsertFinding(input: Partial<FindingRecord> & Pick<FindingRecord, 'title'>): FindingRecord {
    const id = input.id ?? `finding-${crypto.randomUUID()}`;
    const existing = this.db.prepare('SELECT * FROM findings WHERE id = ?').get(id) as unknown as FindingRow | undefined;
    const assetId = Object.prototype.hasOwnProperty.call(input, 'assetId')
      ? input.assetId || null
      : existing?.asset_id ?? null;
    if (assetId && !this.hasAsset(assetId)) throw new Error(`Asset ${assetId} not found`);
    const evidenceIds = input.evidenceIds ? unique(input.evidenceIds) : null;
    for (const evidenceId of evidenceIds ?? []) {
      if (!this.db.prepare('SELECT id FROM evidence WHERE id = ?').get(evidenceId)) {
        throw new Error(`Evidence ${evidenceId} not found`);
      }
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO findings (
        id, asset_id, title, kind, confidence, status, description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        asset_id=excluded.asset_id, title=excluded.title, kind=excluded.kind,
        confidence=excluded.confidence, status=excluded.status,
        description=excluded.description, updated_at=excluded.updated_at
    `).run(
      id,
      assetId,
      input.title.trim().slice(0, 300),
      input.kind ?? existing?.kind ?? 'observation',
      input.confidence ?? existing?.confidence ?? 'medium',
      input.status ?? existing?.status ?? 'active',
      input.description ?? existing?.description ?? '',
      existing?.created_at ?? now,
      now,
    );
    if (evidenceIds) {
      this.db.prepare('DELETE FROM finding_evidence WHERE finding_id = ?').run(id);
      const link = this.db.prepare('INSERT INTO finding_evidence (finding_id, evidence_id) VALUES (?, ?)');
      for (const evidenceId of evidenceIds) link.run(id, evidenceId);
    }
    return this.listFindings().find((record) => record.id === id)!;
  }

  listVulnerabilities(): VulnerabilityRecord[] {
    const rows = this.db.prepare('SELECT * FROM vulnerabilities ORDER BY updated_at DESC').all() as unknown as VulnerabilityRow[];
    const findingLinks = this.db.prepare('SELECT finding_id FROM vulnerability_findings WHERE vulnerability_id = ? ORDER BY finding_id');
    const evidenceLinks = this.db.prepare('SELECT evidence_id FROM vulnerability_evidence WHERE vulnerability_id = ? ORDER BY evidence_id');
    return rows.map((row) => vulnerabilityFromRow(
      row,
      (findingLinks.all(row.id) as unknown as Array<{ finding_id: string }>).map((link) => link.finding_id),
      (evidenceLinks.all(row.id) as unknown as Array<{ evidence_id: string }>).map((link) => link.evidence_id),
    ));
  }

  upsertVulnerability(
    input: Partial<VulnerabilityRecord> & Pick<VulnerabilityRecord, 'assetId' | 'title'>,
  ): VulnerabilityRecord {
    if (!this.hasAsset(input.assetId)) throw new Error(`Asset ${input.assetId} not found`);
    const id = input.id ?? `vulnerability-${crypto.randomUUID()}`;
    const existing = this.db.prepare('SELECT * FROM vulnerabilities WHERE id = ?').get(id) as unknown as VulnerabilityRow | undefined;
    const findingIds = input.findingIds ? unique(input.findingIds) : null;
    const evidenceIds = input.evidenceIds ? unique(input.evidenceIds) : null;
    for (const findingId of findingIds ?? []) {
      if (!this.db.prepare('SELECT id FROM findings WHERE id = ?').get(findingId)) {
        throw new Error(`Finding ${findingId} not found`);
      }
    }
    for (const evidenceId of evidenceIds ?? []) {
      if (!this.db.prepare('SELECT id FROM evidence WHERE id = ?').get(evidenceId)) {
        throw new Error(`Evidence ${evidenceId} not found`);
      }
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO vulnerabilities (
        id, asset_id, title, severity, status, description, impact, remediation,
        cve, cwe, cvss, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        asset_id=excluded.asset_id, title=excluded.title, severity=excluded.severity,
        status=excluded.status, description=excluded.description, impact=excluded.impact,
        remediation=excluded.remediation, cve=excluded.cve, cwe=excluded.cwe,
        cvss=excluded.cvss, updated_at=excluded.updated_at
    `).run(
      id,
      input.assetId,
      input.title.trim().slice(0, 300),
      input.severity ?? existing?.severity ?? 'medium',
      input.status ?? existing?.status ?? 'confirmed',
      input.description ?? existing?.description ?? '',
      input.impact ?? existing?.impact ?? '',
      input.remediation ?? existing?.remediation ?? '',
      input.cve ?? existing?.cve ?? null,
      input.cwe ?? existing?.cwe ?? null,
      input.cvss ?? existing?.cvss ?? null,
      existing?.created_at ?? now,
      now,
    );
    if (findingIds) replaceLinks(this.db, 'vulnerability_findings', 'vulnerability_id', 'finding_id', id, findingIds);
    if (evidenceIds) replaceLinks(this.db, 'vulnerability_evidence', 'vulnerability_id', 'evidence_id', id, evidenceIds);
    this.refreshAssetVulnerabilityCount(input.assetId);
    if (existing && existing.asset_id !== input.assetId) this.refreshAssetVulnerabilityCount(existing.asset_id);
    return this.listVulnerabilities().find((record) => record.id === id)!;
  }

  listReports(): ReportRecord[] {
    const rows = this.db.prepare('SELECT * FROM reports ORDER BY updated_at DESC').all() as unknown as ReportRow[];
    return rows.map(reportFromRow);
  }

  upsertReport(input: Partial<ReportRecord> & Pick<ReportRecord, 'title' | 'content'>): ReportRecord {
    const id = input.id ?? `report-${crypto.randomUUID()}`;
    const existing = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as unknown as ReportRow | undefined;
    const findingIds = input.findingIds ?? (existing ? parseStrings(existing.finding_ids_json) : []);
    const vulnerabilityIds = input.vulnerabilityIds ?? (existing ? parseStrings(existing.vulnerability_ids_json) : []);
    for (const findingId of unique(findingIds)) {
      if (!this.db.prepare('SELECT id FROM findings WHERE id = ?').get(findingId)) {
        throw new Error(`Finding ${findingId} not found`);
      }
    }
    for (const vulnerabilityId of unique(vulnerabilityIds)) {
      if (!this.db.prepare('SELECT id FROM vulnerabilities WHERE id = ?').get(vulnerabilityId)) {
        throw new Error(`Vulnerability ${vulnerabilityId} not found`);
      }
    }
    const status = input.status ?? existing?.status ?? 'draft';
    const linkedVulnerabilities = this.listVulnerabilities()
      .filter((vulnerability) => unique(vulnerabilityIds).includes(vulnerability.id));
    validateFinalReportContent(status, input.content, linkedVulnerabilities);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO reports (
        id, title, status, summary, content, finding_ids_json, vulnerability_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, status=excluded.status, summary=excluded.summary,
        content=excluded.content, finding_ids_json=excluded.finding_ids_json,
        vulnerability_ids_json=excluded.vulnerability_ids_json,
        updated_at=excluded.updated_at
    `).run(
      id,
      input.title.trim().slice(0, 300),
      status,
      (input.summary ?? existing?.summary ?? '').slice(0, 10_000),
      input.content.slice(0, 500_000),
      JSON.stringify(unique(findingIds)),
      JSON.stringify(unique(vulnerabilityIds)),
      existing?.created_at ?? now,
      now,
    );
    return this.listReports().find((record) => record.id === id)!;
  }

  getManagedRecord(kind: ManagedRecordKind, id: string): FindingRecord | VulnerabilityRecord | EvidenceRecord | ReportRecord | null {
    if (kind === 'finding') return this.listFindings().find((record) => record.id === id) ?? null;
    if (kind === 'vulnerability') return this.listVulnerabilities().find((record) => record.id === id) ?? null;
    if (kind === 'evidence') return this.listEvidence().find((record) => record.id === id) ?? null;
    return this.listReports().find((record) => record.id === id) ?? null;
  }

  deleteManagedRecord(kind: ManagedRecordKind, id: string): boolean {
    return this.transaction(() => {
      if (kind === 'finding') {
        const result = this.db.prepare('DELETE FROM findings WHERE id = ?').run(id);
        if (result.changes === 0) return false;
        this.pruneReportReference('finding', id);
        return true;
      }
      if (kind === 'vulnerability') {
        const row = this.db.prepare('SELECT asset_id FROM vulnerabilities WHERE id = ?').get(id) as unknown as { asset_id: string } | undefined;
        if (!row) return false;
        this.db.prepare('DELETE FROM vulnerabilities WHERE id = ?').run(id);
        this.pruneReportReference('vulnerability', id);
        this.refreshAssetVulnerabilityCount(row.asset_id);
        return true;
      }
      const table = kind === 'evidence' ? 'evidence' : 'reports';
      return this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;
    });
  }

  getLayoutState(): GraphLayoutState {
    const view = this.db.prepare('SELECT x, y, scale FROM graph_views WHERE perspective = ?').get(DOMAIN_LAYOUT_KEY) as unknown as { x: number; y: number; scale: number } | undefined;
    const rows = this.db.prepare('SELECT asset_id, x, y FROM graph_positions WHERE perspective = ?').all(DOMAIN_LAYOUT_KEY) as unknown as Array<{ asset_id: string; x: number; y: number }>;
    return {
      view: view ?? { x: 0, y: 0, scale: 1 },
      positions: Object.fromEntries(rows.map((row) => [row.asset_id, { x: row.x, y: row.y }])),
    };
  }

  updateLayoutState(state: Partial<GraphLayoutState>) {
    const now = new Date().toISOString();
    if (state.view) {
      this.db.prepare(`
        INSERT INTO graph_views (perspective, x, y, scale, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(perspective) DO UPDATE SET x=excluded.x, y=excluded.y, scale=excluded.scale, updated_at=excluded.updated_at
      `).run(DOMAIN_LAYOUT_KEY, state.view.x, state.view.y, state.view.scale, now);
    }
    if (state.positions) {
      this.db.prepare('DELETE FROM graph_positions WHERE perspective = ?').run(DOMAIN_LAYOUT_KEY);
      const statement = this.db.prepare(`
        INSERT INTO graph_positions (perspective, asset_id, x, y, updated_at) VALUES (?, ?, ?, ?, ?)
      `);
      for (const [assetId, point] of Object.entries(state.positions)) {
        if (this.hasAsset(assetId)) statement.run(DOMAIN_LAYOUT_KEY, assetId, point.x, point.y, now);
      }
    }
    return this.getLayoutState();
  }

  private createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        semantic_key TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK(type IN ('local','host','domain','webapp','api','service','identity','subnet')),
        label TEXT NOT NULL,
        status TEXT NOT NULL,
        properties_json TEXT NOT NULL DEFAULT '{}',
        tags_json TEXT NOT NULL DEFAULT '[]',
        vuln_count INTEGER NOT NULL DEFAULT 0,
        ai_summary TEXT,
        first_seen TEXT NOT NULL,
        last_updated TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS endpoints (
        id TEXT PRIMARY KEY,
        host_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        port INTEGER NOT NULL,
        protocol TEXT NOT NULL,
        state TEXT NOT NULL,
        service TEXT,
        version TEXT,
        product TEXT,
        extra TEXT,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        UNIQUE(host_asset_id, port, protocol)
      );
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        source_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        target_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('belongs_to','resolves_to','connected_to','attack_path')),
        label TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        evidence_count INTEGER NOT NULL DEFAULT 1,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        UNIQUE(source_asset_id, target_asset_id, type),
        CHECK(source_asset_id <> target_asset_id)
      );
      CREATE TABLE IF NOT EXISTS scan_runs (
        id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        source_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        source_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        title TEXT NOT NULL DEFAULT '',
        tool TEXT NOT NULL,
        kind TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        observed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS asset_changes (
        id TEXT PRIMARY KEY,
        scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
        asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK(kind IN ('asset_added','endpoint_added','endpoint_changed','asset_updated')),
        field TEXT,
        label TEXT NOT NULL,
        before_value TEXT,
        after_value TEXT,
        observed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('observation','lead','hypothesis','behavior','access','note')),
        confidence TEXT NOT NULL CHECK(confidence IN ('low','medium','high')),
        status TEXT NOT NULL CHECK(status IN ('active','used','archived')),
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS finding_evidence (
        finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
        evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
        PRIMARY KEY(finding_id, evidence_id)
      );
      CREATE TABLE IF NOT EXISTS vulnerabilities (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('critical','high','medium','low','info')),
        status TEXT NOT NULL CHECK(status IN ('confirmed','remediation','resolved','accepted')),
        description TEXT NOT NULL DEFAULT '',
        impact TEXT NOT NULL DEFAULT '',
        remediation TEXT NOT NULL DEFAULT '',
        cve TEXT,
        cwe TEXT,
        cvss REAL CHECK(cvss IS NULL OR (cvss >= 0 AND cvss <= 10)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vulnerability_findings (
        vulnerability_id TEXT NOT NULL REFERENCES vulnerabilities(id) ON DELETE CASCADE,
        finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
        PRIMARY KEY(vulnerability_id, finding_id)
      );
      CREATE TABLE IF NOT EXISTS vulnerability_evidence (
        vulnerability_id TEXT NOT NULL REFERENCES vulnerabilities(id) ON DELETE CASCADE,
        evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
        PRIMARY KEY(vulnerability_id, evidence_id)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft','final')),
        summary TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        finding_ids_json TEXT NOT NULL DEFAULT '[]',
        vulnerability_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_positions (
        perspective TEXT NOT NULL CHECK(perspective = 'domain'),
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        x REAL NOT NULL,
        y REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(perspective, asset_id)
      );
      CREATE TABLE IF NOT EXISTS graph_views (
        perspective TEXT PRIMARY KEY CHECK(perspective = 'domain'),
        x REAL NOT NULL,
        y REAL NOT NULL,
        scale REAL NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
      CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_asset_id);
      CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_asset_id);
      CREATE INDEX IF NOT EXISTS idx_asset_changes_scan ON asset_changes(scan_run_id);
      CREATE INDEX IF NOT EXISTS idx_findings_asset ON findings(asset_id);
      CREATE INDEX IF NOT EXISTS idx_vulnerabilities_asset ON vulnerabilities(asset_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_asset ON evidence(asset_id);
      CREATE INDEX IF NOT EXISTS idx_finding_evidence_evidence ON finding_evidence(evidence_id);
    `);
    this.ensureColumn('evidence', 'title', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('evidence', 'updated_at', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('reports', 'vulnerability_ids_json', "TEXT NOT NULL DEFAULT '[]'");
    this.db.prepare("UPDATE evidence SET title = tool || ': ' || kind WHERE title = ''").run();
    this.db.prepare("UPDATE evidence SET updated_at = observed_at WHERE updated_at = ''").run();
  }

  private pruneReportReference(kind: 'finding' | 'vulnerability', id: string) {
    const rows = this.db.prepare('SELECT id, finding_ids_json, vulnerability_ids_json FROM reports').all() as unknown as Array<{
      id: string;
      finding_ids_json: string;
      vulnerability_ids_json: string;
    }>;
    const column = kind === 'finding' ? 'finding_ids_json' : 'vulnerability_ids_json';
    const now = new Date().toISOString();
    for (const row of rows) {
      const current = parseStrings(row[column]);
      const next = current.filter((candidate) => candidate !== id);
      if (next.length !== current.length) {
        this.db.prepare(`UPDATE reports SET ${column} = ?, updated_at = ? WHERE id = ?`)
          .run(JSON.stringify(next), now, row.id);
      }
    }
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
    if (!columns.some((candidate) => candidate.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private removeGeneratedRegistrationEvidence() {
    this.db.prepare(`
      DELETE FROM evidence
      WHERE source_asset_id IS NOT NULL
        AND kind IN ('host', 'domain', 'webapp')
        AND title = tool || ': ' || kind
    `).run();
  }

  private ensureLocalAsset() {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO assets (
        id, semantic_key, type, label, status, properties_json, tags_json, vuln_count, first_seen, last_updated
      ) VALUES (?, ?, 'local', 'THIS DEVICE', 'scanned', '{}', '[]', 0, ?, ?)
    `).run(LOCAL_ASSET_ID, 'local:this-device', now, now);
  }

  private writeAssetRow(value: {
    id: string;
    semanticKey: string;
    type: string;
    label: string;
    status: string;
    properties: Record<string, unknown>;
    tags: string[];
    vulnCount: number;
    aiSummary?: string;
    firstSeen: string;
    lastUpdated: string;
  }) {
    this.db.prepare(`
      INSERT INTO assets (
        id, semantic_key, type, label, status, properties_json, tags_json, vuln_count, ai_summary, first_seen, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        semantic_key=excluded.semantic_key,
        label=excluded.label,
        status=excluded.status,
        properties_json=excluded.properties_json,
        tags_json=excluded.tags_json,
        vuln_count=excluded.vuln_count,
        ai_summary=excluded.ai_summary,
        last_updated=excluded.last_updated
    `).run(
      value.id,
      value.semanticKey,
      value.type,
      value.label,
      normalizeOperationalAssetStatus(value.status),
      JSON.stringify(value.properties),
      JSON.stringify(value.tags),
      value.vulnCount,
      value.aiSummary ?? null,
      value.firstSeen,
      value.lastUpdated,
    );
  }

  private assetFromRow(row: AssetRow): AssetRecord {
    return {
      id: row.id,
      key: row.semantic_key,
      type: row.type as AssetRecord['type'],
      label: row.label,
      status: normalizeOperationalAssetStatus(row.status),
      properties: parseProperties(row.properties_json),
      tags: parseStrings(row.tags_json),
      vulnCount: row.vuln_count,
      aiSummary: row.ai_summary ?? undefined,
      firstSeen: row.first_seen,
      lastUpdated: row.last_updated,
    };
  }

  private targetFromRows(row: AssetRow, endpoints: EndpointRow[]): StoredTarget {
    const properties = parseObject(row.properties_json);
    return {
      id: row.id,
      ip: typeof properties.ip === 'string' ? properties.ip : row.label,
      hostname: typeof properties.hostname === 'string' ? properties.hostname : undefined,
      domains: Array.isArray(properties.domains) ? properties.domains.filter((item): item is string => typeof item === 'string') : [],
      os: typeof properties.os === 'string' ? properties.os : undefined,
      status: normalizeOperationalAssetStatus(row.status),
      tags: parseStrings(row.tags_json),
      ports: endpoints.map((endpoint) => ({
        id: endpoint.id,
        port: endpoint.port,
        protocol: endpoint.protocol,
        state: endpoint.state,
        service: endpoint.service ?? undefined,
        version: endpoint.version ?? undefined,
        firstSeen: endpoint.first_seen,
        lastSeen: endpoint.last_seen,
      })),
      services: endpoints.filter((endpoint) => endpoint.service).map((endpoint) => ({
        port: endpoint.port,
        protocol: endpoint.protocol,
        name: endpoint.service!,
        version: endpoint.version ?? undefined,
        product: endpoint.product ?? undefined,
        extra: endpoint.extra ?? undefined,
      })),
      vulnCount: row.vuln_count,
      aiSummary: row.ai_summary ?? undefined,
      firstSeen: row.first_seen,
      lastUpdated: row.last_updated,
    };
  }

  private refreshAssetVulnerabilityCount(assetId: string) {
    this.db.prepare(`
      UPDATE assets SET vuln_count = (
        SELECT COUNT(*) FROM vulnerabilities
        WHERE asset_id = ? AND status <> 'resolved'
      ), last_updated = ? WHERE id = ?
    `).run(assetId, new Date().toISOString(), assetId);
  }
}

interface FindingRow {
  id: string;
  asset_id: string | null;
  title: string;
  kind: FindingKind;
  confidence: FindingConfidence;
  status: FindingStatus;
  description: string;
  created_at: string;
  updated_at: string;
}

interface VulnerabilityRow {
  id: string;
  asset_id: string;
  title: string;
  severity: VulnerabilitySeverity;
  status: VulnerabilityStatus;
  description: string;
  impact: string;
  remediation: string;
  cve: string | null;
  cwe: string | null;
  cvss: number | null;
  created_at: string;
  updated_at: string;
}

interface EvidenceRow {
  id: string;
  asset_id: string;
  source_asset_id: string | null;
  title: string;
  tool: string;
  kind: string;
  detail: string;
  observed_at: string;
  updated_at: string;
}

interface ReportRow {
  id: string;
  title: string;
  status: ReportStatus;
  summary: string;
  content: string;
  finding_ids_json: string;
  vulnerability_ids_json: string;
  created_at: string;
  updated_at: string;
}

function findingFromRow(row: FindingRow, evidenceIds: string[]): FindingRecord {
  return {
    id: row.id,
    assetId: row.asset_id ?? undefined,
    title: row.title,
    kind: row.kind,
    confidence: row.confidence,
    status: row.status,
    description: row.description,
    evidenceIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function vulnerabilityFromRow(
  row: VulnerabilityRow,
  findingIds: string[],
  evidenceIds: string[],
): VulnerabilityRecord {
  return {
    id: row.id,
    assetId: row.asset_id,
    title: row.title,
    severity: row.severity,
    status: row.status,
    description: row.description,
    impact: row.impact,
    remediation: row.remediation,
    cve: row.cve ?? undefined,
    cwe: row.cwe ?? undefined,
    cvss: row.cvss ?? undefined,
    findingIds,
    evidenceIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function evidenceFromRow(row: EvidenceRow, findingIds: string[], vulnerabilityIds: string[]): EvidenceRecord {
  return {
    id: row.id,
    assetId: row.asset_id,
    sourceAssetId: row.source_asset_id ?? undefined,
    title: row.title,
    tool: row.tool,
    kind: row.kind,
    content: row.detail,
    findingIds,
    vulnerabilityIds,
    observedAt: row.observed_at,
    updatedAt: row.updated_at,
  };
}

function reportFromRow(row: ReportRow): ReportRecord {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    summary: row.summary,
    content: row.content,
    findingIds: parseStrings(row.finding_ids_json),
    vulnerabilityIds: parseStrings(row.vulnerability_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseProperties(value: string): AssetRecord['properties'] {
  return parseObject(value) as AssetRecord['properties'];
}

function parseStrings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function replaceLinks(
  db: DatabaseSync,
  table: 'vulnerability_findings' | 'vulnerability_evidence',
  ownerColumn: 'vulnerability_id',
  targetColumn: 'finding_id' | 'evidence_id',
  ownerId: string,
  targetIds: string[],
) {
  db.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).run(ownerId);
  const statement = db.prepare(`INSERT INTO ${table} (${ownerColumn}, ${targetColumn}) VALUES (?, ?)`);
  for (const targetId of targetIds) statement.run(ownerId, targetId);
}

function mergePorts(existing: StoredTarget['ports'], incoming: StoredTarget['ports'], now: string) {
  const merged = new Map(existing.map((port) => [`${port.port}/${port.protocol}`, port]));
  for (const port of incoming) {
    const key = `${port.port}/${port.protocol}`;
    const current = merged.get(key);
    merged.set(key, current ? { ...current, ...port, firstSeen: current.firstSeen, lastSeen: now } : port);
  }
  return [...merged.values()];
}

function mergeServices(existing: StoredTarget['services'], incoming: StoredTarget['services']) {
  const merged = new Map(existing.map((service) => [`${service.port}/${service.protocol}`, service]));
  for (const service of incoming) {
    const key = `${service.port}/${service.protocol}`;
    merged.set(key, { ...merged.get(key), ...service });
  }
  return [...merged.values()];
}
