// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  WebShellProfileOptions,
  WebShellResolvedRuntime,
} from '@electron/contracts/shell';
import { validateWebShellOptions } from '@electron/services/shell-contract';

const transportMocks = vi.hoisted(() => ({
  createWebShellProtocolNonce: vi.fn(() => 'c0ffee12'),
  executeWebShellCommand: vi.fn(),
  probeWebShell: vi.fn(),
}));

// probeWebShell and executeWebShellCommand perform real HTTP; keep the pure
// request-building helpers real so fixture bytes can be reconstructed exactly.
vi.mock('@electron/services/webshell.transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/services/webshell.transport')>();
  return { ...actual, ...transportMocks };
});

import { getWebShellAdapter, listWebShellAdapters } from '@electron/services/webshell-adapter';
import {
  buildRequest,
  buildWebShellCommand,
  buildWebShellPayload,
  encodeWebShellPayload,
  parseWebShellCommand,
} from '@electron/services/webshell.transport';

const genericBase: WebShellProfileOptions = {
  adapterId: 'generic',
  url: 'https://example.test/run?cmd={{command}}',
  method: 'GET',
  headers: [{ name: 'Cookie', value: 'sid=plain' }],
  bodyKind: 'none',
  commandMode: 'auto',
  responseExtract: 'body',
  responseEncoding: 'utf-8',
  allowInvalidTls: false,
};

const antswordOptions: WebShellProfileOptions = {
  adapterId: 'antsword.v2.php',
  url: 'https://example.test/ant.php',
  method: 'POST',
  headers: [],
  bodyKind: 'form',
  commandMode: 'php_eval',
  runtime: 'php',
  responseExtract: 'body',
  responseEncoding: 'utf-8',
  allowInvalidTls: false,
  antsword: { passwordParameter: 'pass', encoder: 'base64' },
};

const genericRuntime: WebShellResolvedRuntime = {
  adapterId: 'generic',
  runtime: 'auto',
  commandMode: 'os',
  shellFlavor: 'posix',
};

const antswordRuntime: WebShellResolvedRuntime = {
  adapterId: 'antsword.v2.php',
  runtime: 'php',
  protocolVersion: '2',
  commandMode: 'php_eval',
  shellFlavor: 'posix',
};

const FIXTURE_DIRECTORY = path.resolve('test/fixtures/webshell/antsword-v2-php');
const FIXTURE_NONCE = 'f15c4d4a';

describe('WebShell adapter registry', () => {
  it('returns the Generic adapter by default and for explicit generic id', () => {
    const generic = getWebShellAdapter(genericBase);
    expect(generic.id).toBe('generic');
    const explicit = getWebShellAdapter({ ...genericBase, adapterId: 'generic' });
    expect(explicit.id).toBe('generic');
  });

  it('returns the AntSword v2 PHP adapter when configured', () => {
    const adapter = getWebShellAdapter({
      ...genericBase,
      adapterId: 'antsword.v2.php',
      url: 'https://example.test/shell.php',
      method: 'POST',
      bodyKind: 'form',
      bodyTemplate: undefined,
      commandMode: 'php_eval',
      runtime: 'php',
      antsword: { passwordParameter: 'ant', encoder: 'raw' },
    });
    expect(adapter.id).toBe('antsword.v2.php');
  });

  it('throws for an unknown adapter id', () => {
    expect(() => getWebShellAdapter({ ...genericBase, adapterId: 'unknown' as never }))
      .toThrow('Unsupported WebShell adapter');
  });

  it('lists registered adapter identifiers in order', () => {
    expect(listWebShellAdapters()).toEqual(['generic', 'antsword.v2.php']);
  });

  it('reuses the same adapter instance for repeated lookups', () => {
    const a = getWebShellAdapter(genericBase);
    const b = getWebShellAdapter(genericBase);
    expect(a).toBe(b);
  });
});

describe('Generic WebShell adapter', () => {
  beforeEach(() => {
    transportMocks.probeWebShell.mockClear();
    transportMocks.executeWebShellCommand.mockClear();
    transportMocks.probeWebShell.mockResolvedValue({ flavor: 'posix', commandMode: 'os', cwd: '/' });
    transportMocks.executeWebShellCommand.mockResolvedValue({ output: 'ok', exitCode: 0, cwd: '/tmp' });
  });

  it('probes through the registry and projects the generic resolved runtime', async () => {
    const adapter = getWebShellAdapter(genericBase);
    const probe = await adapter.probe(genericBase, 'posix', 1_000);
    expect(probe).toMatchObject({ flavor: 'posix', commandMode: 'os', cwd: '/' });
    expect(probe.resolved).toEqual({
      adapterId: 'generic',
      runtime: 'auto',
      commandMode: 'os',
      shellFlavor: 'posix',
    });
    expect(transportMocks.probeWebShell).toHaveBeenCalledWith(genericBase, 'posix', 1_000, undefined);
  });

  it('executes with the resolved command mode and no outer encoder', async () => {
    const adapter = getWebShellAdapter(genericBase);
    const signal = new AbortController().signal;
    await expect(adapter.execute(genericBase, genericRuntime, 'id', '/', signal, 5_000))
      .resolves.toEqual({ output: 'ok', exitCode: 0, cwd: '/tmp' });
    expect(transportMocks.executeWebShellCommand).toHaveBeenCalledWith(
      genericBase, 'os', 'posix', 'id', '/', signal, 5_000,
    );
  });

  it('rejects execution until the command mode is resolved', () => {
    const adapter = getWebShellAdapter(genericBase);
    expect(() => adapter.execute(
      genericBase,
      { adapterId: 'generic', runtime: 'auto', shellFlavor: 'posix' },
      'echo test', '/tmp', new AbortController().signal, 30_000,
    )).toThrow('Generic WebShell command mode is unresolved');
  });

  it('collects system information with a merged info command and parses prefixed lines', async () => {
    transportMocks.executeWebShellCommand.mockResolvedValue({
      output: [
        'c0ffee12:3:0:Linux target 6.1.0 x86_64',
        'c0ffee12:3:1:target-1',
        'c0ffee12:3:2:root',
        'c0ffee12:3:3:/tmp',
        'c0ffee12:3:4:8.2.21',
        '',
      ].join('\n'),
      exitCode: 0,
      cwd: '/tmp',
    });
    const adapter = getWebShellAdapter(genericBase);
    const signal = new AbortController().signal;
    const info = await adapter.collectSystemInfo(genericBase, genericRuntime, '/tmp', signal, 5_000);
    expect(info).toEqual({
      os: 'Linux target 6.1.0 x86_64',
      hostname: 'target-1',
      user: 'root',
      cwd: '/tmp',
      runtimeVersion: '8.2.21',
    });
    const lastCall = transportMocks.executeWebShellCommand.mock.calls.at(-1);
    expect(lastCall).toEqual([
      genericBase,
      'os',
      'posix',
      expect.stringContaining('c0ffee12:3:0:'),
      '/tmp',
      signal,
      5_000,
    ]);
    const command = String(lastCall?.[3]);
    expect(command).toContain('uname -a');
    expect(command).toContain('"$(hostname)"');
  });

  it('returns an empty system info object when nothing parseable is echoed', async () => {
    transportMocks.executeWebShellCommand.mockResolvedValue({ output: 'hello', exitCode: 0, cwd: '/' });
    const adapter = getWebShellAdapter(genericBase);
    await expect(adapter.collectSystemInfo(genericBase, genericRuntime, '/', new AbortController().signal, 5_000))
      .resolves.toEqual({});
  });
});

describe('AntSword v2 PHP adapter', () => {
  beforeEach(() => {
    transportMocks.probeWebShell.mockClear();
    transportMocks.executeWebShellCommand.mockClear();
    transportMocks.probeWebShell.mockResolvedValue({ flavor: 'posix', commandMode: 'php_eval', cwd: '/' });
    transportMocks.executeWebShellCommand.mockResolvedValue({ output: 'ok', exitCode: 0, cwd: '/' });
  });

  it('validates AntSword settings through the normalization path', () => {
    const normalized = validateWebShellOptions(antswordOptions);
    expect(normalized.adapterId).toBe('antsword.v2.php');
    expect(normalized.runtime).toBe('php');
    expect(normalized.commandMode).toBe('php_eval');
    expect(normalized.antsword).toEqual({ passwordParameter: 'pass', encoder: 'base64' });
  });

  it('rejects AntSword without the password parameter', () => {
    expect(() => validateWebShellOptions({
      ...antswordOptions,
      antsword: { passwordParameter: '', encoder: 'raw' },
    })).toThrow('AntSword v2 PHP settings require a passwordParameter and encoder');
  });

  it('rejects AntSword with command placeholders in the URL or body', () => {
    expect(() => validateWebShellOptions({
      ...antswordOptions,
      url: 'https://example.test/shell.php?cmd={{command}}',
    })).toThrow('AntSword v2 adapter owns its password parameter');
  });

  it('rejects AntSword with a non-PHP runtime', () => {
    expect(() => validateWebShellOptions({
      ...antswordOptions,
      runtime: 'jsp',
    })).toThrow('AntSword v2 adapter currently supports the PHP runtime only');
  });

  it('materializes the profile into a POST form with the password parameter before probing', async () => {
    const adapter = getWebShellAdapter(antswordOptions);
    const probe = await adapter.probe(antswordOptions, 'posix', 1_000);
    expect(probe.resolved).toEqual({
      adapterId: 'antsword.v2.php',
      runtime: 'php',
      protocolVersion: '2',
      commandMode: 'php_eval',
      shellFlavor: 'posix',
    });
    const materialized = transportMocks.probeWebShell.mock.calls.at(-1)?.[0] as WebShellProfileOptions;
    expect(materialized).toMatchObject({
      url: antswordOptions.url,
      method: 'POST',
      bodyKind: 'form',
      bodyTemplate: 'pass={{command}}',
      commandMode: 'php_eval',
    });
    expect(transportMocks.probeWebShell.mock.calls.at(-1)?.[3]).toBe('php_eval');
    expect(transportMocks.probeWebShell.mock.calls.at(-1)?.[4]).toBe('base64');
  });

  it('forces the php_eval command mode and configured encoder when executing', async () => {
    const adapter = getWebShellAdapter(antswordOptions);
    const signal = new AbortController().signal;
    await expect(adapter.execute(antswordOptions, antswordRuntime, 'id', '/', signal, 5_000))
      .resolves.toEqual({ output: 'ok', exitCode: 0, cwd: '/' });
    const lastCall = transportMocks.executeWebShellCommand.mock.calls.at(-1);
    const materialized = lastCall?.[0] as WebShellProfileOptions;
    expect(materialized).toMatchObject({
      method: 'POST',
      bodyKind: 'form',
      bodyTemplate: 'pass={{command}}',
      commandMode: 'php_eval',
    });
    expect(lastCall).toEqual([
      materialized, 'php_eval', 'posix', 'id', '/', signal, 5_000, 'base64',
    ]);
  });

  it('collects system information through the materialized PHP eval request', async () => {
    transportMocks.executeWebShellCommand.mockResolvedValue({
      output: ['c0ffee12:3:0:Linux 5.15 x86_64', 'c0ffee12:3:4:8.2.21', ''].join('\n'),
      exitCode: 0,
      cwd: '/',
    });
    const adapter = getWebShellAdapter(antswordOptions);
    const signal = new AbortController().signal;
    await expect(adapter.collectSystemInfo(antswordOptions, antswordRuntime, '/', signal, 5_000))
      .resolves.toEqual({ os: 'Linux 5.15 x86_64', runtimeVersion: '8.2.21' });
    const lastCall = transportMocks.executeWebShellCommand.mock.calls.at(-1);
    expect(lastCall?.[0]).toMatchObject({
      method: 'POST',
      bodyKind: 'form',
      bodyTemplate: 'pass={{command}}',
      commandMode: 'php_eval',
    });
    expect(String(lastCall?.[3])).toContain('c0ffee12:3:0:');
    expect(lastCall?.[7]).toBe('base64');
  });

  it('throws from probe, execute, and collectSystemInfo when AntSword settings are missing', () => {
    const missing: WebShellProfileOptions = { ...antswordOptions, antsword: undefined };
    const adapter = getWebShellAdapter(missing);
    expect(adapter.probe(missing, 'posix', 1_000)).rejects.toThrow('AntSword v2 PHP settings are missing');
    expect(() => adapter.execute(
      missing, antswordRuntime, 'echo test', '/tmp', new AbortController().signal, 30_000,
    )).toThrow('AntSword v2 PHP settings are missing');
    expect(adapter.collectSystemInfo(missing, antswordRuntime, '/', new AbortController().signal, 5_000))
      .rejects.toThrow('AntSword v2 PHP settings are missing');
  });
});

describe('AntSword v2 PHP deterministic wire fixtures', () => {
  const materialized: WebShellProfileOptions = {
    ...genericBase,
    adapterId: 'antsword.v2.php',
    url: 'https://example.test/run',
    method: 'POST',
    headers: [],
    bodyKind: 'form',
    bodyTemplate: 'pass={{command}}',
    commandMode: 'php_eval',
  };
  const wrapper = buildWebShellCommand('posix', 'id', '/', FIXTURE_NONCE);
  const payload = buildWebShellPayload('php_eval', wrapper);

  for (const encoder of ['raw', 'base64', 'hex'] as const) {
    it(`matches the stored request bytes for encoder=${encoder}`, () => {
      const request = buildRequest(materialized, encodeWebShellPayload(payload, encoder));
      const fixture = fs.readFileSync(path.join(FIXTURE_DIRECTORY, `request-${encoder}.body`), 'utf8');
      expect(request.method).toBe('POST');
      expect(request.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(request.body).toBe(fixture);

      const separator = request.body!.indexOf('=');
      expect(request.body!.slice(0, separator)).toBe('pass');
      const value = decodeURIComponent(request.body!.slice(separator + 1));
      let decodedPayload: string;
      if (encoder === 'raw') {
        decodedPayload = value;
        expect(decodedPayload).toContain("$c=base64_decode('");
        expect(decodedPayload).toContain('passthru($c)');
        expect(decodedPayload).toContain("function_exists('system')");
        expect(decodedPayload).not.toContain(`${FIXTURE_NONCE}:0`);
      } else if (encoder === 'base64') {
        expect(value).toMatch(/^[A-Za-z0-9+/=]+$/);
        decodedPayload = Buffer.from(value, 'base64').toString('utf8');
        expect(decodedPayload).toBe(payload);
      } else {
        expect(value).toMatch(/^[0-9a-f]+$/);
        decodedPayload = Buffer.from(value, 'hex').toString('utf8');
        expect(decodedPayload).toBe(payload);
      }
      const inner = decodedPayload.match(/base64_decode\('([^']+)'\)/)?.[1];
      expect(inner).toBeTruthy();
      const wrapperBytes = Buffer.from(inner ?? '', 'base64').toString('utf8');
      expect(wrapperBytes).toBe(wrapper);
      expect(wrapperBytes).toContain(`${FIXTURE_NONCE}:0`);
      expect(wrapperBytes).toContain(`${FIXTURE_NONCE}:1`);
      expect(wrapperBytes).not.toMatch(/hexestra/i);
    });
  }

  it('parses the stored response bytes as positive completion proof', () => {
    const response = fs.readFileSync(path.join(FIXTURE_DIRECTORY, 'response.body'), 'utf8');
    expect(response).toContain(`${FIXTURE_NONCE}:0`);
    expect(response).toContain(`${FIXTURE_NONCE}:1:0:/`);
    expect(parseWebShellCommand(response, FIXTURE_NONCE)).toEqual({
      output: 'uid=0(root) gid=0(root)',
      exitCode: 0,
      cwd: '/',
    });
  });

  it('rejects a response that lacks the expected markers', () => {
    expect(() => parseWebShellCommand('plain text response', FIXTURE_NONCE))
      .toThrow('WebShell response did not contain the command marker');
  });
});

describe('Generic adapter validation', () => {
  it('validates a minimal Generic GET profile', () => {
    const normalized = validateWebShellOptions({
      adapterId: 'generic',
      url: 'https://example.test/shell?cmd={{command}}',
      method: 'GET',
      headers: [],
      bodyKind: 'none',
      responseExtract: 'body',
      responseEncoding: 'utf-8',
      allowInvalidTls: false,
      runtime: 'auto',
      commandMode: 'auto',
    });
    expect(normalized.adapterId).toBe('generic');
    expect(normalized.commandMode).toBe('auto');
    expect(normalized.bodyTemplate).toBeUndefined();
  });

  it('migrates profiles without adapterId to generic implicitly', () => {
    const normalized = validateWebShellOptions({
      url: 'https://example.test/shell?cmd={{command}}',
      method: 'GET',
      headers: [],
      bodyKind: 'none',
      responseExtract: 'body',
      responseEncoding: 'utf-8',
      allowInvalidTls: false,
    });
    expect(normalized.adapterId).toBe('generic');
  });
});
