import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROXY_PROFILE } from '@electron/contracts/traffic';
import { buildMitmdumpArgs, parseMitmdumpVersion, resolveMitmdumpPath } from '@electron/services/traffic-sidecar';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('traffic sidecar resolver', () => {
  it('parses an available mitmproxy version without enforcing a specific release', () => {
    expect(parseMitmdumpVersion('Mitmproxy: 12.2.3 binary')).toBe('12.2.3');
    expect(parseMitmdumpVersion('Mitmproxy: 11.0.0 binary')).toBe('11.0.0');
    expect(parseMitmdumpVersion('unexpected')).toBeNull();
  });

  it('prefers an explicit executable and otherwise fails closed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-sidecar-'));
    roots.push(root);
    const executable = path.join(root, 'mitmdump.exe');
    fs.writeFileSync(executable, 'fixture');
    expect(resolveMitmdumpPath({ override: executable, resourcesPath: root, cwd: root, pathValue: '' })).toBe(executable);
    expect(resolveMitmdumpPath({ override: path.join(root, 'missing.exe'), resourcesPath: root, cwd: root, pathValue: '' })).toBeNull();
  });

  it('keeps Burp mirroring out of the live mitmproxy route', () => {
    const common = {
      proxyPort: 61000, controlPort: 61001, caDirectory: 'C:\\ca', token: 'token',
      projectId: 'project-1', addonPath: 'C:\\addon.py',
    };
    const mirror = buildMitmdumpArgs({
      ...common,
      profile: { ...DEFAULT_PROXY_PROFILE, enabled: true, burp: { ...DEFAULT_PROXY_PROFILE.burp, enabled: true, bridgeToken: 'x'.repeat(32) } },
    });
    expect(mirror).not.toContain('--mode');
    expect(mirror).toContain('hexestra_burp_enabled=false');

    const trustedTarget = buildMitmdumpArgs({
      ...common,
      trustedServerCaPath: 'C:\\fixture-ca.pem',
      profile: DEFAULT_PROXY_PROFILE,
    });
    expect(trustedTarget).toContain('ssl_verify_upstream_trusted_ca=C:\\fixture-ca.pem');
  });
});
