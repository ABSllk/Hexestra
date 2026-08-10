import { parseDocument } from 'yaml';
import { randomUUID } from 'crypto';
import type {
  EgressProxyChain,
  EgressProxyNodeInput,
  EgressProxyNodeSummary,
  EgressProxyProtocol,
} from '../contracts/egress-proxy';

export type MihomoProxyObject = Record<string, unknown> & {
  type: string;
  server: string;
  port: number;
};

export interface NormalizedEgressNode {
  id: string;
  name: string;
  protocol: EgressProxyProtocol;
  tcp: boolean;
  udp: boolean;
  proxy: MihomoProxyObject;
  updatedAt: string;
}

const FORBIDDEN_TOP_LEVEL = new Set([
  'proxies', 'proxy-groups', 'proxy-providers', 'rule-providers', 'rules', 'sub-rules',
  'tun', 'dns', 'hosts', 'listeners', 'external-controller', 'external-controller-tls',
  'external-controller-unix', 'external-ui', 'external-ui-url', 'secret', 'mixed-port',
  'redir-port', 'tproxy-port', 'socks-port', 'allow-lan', 'bind-address',
]);
const FORBIDDEN_NODE_KEYS = new Set([
  'dialer-proxy', 'ca', 'ca-str', 'certificate', 'cert', 'client-certificate',
  'client-key', 'private-key', 'private-key-path', 'key-path', 'ssh-key', 'file',
]);
const BASE_KEYS = ['name', 'type', 'server', 'port'] as const;
const TLS_KEYS = ['tls', 'sni', 'servername', 'skip-cert-verify', 'client-fingerprint', 'alpn'] as const;
const TRANSPORT_KEYS = ['network', 'ws-opts', 'grpc-opts', 'http-opts', 'h2-opts'] as const;
const UDP_KEYS = ['udp', 'uot', 'xudp', 'packet-encoding'] as const;
const keys = (...values: readonly (readonly string[])[]) => new Set(values.flat());
const PROTOCOL_KEYS: Record<EgressProxyProtocol, Set<string>> = {
  http: keys(BASE_KEYS, ['username', 'password']),
  https: keys(BASE_KEYS, ['username', 'password'], TLS_KEYS),
  socks5: keys(BASE_KEYS, ['username', 'password', 'udp']),
  ss: keys(BASE_KEYS, ['cipher', 'password', 'udp', 'uot', 'fast-open', 'ip-version']),
  vmess: keys(BASE_KEYS, ['uuid', 'cipher', 'alterId'], TLS_KEYS, TRANSPORT_KEYS, UDP_KEYS),
  vless: keys(BASE_KEYS, ['uuid', 'flow', 'reality-opts'], TLS_KEYS, TRANSPORT_KEYS, UDP_KEYS),
  trojan: keys(BASE_KEYS, ['password'], TLS_KEYS, TRANSPORT_KEYS, UDP_KEYS),
  hysteria2: keys(BASE_KEYS, ['password', 'auth', 'auth-str', 'obfs', 'obfs-password', 'up', 'down'], TLS_KEYS, UDP_KEYS),
  tuic: keys(BASE_KEYS, ['uuid', 'password', 'heartbeat-interval', 'reduce-rtt', 'fast-open', 'congestion-controller', 'udp-relay-mode', 'disable-sni', 'ip-version'], TLS_KEYS, UDP_KEYS),
};
const TYPE_MAP: Record<string, EgressProxyProtocol> = {
  http: 'http', https: 'https', socks: 'socks5', socks5: 'socks5',
  ss: 'ss', shadowsocks: 'ss', vmess: 'vmess', vless: 'vless', trojan: 'trojan',
  hysteria2: 'hysteria2', hy2: 'hysteria2', tuic: 'tuic',
};

export function normalizeEgressNodeInput(input: EgressProxyNodeInput, existingId?: string): NormalizedEgressNode {
  if (!input || (input.source !== 'uri' && input.source !== 'form' && input.source !== 'yaml')) {
    throw new Error('Unsupported proxy node input source');
  }
  const raw = input.source === 'uri'
    ? parseProxyUri(requireString(input.value, 'Proxy URI is required'))
    : input.source === 'yaml'
      ? parseProxyYaml(requireString(input.value, 'Proxy YAML is required'))
      : requireRecord(input.value, 'Proxy form is invalid');
  const proxy = normalizeProxyObject(raw);
  const protocol = protocolOf(proxy);
  const suppliedName = typeof input.name === 'string' && input.name.trim()
    ? input.name.trim()
    : typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : `${protocol.toUpperCase()} ${proxy.server}`;
  delete proxy.name;
  return {
    id: existingId && isId(existingId) ? existingId : `proxy-node-${randomUUID()}`,
    name: suppliedName.slice(0, 100),
    protocol,
    tcp: true,
    udp: nodeSupportsUdp(protocol, proxy),
    proxy,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeEgressUriBatch(value: unknown): NormalizedEgressNode[] {
  if (typeof value !== 'string' || !value.trim()) throw new Error('At least one proxy URI is required');
  if (value.length > 500_000) throw new Error('Proxy URI batch exceeds the 500 KB limit');
  const entries = value
    .split(/\r\n?|\n/)
    .map((uri, index) => ({ uri: uri.trim(), line: index + 1 }))
    .filter(({ uri }) => Boolean(uri));
  if (entries.length > 200) throw new Error('Proxy URI batch supports at most 200 nodes');

  return entries.map(({ uri, line }) => {
    if (uri.length > 100_000) throw new Error(`Proxy URI line ${line}: URI exceeds the 100 KB limit`);
    try {
      return normalizeEgressNodeInput({ source: 'uri', value: uri });
    } catch (error) {
      throw new Error(`Proxy URI line ${line}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export function summarizeEgressNode(node: NormalizedEgressNode): EgressProxyNodeSummary {
  return {
    id: node.id,
    name: node.name,
    protocol: node.protocol,
    tcp: node.tcp,
    udp: node.udp,
    updatedAt: node.updatedAt,
  };
}

export function normalizeEgressChain(value: unknown): EgressProxyChain {
  const record = requireRecord(value, 'Proxy chain is invalid');
  const nodeIds = Array.isArray(record.nodeIds) ? record.nodeIds : [];
  if (nodeIds.length < 1 || nodeIds.length > 8 || !nodeIds.every(isId)) {
    throw new Error('A proxy chain requires 1-8 valid node IDs');
  }
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error('A proxy chain cannot repeat a node');
  return {
    id: isId(record.id) ? record.id : `proxy-chain-${randomUUID()}`,
    name: typeof record.name === 'string' && record.name.trim()
      ? record.name.trim().slice(0, 100)
      : 'Proxy chain',
    nodeIds: [...nodeIds],
  };
}

export function compileMihomoConfig(
  chain: EgressProxyChain,
  nodes: NormalizedEgressNode[],
  input: { mixedPort: number; controllerPort: number; secret: string },
) {
  const resolved = chain.nodeIds.map((id) => nodes.find((node) => node.id === id));
  if (resolved.some((node) => !node)) {
    const missing = chain.nodeIds.filter((id) => !nodes.some((node) => node.id === id));
    throw new Error(`Proxy chain is blocked by missing node(s): ${missing.join(', ')}`);
  }
  const complete = resolved as NormalizedEgressNode[];
  const internalNames = complete.map((_, index) => `hexestra-hop-${index + 1}`);
  const proxies = complete.map((node, index) => ({
    ...structuredClone(node.proxy),
    name: internalNames[index],
    ...(index > 0 ? { 'dialer-proxy': internalNames[index - 1] } : {}),
  }));
  const exitName = internalNames[internalNames.length - 1];
  return {
    config: {
      'mixed-port': assertPort(input.mixedPort),
      'external-controller': `127.0.0.1:${assertPort(input.controllerPort)}`,
      secret: input.secret,
      'allow-lan': false,
      'bind-address': '127.0.0.1',
      mode: 'rule',
      ipv6: false,
      'log-level': 'warning',
      proxies,
      'proxy-groups': [{ name: 'hexestra-active', type: 'select', proxies: [exitName] }],
      rules: ['MATCH,hexestra-active'],
    },
    tcpReady: complete.every((node) => node.tcp),
    udpReady: complete.every((node) => node.udp),
    internalNames,
    exitName,
  };
}

export function compileMihomoNodeProbeConfig(
  nodes: NormalizedEgressNode[],
  input: { mixedPort: number; controllerPort: number; secret: string },
) {
  if (nodes.length === 0) throw new Error('At least one proxy node is required for testing');
  const internalNames = nodes.map((_, index) => `hexestra-node-probe-${index + 1}`);
  const proxies = nodes.map((node, index) => ({
    ...structuredClone(node.proxy),
    name: internalNames[index],
  }));
  return {
    config: {
      'mixed-port': assertPort(input.mixedPort),
      'external-controller': `127.0.0.1:${assertPort(input.controllerPort)}`,
      secret: input.secret,
      'allow-lan': false,
      'bind-address': '127.0.0.1',
      mode: 'rule',
      ipv6: false,
      'log-level': 'warning',
      proxies,
      'proxy-groups': [{ name: 'hexestra-node-probe', type: 'select', proxies: internalNames }],
      rules: ['MATCH,hexestra-node-probe'],
    },
    internalNames,
  };
}

function parseProxyYaml(source: string): Record<string, unknown> {
  if (source.length > 256_000) throw new Error('Proxy YAML exceeds 256 KiB');
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`Invalid proxy YAML: ${document.errors[0].message}`);
  const value = document.toJS({ maxAliasCount: 0 }) as unknown;
  return requireRecord(value, 'Advanced YAML must contain one Mihomo proxy object');
}

function parseProxyUri(source: string): Record<string, unknown> {
  const trimmed = source.trim();
  const scheme = trimmed.slice(0, trimmed.indexOf(':')).toLowerCase();
  if (scheme === 'vmess') {
    const payload = JSON.parse(decodeBase64(trimmed.slice('vmess://'.length))) as unknown;
    const record = requireRecord(payload, 'Invalid VMess URI payload');
    return {
      name: text(record.ps), type: 'vmess', server: text(record.add), port: number(record.port),
      uuid: text(record.id), alterId: number(record.aid, 0), cipher: text(record.scy) || 'auto',
      tls: text(record.tls) === 'tls', servername: text(record.sni) || undefined,
      network: text(record.net) || undefined,
      'ws-opts': text(record.net) === 'ws' ? { path: text(record.path, '/'), headers: text(record.host) ? { Host: text(record.host) } : undefined } : undefined,
      udp: true,
    };
  }
  if (scheme === 'ss') return parseShadowsocksUri(trimmed);
  const parsed = new URL(trimmed);
  const mapped = TYPE_MAP[parsed.protocol.slice(0, -1).toLowerCase()];
  if (!mapped) throw new Error('Unsupported proxy URI protocol');
  const query = parsed.searchParams;
  const result: Record<string, unknown> = {
    name: decodeFragment(parsed.hash),
    type: mapped === 'https' ? 'http' : mapped,
    server: parsed.hostname,
    port: Number(parsed.port),
  };
  if (mapped === 'http' || mapped === 'https' || mapped === 'socks5') {
    if (parsed.username) result.username = decodeURIComponent(parsed.username);
    if (parsed.password) result.password = decodeURIComponent(parsed.password);
    if (mapped === 'https') result.tls = true;
  } else if (mapped === 'vless') {
    result.uuid = decodeURIComponent(parsed.username);
  } else if (mapped === 'trojan') {
    result.password = decodeURIComponent(parsed.username);
  } else if (mapped === 'hysteria2') {
    result.password = decodeURIComponent(parsed.username || parsed.password);
  } else if (mapped === 'tuic') {
    result.uuid = decodeURIComponent(parsed.username);
    result.password = decodeURIComponent(parsed.password);
  }
  applyUriOptions(result, query);
  return result;
}

function parseShadowsocksUri(source: string): Record<string, unknown> {
  const withoutScheme = source.slice(5);
  const [authorityAndPath, fragment] = withoutScheme.split('#', 2);
  const authority = authorityAndPath.split('?', 1)[0];
  let userInfo: string;
  let hostPort: string;
  if (authority.includes('@')) {
    const at = authority.lastIndexOf('@');
    userInfo = authority.slice(0, at);
    hostPort = authority.slice(at + 1);
    if (!userInfo.includes(':')) userInfo = decodeBase64(userInfo);
  } else {
    const decoded = decodeBase64(authority);
    const at = decoded.lastIndexOf('@');
    if (at < 0) throw new Error('Invalid Shadowsocks URI');
    userInfo = decoded.slice(0, at);
    hostPort = decoded.slice(at + 1);
  }
  const separator = userInfo.indexOf(':');
  const endpoint = new URL(`http://${hostPort}`);
  return {
    name: fragment ? decodeURIComponent(fragment) : undefined,
    type: 'ss',
    server: endpoint.hostname,
    port: Number(endpoint.port),
    cipher: decodeURIComponent(userInfo.slice(0, separator)),
    password: decodeURIComponent(userInfo.slice(separator + 1)),
    udp: true,
  };
}

function applyUriOptions(result: Record<string, unknown>, query: URLSearchParams) {
  const security = query.get('security');
  if (security === 'tls' || security === 'reality') result.tls = true;
  const sni = query.get('sni') || query.get('peer');
  if (sni) result.servername = sni;
  const type = query.get('type');
  if (type && type !== 'tcp') result.network = type;
  const flow = query.get('flow');
  if (flow) result.flow = flow;
  const fp = query.get('fp');
  if (fp) result['client-fingerprint'] = fp;
  const packetEncoding = query.get('packetEncoding') || query.get('packet-encoding');
  if (packetEncoding) result['packet-encoding'] = packetEncoding;
  if (query.get('allowInsecure') === '1' || query.get('insecure') === '1') result['skip-cert-verify'] = true;
  if (type === 'ws') {
    result['ws-opts'] = {
      path: query.get('path') || '/',
      ...(query.get('host') ? { headers: { Host: query.get('host') } } : {}),
    };
  }
  const udp = query.get('udp') === '1' || query.get('udp') === 'true'
    || packetEncoding === 'xudp' || result.type === 'hysteria2' || result.type === 'tuic';
  if (udp) result.udp = true;
}

function normalizeProxyObject(value: Record<string, unknown>): MihomoProxyObject {
  for (const key of Object.keys(value)) {
    const normalizedKey = key.toLowerCase();
    if (FORBIDDEN_TOP_LEVEL.has(normalizedKey)) throw new Error(`Full Mihomo configuration field is not allowed: ${key}`);
    if (FORBIDDEN_NODE_KEYS.has(normalizedKey)) throw new Error(`Unsafe proxy field is not allowed: ${key}`);
  }
  assertNoForbiddenNestedField(value);
  const protocol = protocolOf(value);
  for (const key of Object.keys(value)) {
    if (!PROTOCOL_KEYS[protocol].has(key)) throw new Error(`Unsupported ${protocol} proxy field: ${key}`);
  }
  const server = typeof value.server === 'string' ? value.server.trim() : '';
  if (!server || server.toUpperCase() === 'DIRECT' || server.includes('\0')) throw new Error('Proxy server is required');
  const port = number(value.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Proxy port is invalid');
  const normalized: Record<string, unknown> = { ...value, type: mihomoType(protocol), server, port };
  if (protocol === 'vmess') {
    if (normalized.cipher === undefined || (typeof normalized.cipher === 'string' && !normalized.cipher.trim())) {
      normalized.cipher = 'auto';
    } else if (typeof normalized.cipher !== 'string') {
      throw new Error('vmess proxy cipher must be a string');
    } else {
      normalized.cipher = normalized.cipher.trim();
    }
  }
  requireProtocolCredentials(protocol, normalized);
  return Object.fromEntries(Object.entries(normalized)
    .filter(([, item]) => item !== undefined && item !== '')) as MihomoProxyObject;
}

function assertNoForbiddenNestedField(value: unknown) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach(assertNoForbiddenNestedField);
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_NODE_KEYS.has(key.toLowerCase())) throw new Error(`Unsafe proxy field is not allowed: ${key}`);
    assertNoForbiddenNestedField(nested);
  }
}

function requireProtocolCredentials(protocol: EgressProxyProtocol, value: Record<string, unknown>) {
  const required = protocol === 'vmess' || protocol === 'vless' ? ['uuid']
    : protocol === 'ss' ? ['cipher', 'password']
      : protocol === 'trojan' || protocol === 'hysteria2' ? ['password']
        : protocol === 'tuic' ? ['uuid', 'password'] : [];
  for (const key of required) {
    if (typeof value[key] !== 'string' || !value[key]) throw new Error(`${protocol} proxy requires ${key}`);
  }
}

function protocolOf(value: Record<string, unknown>): EgressProxyProtocol {
  const type = typeof value.type === 'string' ? value.type.toLowerCase() : '';
  const mapped = TYPE_MAP[type];
  if (!mapped) throw new Error('Unsupported Mihomo proxy type');
  if (mapped === 'http' && value.tls === true) return 'https';
  return mapped;
}

function mihomoType(protocol: EgressProxyProtocol) {
  if (protocol === 'https') return 'http';
  return protocol;
}

function nodeSupportsUdp(protocol: EgressProxyProtocol, proxy: Record<string, unknown>) {
  if (proxy.udp === false) return false;
  if (protocol === 'ss' || protocol === 'hysteria2' || protocol === 'tuic') return true;
  return proxy.udp === true || proxy.uot === true || proxy.xudp === true || proxy['packet-encoding'] === 'xudp';
}

function decodeBase64(value: string) {
  try {
    return Buffer.from(decodeURIComponent(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    throw new Error('Invalid Base64 proxy URI');
  }
}

function decodeFragment(value: string) {
  return value ? decodeURIComponent(value.slice(1)) : undefined;
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function number(value: unknown, fallback = Number.NaN) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireString(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value.trim();
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value);
}

function assertPort(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error('Invalid runtime port');
  return value;
}
