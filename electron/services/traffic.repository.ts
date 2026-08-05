import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import type {
  TrafficFlow,
  TrafficListQuery,
  TrafficListResult,
  TrafficSummary,
} from '../contracts/traffic';
import { assertTrafficId } from './traffic-contract';
import { projectDataPath } from './project-registry';

const MAX_LIST_LIMIT = 200;

export class TrafficRepository {
  private readonly root: string;
  private readonly flowRoot: string;
  private readonly databasePath: string;
  private readonly db: DatabaseSync;

  constructor(projectPath: string) {
    this.root = path.join(projectDataPath(projectPath), 'traffic');
    this.flowRoot = path.join(this.root, 'flows');
    this.databasePath = path.join(this.root, 'index.db');
    fs.mkdirSync(this.flowRoot, { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS traffic_index (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        scope_state TEXT NOT NULL,
        source TEXT NOT NULL,
        parent_flow_id TEXT,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        host TEXT NOT NULL,
        status_code INTEGER,
        content_type TEXT,
        request_bytes INTEGER NOT NULL,
        response_bytes INTEGER,
        started_at TEXT NOT NULL,
        duration_ms INTEGER,
        burp_routed INTEGER NOT NULL,
        error TEXT,
        file_path TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_traffic_started ON traffic_index(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_traffic_state ON traffic_index(state);
      CREATE INDEX IF NOT EXISTS idx_traffic_scope ON traffic_index(scope_state);
      CREATE INDEX IF NOT EXISTS idx_traffic_host ON traffic_index(host);
    `);
    this.ensureColumn('burp_mode', 'TEXT');
    this.ensureColumn('burp_mirror_state', 'TEXT');
    this.ensureColumn('burp_mirror_error', 'TEXT');
    this.rebuildMissingIndex();
  }

  upsert(flow: TrafficFlow) {
    assertTrafficId(flow.id);
    const relativePath = this.relativeFlowPath(flow);
    const absolutePath = path.join(this.root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeJsonAtomic(absolutePath, flow);
    this.upsertIndex(flow, relativePath);
    return flow;
  }

  read(id: string): TrafficFlow | null {
    assertTrafficId(id);
    const row = this.db.prepare('SELECT file_path FROM traffic_index WHERE id = ?').get(id) as { file_path: string } | undefined;
    if (!row) return null;
    const filePath = this.resolveIndexedPath(row.file_path);
    if (!fs.existsSync(filePath)) {
      this.db.prepare('DELETE FROM traffic_index WHERE id = ?').run(id);
      return null;
    }
    return parseFlow(fs.readFileSync(filePath, 'utf8'), id);
  }

  delete(id: string) {
    assertTrafficId(id);
    const row = this.db.prepare('SELECT file_path FROM traffic_index WHERE id = ?').get(id) as { file_path: string } | undefined;
    if (!row) return false;
    const filePath = this.resolveIndexedPath(row.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const result = this.db.prepare('DELETE FROM traffic_index WHERE id = ?').run(id);
    return result.changes > 0;
  }

  list(query: TrafficListQuery = {}): TrafficListResult {
    const offset = normalizeInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = normalizeInteger(query.limit, 50, 1, MAX_LIST_LIMIT);
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    const requestedStates = query.states?.filter((state, index, values) => values.indexOf(state) === index).slice(0, 7);
    if (requestedStates?.length) {
      clauses.push(`state IN (${requestedStates.map(() => '?').join(', ')})`);
      values.push(...requestedStates);
    } else if (query.state) {
      clauses.push('state = ?');
      values.push(query.state);
    }
    if (query.scopeState) {
      clauses.push('scope_state = ?');
      values.push(query.scopeState);
    }
    if (query.source) {
      clauses.push('source = ?');
      values.push(query.source);
    }
    if (query.host?.trim()) {
      clauses.push('host = ?');
      values.push(query.host.trim().slice(0, 500));
    }
    if (query.method?.trim()) {
      clauses.push('method = ?');
      values.push(query.method.trim().slice(0, 32));
    }
    if (query.parentFlowId?.trim()) {
      clauses.push('parent_flow_id = ?');
      values.push(query.parentFlowId.trim().slice(0, 200));
    }
    if (query.query?.trim()) {
      clauses.push('(url LIKE ? ESCAPE \'\\\' OR method LIKE ? ESCAPE \'\\\' OR host LIKE ? ESCAPE \'\\\')');
      const like = `%${escapeLike(query.query.trim().slice(0, 500))}%`;
      values.push(like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const count = this.db.prepare(`SELECT COUNT(*) AS count FROM traffic_index ${where}`).get(...values) as { count: number };
    const rows = this.db.prepare(`
      SELECT id, revision, state, scope_state, source, parent_flow_id, method, url, host,
             status_code, content_type, request_bytes, response_bytes, started_at,
             duration_ms, burp_routed, burp_mode, burp_mirror_state,
             burp_mirror_error, error
      FROM traffic_index ${where}
      ORDER BY started_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as unknown as TrafficIndexRow[];
    return { items: rows.map(summaryFromRow), total: count.count, offset, limit };
  }

  close() {
    this.db.close();
  }

  rebuild() {
    this.db.exec('DELETE FROM traffic_index');
    this.rebuildMissingIndex();
  }

  private relativeFlowPath(flow: TrafficFlow) {
    const day = /^\d{4}-\d{2}-\d{2}/.exec(flow.timing.startedAt)?.[0] ?? 'unknown-date';
    return path.join('flows', day, `${flow.id}.json`);
  }

  private resolveIndexedPath(relativePath: string) {
    const resolved = path.resolve(this.root, relativePath);
    const boundary = `${path.resolve(this.root)}${path.sep}`;
    if (!resolved.startsWith(boundary)) throw new Error('Traffic index escaped the project directory');
    return resolved;
  }

  private rebuildMissingIndex() {
    if (!fs.existsSync(this.flowRoot)) return;
    for (const filePath of walkJsonFiles(this.flowRoot)) {
      try {
        const flow = parseFlow(fs.readFileSync(filePath, 'utf8'));
        const existing = this.db.prepare('SELECT revision FROM traffic_index WHERE id = ?').get(flow.id) as { revision: number } | undefined;
        if (!existing || existing.revision !== flow.revision) {
          this.upsertIndex(flow, path.relative(this.root, filePath));
        }
      } catch {
        // A malformed operator-edited file is ignored without hiding valid flows.
      }
    }
  }

  private upsertIndex(flow: TrafficFlow, relativePath: string) {
    const summary = summarizeTrafficFlow(flow);
    this.db.prepare(`
      INSERT INTO traffic_index (
        id, project_id, revision, state, scope_state, source, parent_flow_id,
        method, url, host, status_code, content_type, request_bytes,
        response_bytes, started_at, duration_ms, burp_routed, burp_mode,
        burp_mirror_state, burp_mirror_error, error, file_path, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        revision = excluded.revision, state = excluded.state,
        scope_state = excluded.scope_state, source = excluded.source,
        parent_flow_id = excluded.parent_flow_id, method = excluded.method,
        url = excluded.url, host = excluded.host, status_code = excluded.status_code,
        content_type = excluded.content_type, request_bytes = excluded.request_bytes,
        response_bytes = excluded.response_bytes, started_at = excluded.started_at,
        duration_ms = excluded.duration_ms, burp_routed = excluded.burp_routed,
        burp_mode = excluded.burp_mode,
        burp_mirror_state = excluded.burp_mirror_state,
        burp_mirror_error = excluded.burp_mirror_error,
        error = excluded.error, file_path = excluded.file_path,
        updated_at = excluded.updated_at
    `).run(
      flow.id, flow.projectId, flow.revision, flow.state, flow.scopeState, flow.source,
      flow.parentFlowId ?? null, summary.method, summary.url, summary.host,
      summary.statusCode ?? null, summary.contentType ?? null, summary.requestBytes,
      summary.responseBytes ?? null, summary.startedAt, summary.durationMs ?? null,
      summary.burpRouted ? 1 : 0, summary.burpMode ?? null,
      summary.burpMirrorState ?? null, summary.burpMirrorError ?? null,
      summary.error ?? null, relativePath,
      new Date().toISOString(),
    );
  }

  private ensureColumn(name: string, declaration: string) {
    const columns = this.db.prepare('PRAGMA table_info(traffic_index)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) {
      this.db.exec(`ALTER TABLE traffic_index ADD COLUMN ${name} ${declaration}`);
    }
  }
}

export function summarizeTrafficFlow(flow: TrafficFlow): TrafficSummary {
  let host = '';
  try {
    host = new URL(flow.request.url).host;
  } catch {
    host = '<invalid>';
  }
  const contentType = flow.response?.headers.find((header) => header.name.toLowerCase() === 'content-type')?.value;
  return {
    id: flow.id,
    revision: flow.revision,
    state: flow.state,
    scopeState: flow.scopeState,
    source: flow.source,
    parentFlowId: flow.parentFlowId,
    method: flow.request.method,
    url: flow.request.url,
    host,
    statusCode: flow.response?.statusCode,
    contentType,
    requestBytes: flow.request.body.byteLength,
    responseBytes: flow.response?.body.byteLength,
    startedAt: flow.timing.startedAt,
    durationMs: flow.timing.durationMs,
    burpRouted: flow.route.burpRouted,
    burpMode: flow.route.burpMode,
    burpMirrorState: flow.route.burpMirrorState,
    burpMirrorError: flow.route.burpMirrorError,
    error: flow.error,
  };
}

interface TrafficIndexRow {
  id: string;
  revision: number;
  state: TrafficSummary['state'];
  scope_state: TrafficSummary['scopeState'];
  source: TrafficSummary['source'];
  parent_flow_id: string | null;
  method: string;
  url: string;
  host: string;
  status_code: number | null;
  content_type: string | null;
  request_bytes: number;
  response_bytes: number | null;
  started_at: string;
  duration_ms: number | null;
  burp_routed: number;
  burp_mode: TrafficSummary['burpMode'] | null;
  burp_mirror_state: TrafficSummary['burpMirrorState'] | null;
  burp_mirror_error: string | null;
  error: string | null;
}

function summaryFromRow(row: TrafficIndexRow): TrafficSummary {
  return {
    id: row.id,
    revision: row.revision,
    state: row.state,
    scopeState: row.scope_state,
    source: row.source,
    parentFlowId: row.parent_flow_id ?? undefined,
    method: row.method,
    url: row.url,
    host: row.host,
    statusCode: row.status_code ?? undefined,
    contentType: row.content_type ?? undefined,
    requestBytes: row.request_bytes,
    responseBytes: row.response_bytes ?? undefined,
    startedAt: row.started_at,
    durationMs: row.duration_ms ?? undefined,
    burpRouted: row.burp_routed === 1,
    burpMode: row.burp_mode ?? undefined,
    burpMirrorState: row.burp_mirror_state ?? undefined,
    burpMirrorError: row.burp_mirror_error ?? undefined,
    error: row.error ?? undefined,
  };
}

function parseFlow(source: string, expectedId?: string): TrafficFlow {
  const value = JSON.parse(source) as TrafficFlow;
  assertTrafficId(value?.id);
  if (expectedId && value.id !== expectedId) throw new Error('Traffic file identity mismatch');
  if (!value.request || typeof value.request.url !== 'string' || typeof value.revision !== 'number') {
    throw new Error('Invalid traffic flow file');
  }
  return value;
}

function writeJsonAtomic(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function* walkJsonFiles(directory: string): Generator<string> {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walkJsonFiles(child);
    else if (entry.isFile() && entry.name.endsWith('.json')) yield child;
  }
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
