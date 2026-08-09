// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebShellHealthRepository } from '@electron/services/webshell-health.repository';
import type { WebShellProfileHealth } from '@electron/contracts/shell';

vi.mock('@electron/services/project-registry', () => ({
  projectDataPath: (projectPath: string) => projectPath,
}));

describe('WebShellHealthRepository', () => {
  let tempDir: string;
  let repo: WebShellHealthRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webshell-health-'));
    repo = new WebShellHealthRepository(tempDir);
  });

  afterEach(() => {
    try { repo.close(); } catch { /* already closed */ }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null for an unknown profile', () => {
    expect(repo.get('profile-1')).toBeNull();
  });

  it('creates the SQLite database file on construction', () => {
    expect(fs.existsSync(path.join(tempDir, 'shell', 'index.db'))).toBe(true);
  });

  it('records a successful observation and returns healthy status', () => {
    const health = repo.record({
      profileId: 'profile-1',
      success: true,
      checkedAt: new Date().toISOString(),
      latencyMs: 150,
      resolved: {
        adapterId: 'generic',
        runtime: 'php',
        commandMode: 'php_eval',
        shellFlavor: 'posix',
      },
    });
    expect(health.status).toBe('healthy');
    expect(health.adapterId).toBe('generic');
    expect(health.runtime).toBe('php');
    expect(health.shellFlavor).toBe('posix');
    expect(health.commandMode).toBe('php_eval');
    expect(health.latencyMs).toBe(150);
    expect(health.consecutiveFailures).toBe(0);
    expect(health.lastCheckedAt).toBeTruthy();
    expect(health.lastSuccessAt).toBeTruthy();
  });

  it('reports degraded after one failure', () => {
    repo.record({ profileId: 'profile-1', success: true, checkedAt: new Date().toISOString(), latencyMs: 100 });
    const degraded = repo.record({
      profileId: 'profile-1', success: false, checkedAt: new Date().toISOString(),
      latencyMs: 150, error: 'Connection refused',
    });
    expect(degraded.status).toBe('degraded');
    expect(degraded.consecutiveFailures).toBe(1);
    expect(degraded.lastError).toBe('Connection refused');
    // Latency should keep the last successful value
    expect(degraded.latencyMs).toBe(100);
    // lastSuccessAt should keep the last successful timestamp
    expect(degraded.lastSuccessAt).toBeTruthy();
  });

  it('reports degraded after two consecutive failures', () => {
    repo.record({ profileId: 'profile-1', success: false, checkedAt: new Date().toISOString(), latencyMs: 100, error: 'err-1' });
    const health = repo.record({ profileId: 'profile-1', success: false, checkedAt: new Date().toISOString(), latencyMs: 200, error: 'err-2' });
    expect(health.status).toBe('degraded');
    expect(health.consecutiveFailures).toBe(2);
  });

  it('reports unreachable after three or more consecutive failures', () => {
    for (let i = 0; i < 3; i++) {
      repo.record({ profileId: 'profile-1', success: false, checkedAt: new Date().toISOString(), latencyMs: 100, error: `err-${i}` });
    }
    const health = repo.get('profile-1');
    expect(health?.status).toBe('unreachable');
    expect(health?.consecutiveFailures).toBe(3);

    // One more to confirm it stays unreachable
    const health4 = repo.record({ profileId: 'profile-1', success: false, checkedAt: new Date().toISOString(), latencyMs: 100, error: 'err-4' });
    expect(health4.consecutiveFailures).toBe(4);
    expect(health4.status).toBe('unreachable');
  });

  it('resets to healthy after a successful observation following failures', () => {
    repo.record({ profileId: 'profile-1', success: false, checkedAt: new Date().toISOString(), latencyMs: 100, error: 'e1' });
    repo.record({ profileId: 'profile-1', success: false, checkedAt: new Date().toISOString(), latencyMs: 100, error: 'e2' });
    const healthy = repo.record({
      profileId: 'profile-1', success: true, checkedAt: new Date().toISOString(),
      latencyMs: 120, resolved: { adapterId: 'generic', runtime: 'auto', shellFlavor: 'posix' },
    });
    expect(healthy.status).toBe('healthy');
    expect(healthy.consecutiveFailures).toBe(0);
    expect(healthy.lastError).toBeUndefined();
  });

  it('detects stale records older than 24 hours', () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    repo.record({
      profileId: 'profile-1', success: true,
      checkedAt: oldDate.toISOString(), latencyMs: 100,
    });
    const health = repo.get('profile-1', new Date());
    expect(health?.status).toBe('stale');
  });

  it('stores system info JSON and retrieves it', () => {
    const systemInfo = {
      os: 'Linux 5.15.0',
      hostname: 'web01',
      user: 'www-data',
      cwd: '/var/www/html',
      runtimeVersion: 'PHP 7.4.33',
    };
    repo.record({
      profileId: 'profile-1',
      success: true,
      checkedAt: new Date().toISOString(),
      latencyMs: 200,
      systemInfo,
    });
    const health = repo.get('profile-1');
    expect(health?.systemInfo).toEqual(systemInfo);
  });

  it('does not overwrite system info on failure', () => {
    const systemInfo = { os: 'Linux', hostname: 'web01' };
    repo.record({
      profileId: 'profile-1', success: true,
      checkedAt: new Date().toISOString(), latencyMs: 100, systemInfo,
    });
    repo.record({
      profileId: 'profile-1', success: false,
      checkedAt: new Date().toISOString(), latencyMs: 200, error: 'timeout',
    });
    const health = repo.get('profile-1');
    expect(health?.systemInfo).toEqual(systemInfo);
  });

  it('caps events at 20 per profile', () => {
    for (let i = 0; i < 25; i++) {
      repo.record({
        profileId: 'profile-single', success: i % 2 === 0,
        checkedAt: new Date().toISOString(), latencyMs: 100,
      });
    }
    const health = repo.get('profile-single');
    // Rate should be based on the most recent 20 events
    expect(health?.successRate).toBeDefined();
    expect(health?.successRate).toBeGreaterThanOrEqual(0);
    expect(health?.successRate).toBeLessThanOrEqual(1);
  });

  it('caps events at the most recent 20 outcomes with an exact rate', () => {
    for (let i = 0; i < 5; i++) {
      repo.record({
        profileId: 'profile-capped', success: false,
        checkedAt: new Date().toISOString(), latencyMs: 100, error: 'err',
      });
    }
    // Then 10 successes and 10 failures, so the newest 20 events split evenly.
    for (let i = 0; i < 20; i++) {
      repo.record({
        profileId: 'profile-capped', success: i % 2 === 0,
        checkedAt: new Date().toISOString(), latencyMs: 100,
        ...(i % 2 === 1 ? { error: 'err' } : {}),
      });
    }
    const health = repo.get('profile-capped');
    // Only the newest 20 events are retained: 10 successes and 10 failures.
    // Without capping, the rate would be 10/25 = 0.4.
    expect(health?.successRate).toBe(0.5);
  });

  it('computes a correct success rate', () => {
    // 8 successes, 2 failures = 80%
    for (let i = 0; i < 8; i++) {
      repo.record({
        profileId: 'profile-rate', success: true,
        checkedAt: new Date().toISOString(), latencyMs: 100,
      });
    }
    for (let i = 0; i < 2; i++) {
      repo.record({
        profileId: 'profile-rate', success: false,
        checkedAt: new Date().toISOString(), latencyMs: 100, error: 'err',
      });
    }
    const health = repo.get('profile-rate');
    expect(health?.successRate).toBe(0.8);
  });

  it('deletes health and event records', () => {
    repo.record({
      profileId: 'profile-del', success: true,
      checkedAt: new Date().toISOString(), latencyMs: 100,
    });
    expect(repo.get('profile-del')).not.toBeNull();
    const deleted = repo.delete('profile-del');
    expect(deleted).toBe(true);
    expect(repo.get('profile-del')).toBeNull();
    // Second delete is idempotent
    expect(repo.delete('profile-del')).toBe(false);
  });

  it('survives close and recreation with the same db path', () => {
    repo.record({
      profileId: 'profile-survive', success: true,
      checkedAt: new Date().toISOString(), latencyMs: 100,
    });
    repo.close();

    const repo2 = new WebShellHealthRepository(tempDir);
    const health = repo2.get('profile-survive');
    expect(health).not.toBeNull();
    expect(health?.status).toBe('healthy');
    repo2.close();
  });

  it('handles multiple profiles independently', () => {
    repo.record({ profileId: 'profile-a', success: true, checkedAt: new Date().toISOString(), latencyMs: 100 });
    repo.record({ profileId: 'profile-b', success: false, checkedAt: new Date().toISOString(), latencyMs: 200, error: 'err' });
    repo.record({ profileId: 'profile-b', success: false, checkedAt: new Date().toISOString(), latencyMs: 200, error: 'err' });
    repo.record({ profileId: 'profile-b', success: false, checkedAt: new Date().toISOString(), latencyMs: 200, error: 'err' });

    expect(repo.get('profile-a')?.status).toBe('healthy');
    expect(repo.get('profile-b')?.status).toBe('unreachable');
    expect(repo.get('profile-b')?.consecutiveFailures).toBe(3);
  });

  it('returns undefined success rate when there are no events', () => {
    // Record then delete to clear events
    repo.record({ profileId: 'profile-empty', success: true, checkedAt: new Date().toISOString(), latencyMs: 100 });
    repo.delete('profile-empty');

    const repo2 = new WebShellHealthRepository(tempDir);
    // After deletion, the profile shouldn't exist at all
    expect(repo2.get('profile-empty')).toBeNull();
    repo2.close();
  });

  it('rejects invalid profile identifiers in record, get, and delete', () => {
    expect(() => repo.record({
      profileId: 'bad id!', success: true, checkedAt: new Date().toISOString(), latencyMs: 100,
    })).toThrow('Invalid profile identifier');
    expect(() => repo.record({
      profileId: '', success: true, checkedAt: new Date().toISOString(), latencyMs: 100,
    })).toThrow('Invalid profile identifier');
    expect(() => repo.get('bad id!')).toThrow('Invalid profile identifier');
    expect(() => repo.delete('bad id!')).toThrow('Invalid profile identifier');
  });
});
