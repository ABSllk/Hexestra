import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectMitmproxyRuntime,
  inspectMitmdump,
  listMitmdumpCandidates,
  MITMPROXY_VERSION,
  parseMitmdumpVersion,
  resolveMitmdumpPath,
} from './mitmproxy-runtime';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('mitmproxy runtime discovery', () => {
  it('uses platform-specific executable names and deterministic sources', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-mitm-'));
    roots.push(root);
    const executable = path.join(root, 'mitmdump');
    fs.writeFileSync(executable, 'fixture');
    expect(resolveMitmdumpPath({ override: executable, platform: 'linux', pathValue: '' })).toBe(executable);
    expect(listMitmdumpCandidates({ platform: 'darwin', pathValue: '/one:/two' }).slice(0, 2)).toEqual([
      { executablePath: path.join('/one', 'mitmdump'), source: 'path' },
      { executablePath: path.join('/two', 'mitmdump'), source: 'path' },
    ]);
    expect(listMitmdumpCandidates({ platform: 'win32', pathValue: 'C:\\one;C:\\two' }).slice(0, 2).every((item) => item.executablePath.endsWith('mitmdump.exe'))).toBe(true);
  });

  it('does not silently fall back when an explicit path is invalid', async () => {
    const status = await detectMitmproxyRuntime({ override: path.join(os.tmpdir(), 'missing-mitmdump') });
    expect(status).toMatchObject({ status: 'missing', source: 'manual', executablePath: expect.stringContaining('missing-mitmdump') });
  });

  it('reports exact version compatibility', async () => {
    const candidate = { executablePath: '/tmp/mitmdump', source: 'manual' as const };
    expect(await inspectMitmdump(candidate, async () => `Mitmproxy: ${MITMPROXY_VERSION}`)).toMatchObject({ status: 'ready', version: MITMPROXY_VERSION });
    expect(await inspectMitmdump(candidate, async () => 'Mitmproxy: 11.0.0')).toMatchObject({ status: 'incompatible', version: '11.0.0' });
    expect(parseMitmdumpVersion('mitmdump 12.2.3')).toBe('12.2.3');
  });
});
