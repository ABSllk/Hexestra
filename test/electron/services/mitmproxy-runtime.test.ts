import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundledMitmdumpPath,
  detectMitmproxyRuntime,
  inspectMitmdump,
  listMitmdumpCandidates,
  parseMitmdumpVersion,
  resolveMitmdumpPath,
} from '@electron/services/mitmproxy-runtime';

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

  it('prefers the packaged runtime before environment and PATH candidates', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-mitm-'));
    roots.push(root);
    const executable = path.join(root, 'mitmproxy', 'bin', 'mitmdump');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, 'fixture');

    expect(listMitmdumpCandidates({
      platform: 'linux',
      resourcesPath: root,
      environmentPath: '/custom/mitmdump',
      pathValue: '/usr/bin',
    }).slice(0, 3)).toEqual([
      { executablePath: executable, source: 'bundled' },
      { executablePath: '/custom/mitmdump', source: 'environment' },
      { executablePath: path.join('/usr/bin', 'mitmdump'), source: 'path' },
    ]);
    expect(resolveMitmdumpPath({
      platform: 'linux',
      resourcesPath: root,
      environmentPath: '/custom/mitmdump',
      pathValue: '',
    })).toBe(executable);
  });

  it('keeps the official macOS app bundle layout intact', () => {
    expect(bundledMitmdumpPath('/Applications/Hexestra.app/Contents/Resources', 'darwin')).toBe(
      path.join(
        '/Applications/Hexestra.app/Contents/Resources',
        'mitmproxy',
        'bin',
        'mitmproxy.app',
        'Contents',
        'MacOS',
        'mitmdump',
      ),
    );
  });

  it('keeps an explicit manual path ahead of the bundled runtime', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-mitm-'));
    roots.push(root);
    const manual = path.join(root, 'manual-mitmdump');
    const bundled = path.join(root, 'resources', 'mitmproxy', 'bin', 'mitmdump');
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(manual, 'fixture');
    fs.writeFileSync(bundled, 'fixture');
    expect(resolveMitmdumpPath({
      override: manual,
      platform: 'linux',
      resourcesPath: path.join(root, 'resources'),
      pathValue: '',
    })).toBe(manual);
  });

  it('does not silently fall back when an explicit path is invalid', async () => {
    const status = await detectMitmproxyRuntime({ override: path.join(os.tmpdir(), 'missing-mitmdump') });
    expect(status).toMatchObject({ status: 'missing', source: 'manual', executablePath: expect.stringContaining('missing-mitmdump') });
  });

  it('accepts any executable version that responds to version detection', async () => {
    const candidate = { executablePath: '/tmp/mitmdump', source: 'manual' as const };
    expect(await inspectMitmdump(candidate, async () => 'Mitmproxy: 12.2.3')).toMatchObject({ status: 'ready', version: '12.2.3' });
    expect(await inspectMitmdump(candidate, async () => 'Mitmproxy: 11.0.0')).toMatchObject({ status: 'ready', version: '11.0.0' });
    expect(await inspectMitmdump(candidate, async () => 'mitmdump development build')).toMatchObject({ status: 'ready', version: null });
    expect(parseMitmdumpVersion('mitmdump 12.2.3')).toBe('12.2.3');
  });
});
