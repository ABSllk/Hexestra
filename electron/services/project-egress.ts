import net from 'net';
import type { Duplex } from 'stream';

export type ProjectEgressRoute =
  | { mode: 'direct'; projectId: string; revision: number }
  | { mode: 'blocked'; projectId: string; revision: number; error: string | null }
  | { mode: 'proxy'; projectId: string; revision: number; mixedPort: number };

const routes = new Map<string, ProjectEgressRoute>();
const listeners = new Set<(route: ProjectEgressRoute) => void>();

export function publishProjectEgressRoute(route: ProjectEgressRoute) {
  const current = routes.get(route.projectId);
  if (current && current.revision > route.revision) return;
  routes.set(route.projectId, route);
  for (const listener of listeners) listener(route);
}

export function getProjectEgressRoute(projectId: string): ProjectEgressRoute {
  return routes.get(projectId) ?? { mode: 'direct', projectId, revision: 0 };
}

export function onProjectEgressRoute(listener: (route: ProjectEgressRoute) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function projectProxyEnvironment(projectId: string, source: NodeJS.ProcessEnv) {
  const route = getProjectEgressRoute(projectId);
  if (route.mode === 'direct') return { ...source };
  const port = route.mode === 'proxy' ? route.mixedPort : 9;
  const httpProxy = `http://127.0.0.1:${port}`;
  const socksProxy = `socks5h://127.0.0.1:${port}`;
  const noProxy = mergeNoProxy(source.NO_PROXY ?? source.no_proxy);
  const wslenv = mergeWslenv(source.WSLENV);
  return {
    ...source,
    HTTP_PROXY: httpProxy,
    HTTPS_PROXY: httpProxy,
    ALL_PROXY: socksProxy,
    NO_PROXY: noProxy,
    http_proxy: httpProxy,
    https_proxy: httpProxy,
    all_proxy: socksProxy,
    no_proxy: noProxy,
    WSLENV: wslenv,
  };
}

export async function openProjectConnectTunnel(
  projectId: string,
  host: string,
  port: number,
  timeoutMs = 10_000,
): Promise<Duplex | undefined> {
  const route = getProjectEgressRoute(projectId);
  if (route.mode === 'direct') return undefined;
  if (route.mode === 'blocked') throw new Error(route.error || 'Project proxy is blocked');
  return openHttpConnectTunnel(route.mixedPort, host, port, timeoutMs);
}

export function openHttpConnectTunnel(proxyPort: number, host: string, port: number, timeoutMs = 10_000): Promise<Duplex> {
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65_535) throw new Error('Invalid proxy port');
  if (!host || /[\r\n\0]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid CONNECT target');
  }
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: proxyPort });
    const timer = setTimeout(() => fail(new Error('Proxy CONNECT timed out')), timeoutMs);
    let response = Buffer.alloc(0);
    const fail = (error: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    socket.once('error', fail);
    socket.once('connect', () => {
      socket.write(`CONNECT ${formatAuthority(host, port)} HTTP/1.1\r\nHost: ${formatAuthority(host, port)}\r\nProxy-Connection: keep-alive\r\n\r\n`);
    });
    const onData = (chunk: Buffer) => {
      response = Buffer.concat([response, chunk]);
      if (response.length > 32_768) return fail(new Error('Proxy CONNECT response is too large'));
      const end = response.indexOf('\r\n\r\n');
      if (end < 0) return;
      socket.off('data', onData);
      const statusLine = response.subarray(0, response.indexOf('\r\n')).toString('ascii');
      if (!/^HTTP\/1\.[01] 2\d\d\b/.test(statusLine)) return fail(new Error(`Proxy CONNECT failed: ${statusLine}`));
      const remaining = response.subarray(end + 4);
      if (remaining.length) socket.unshift(remaining);
      clearTimeout(timer);
      socket.off('error', fail);
      resolve(socket);
    };
    socket.on('data', onData);
  });
}

function formatAuthority(host: string, port: number) {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

function mergeNoProxy(value: string | undefined) {
  const entries = new Set((value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean));
  for (const local of ['127.0.0.1', 'localhost', '::1']) entries.add(local);
  return [...entries].join(',');
}

function mergeWslenv(value: string | undefined) {
  const entries = new Set((value ?? '').split(':').map((entry) => entry.trim()).filter(Boolean));
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) entries.add(name);
  return [...entries].join(':');
}
