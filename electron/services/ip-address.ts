import net from 'net';

export function normalizeIpAddress(value: string) {
  const input = value.trim().replace(/^\[|\]$/g, '');
  const version = net.isIP(input);
  if (version === 4) return input.split('.').map((part) => String(Number(part))).join('.');
  if (version === 6) return new URL(`http://[${input}]/`).hostname.slice(1, -1).toLowerCase();
  throw new Error(`Invalid IP address: ${value}`);
}

export function normalizeCidr(value: string) {
  const [rawAddress, rawPrefix, ...rest] = value.trim().split('/');
  if (!rawAddress || !rawPrefix || rest.length) throw new Error(`Invalid CIDR: ${value}`);
  const address = normalizeIpAddress(rawAddress);
  const version = net.isIP(address);
  if (version !== 4 && version !== 6) throw new Error(`Invalid CIDR: ${value}`);
  const prefix = Number(rawPrefix);
  const max = version === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) throw new Error(`Invalid CIDR: ${value}`);
  const bits = addressBits(address);
  const hostBits = BigInt(max - prefix);
  const network = hostBits === 0n ? bits : (bits >> hostBits) << hostBits;
  return `${formatBits(network, version)}/${prefix}`;
}

export function cidrContains(cidr: string, candidate: string) {
  try {
    const normalized = normalizeCidr(cidr);
    const [networkAddress, prefixText] = normalized.split('/');
    const address = normalizeIpAddress(candidate);
    const version = net.isIP(networkAddress);
    if (version !== 4 && version !== 6) return false;
    if (net.isIP(address) !== version) return false;
    const max = version === 4 ? 32 : 128;
    const hostBits = BigInt(max - Number(prefixText));
    return (addressBits(address) >> hostBits) === (addressBits(networkAddress) >> hostBits);
  } catch {
    return false;
  }
}

function addressBits(address: string) {
  if (net.isIP(address) === 4) {
    return address.split('.').reduce((value, part) => (value << 8n) | BigInt(Number(part)), 0n);
  }
  return expandIpv6(address).reduce((value, part) => (value << 16n) | BigInt(parseInt(part, 16)), 0n);
}

function expandIpv6(address: string) {
  const [left = '', right = ''] = address.split('::');
  const leftParts = left ? left.split(':') : [];
  const rightParts = right ? right.split(':') : [];
  const missing = 8 - leftParts.length - rightParts.length;
  return [...leftParts, ...Array.from({ length: Math.max(0, missing) }, () => '0'), ...rightParts]
    .map((part) => part || '0');
}

function formatBits(value: bigint, version: 4 | 6) {
  if (version === 4) {
    return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n)).join('.');
  }
  const parts = Array.from({ length: 8 }, (_, index) => Number((value >> BigInt((7 - index) * 16)) & 0xffffn).toString(16));
  return new URL(`http://[${parts.join(':')}]/`).hostname.slice(1, -1).toLowerCase();
}
