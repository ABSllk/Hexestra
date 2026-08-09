import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import type {
  WebShellProfileHealth,
  WebShellResolvedRuntime,
  WebShellSystemInfo,
} from '../contracts/shell';
import { projectDataPath } from './project-registry';
import { assertShellId } from './shell-contract';

const STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
const MAX_EVENTS_PER_PROFILE = 20;

export interface WebShellHealthObservation {
  profileId: string;
  success: boolean;
  checkedAt: string;
  latencyMs: number;
  resolved?: WebShellResolvedRuntime;
  error?: string;
  systemInfo?: WebShellSystemInfo;
}

interface HealthRow {
  profile_id: string;
  adapter_id: string | null;
  runtime: string | null;
  shell_flavor: string | null;
  command_mode: string | null;
  last_checked_at: string;
  last_success_at: string | null;
  latency_ms: number | null;
  consecutive_failures: number;
  last_error: string | null;
  system_info_json: string | null;
}

export class WebShellHealthRepository {
  private readonly db: DatabaseSync;

  constructor(projectPath: string) {
    const directory = path.join(projectDataPath(projectPath), 'shell');
    fs.mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'index.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS webshell_profile_health (
        profile_id TEXT PRIMARY KEY,
        adapter_id TEXT,
        runtime TEXT,
        shell_flavor TEXT,
        command_mode TEXT,
        last_checked_at TEXT NOT NULL,
        last_success_at TEXT,
        latency_ms INTEGER,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        system_info_json TEXT
      );
      CREATE TABLE IF NOT EXISTS webshell_health_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL,
        success INTEGER NOT NULL,
        checked_at TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_webshell_health_events_profile
        ON webshell_health_events(profile_id, id DESC);
    `);
  }

  record(observation: WebShellHealthObservation) {
    assertShellId(observation.profileId, 'profile identifier');
    const current = this.db.prepare('SELECT * FROM webshell_profile_health WHERE profile_id = ?')
      .get(observation.profileId) as unknown as HealthRow | undefined;
    const resolved = observation.resolved;
    const failures = observation.success ? 0 : (current?.consecutive_failures ?? 0) + 1;
    const systemInfo = observation.systemInfo ?? parseSystemInfo(current?.system_info_json);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO webshell_profile_health (
          profile_id, adapter_id, runtime, shell_flavor, command_mode,
          last_checked_at, last_success_at, latency_ms, consecutive_failures,
          last_error, system_info_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          adapter_id=excluded.adapter_id,
          runtime=excluded.runtime,
          shell_flavor=excluded.shell_flavor,
          command_mode=excluded.command_mode,
          last_checked_at=excluded.last_checked_at,
          last_success_at=excluded.last_success_at,
          latency_ms=excluded.latency_ms,
          consecutive_failures=excluded.consecutive_failures,
          last_error=excluded.last_error,
          system_info_json=excluded.system_info_json
      `).run(
        observation.profileId,
        resolved?.adapterId ?? current?.adapter_id ?? null,
        resolved?.runtime ?? current?.runtime ?? null,
        resolved?.shellFlavor ?? current?.shell_flavor ?? null,
        resolved?.commandMode ?? current?.command_mode ?? null,
        observation.checkedAt,
        observation.success ? observation.checkedAt : current?.last_success_at ?? null,
        observation.success ? Math.max(0, Math.round(observation.latencyMs)) : current?.latency_ms ?? null,
        failures,
        observation.success ? null : observation.error?.slice(0, 2_000) ?? 'Unknown WebShell failure',
        systemInfo ? JSON.stringify(systemInfo) : null,
      );
      this.db.prepare(`
        INSERT INTO webshell_health_events (profile_id, success, checked_at, latency_ms, error)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        observation.profileId,
        observation.success ? 1 : 0,
        observation.checkedAt,
        Math.max(0, Math.round(observation.latencyMs)),
        observation.error?.slice(0, 2_000) ?? null,
      );
      this.db.prepare(`
        DELETE FROM webshell_health_events
        WHERE profile_id = ? AND id NOT IN (
          SELECT id FROM webshell_health_events WHERE profile_id = ? ORDER BY id DESC LIMIT ?
        )
      `).run(observation.profileId, observation.profileId, MAX_EVENTS_PER_PROFILE);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.get(observation.profileId)!;
  }

  get(profileId: string, now = new Date()): WebShellProfileHealth | null {
    assertShellId(profileId, 'profile identifier');
    const row = this.db.prepare('SELECT * FROM webshell_profile_health WHERE profile_id = ?')
      .get(profileId) as unknown as HealthRow | undefined;
    if (!row) return null;
    const counts = this.db.prepare(`
      SELECT COUNT(*) AS total, COALESCE(SUM(success), 0) AS successes
      FROM webshell_health_events WHERE profile_id = ?
    `).get(profileId) as unknown as { total: number; successes: number };
    const age = now.getTime() - new Date(row.last_checked_at).getTime();
    const status = age > STALE_AFTER_MS
      ? 'stale'
      : row.consecutive_failures >= 3 ? 'unreachable'
        : row.consecutive_failures > 0 ? 'degraded' : 'healthy';
    return {
      profileId,
      status,
      adapterId: isAdapterId(row.adapter_id) ? row.adapter_id : undefined,
      runtime: isRuntime(row.runtime) ? row.runtime : undefined,
      shellFlavor: isFlavor(row.shell_flavor) ? row.shell_flavor : undefined,
      commandMode: row.command_mode === 'os' || row.command_mode === 'php_eval' ? row.command_mode : undefined,
      lastCheckedAt: row.last_checked_at,
      lastSuccessAt: row.last_success_at ?? undefined,
      latencyMs: row.latency_ms ?? undefined,
      successRate: counts.total > 0 ? counts.successes / counts.total : undefined,
      consecutiveFailures: row.consecutive_failures,
      lastError: row.last_error ?? undefined,
      systemInfo: parseSystemInfo(row.system_info_json),
    };
  }

  delete(profileId: string) {
    assertShellId(profileId, 'profile identifier');
    this.db.prepare('DELETE FROM webshell_health_events WHERE profile_id = ?').run(profileId);
    return this.db.prepare('DELETE FROM webshell_profile_health WHERE profile_id = ?').run(profileId).changes > 0;
  }

  close() {
    this.db.close();
  }
}

function parseSystemInfo(value?: string | null): WebShellSystemInfo | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const item = parsed as Record<string, unknown>;
    return {
      os: typeof item.os === 'string' ? item.os : undefined,
      hostname: typeof item.hostname === 'string' ? item.hostname : undefined,
      user: typeof item.user === 'string' ? item.user : undefined,
      cwd: typeof item.cwd === 'string' ? item.cwd : undefined,
      runtimeVersion: typeof item.runtimeVersion === 'string' ? item.runtimeVersion : undefined,
    };
  } catch {
    return undefined;
  }
}

function isAdapterId(value: unknown): value is NonNullable<WebShellProfileHealth['adapterId']> {
  return value === 'generic' || value === 'antsword.v2.php';
}

function isRuntime(value: unknown): value is NonNullable<WebShellProfileHealth['runtime']> {
  return value === 'auto' || value === 'php' || value === 'jsp' || value === 'jspx' || value === 'aspx';
}

function isFlavor(value: unknown): value is NonNullable<WebShellProfileHealth['shellFlavor']> {
  return value === 'posix' || value === 'powershell' || value === 'cmd';
}
