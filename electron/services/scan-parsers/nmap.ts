import { DOMParser } from '@xmldom/xmldom';
import type { StructuredAssetRegistration } from '../sync-targets.service';
import type { ScanParser, ScanParseResult } from './types';

type HostRegistration = Extract<StructuredAssetRegistration, { type: 'host' }>;
type PortEntry = NonNullable<HostRegistration['ports']>[number];

function attr(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name);
  return value == null || value === '' ? undefined : value;
}

function firstChild(element: Element, tag: string): Element | null {
  return element.getElementsByTagName(tag).item(0);
}

function parsePort(portEl: Element): PortEntry | null {
  const portNumber = Number(attr(portEl, 'portid'));
  if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65_535) return null;
  const protocol = attr(portEl, 'protocol');
  const stateEl = firstChild(portEl, 'state');
  const state = stateEl ? attr(stateEl, 'state') : undefined;
  const serviceEl = firstChild(portEl, 'service');
  const version = serviceEl
    ? [attr(serviceEl, 'product'), attr(serviceEl, 'version')].filter(Boolean).join(' ') || undefined
    : undefined;
  return {
    port: portNumber,
    protocol: protocol === 'tcp' || protocol === 'udp' ? protocol : undefined,
    state: state === 'open' || state === 'filtered' || state === 'closed' ? state : undefined,
    service: serviceEl ? attr(serviceEl, 'name') : undefined,
    version,
  };
}

function hostAddress(host: Element): string | undefined {
  const addresses = host.getElementsByTagName('address');
  for (let i = 0; i < addresses.length; i += 1) {
    const address = addresses.item(i);
    if (!address) continue;
    const type = attr(address, 'addrtype');
    if (type === 'ipv4' || type === 'ipv6') return attr(address, 'addr');
  }
  return undefined;
}

/** Nmap XML (`nmap -oX -`) → host + port registrations. */
export const nmapScanParser: ScanParser = {
  format: 'nmap',
  label: 'Nmap XML',
  outputHint: 'nmap -oX -',
  parse(raw): ScanParseResult {
    const registrations: StructuredAssetRegistration[] = [];
    let skipped = 0;

    let document: Document;
    try {
      document = new DOMParser({ errorHandler: () => undefined }).parseFromString(raw, 'text/xml');
    } catch {
      return { registrations, skipped: 0, notes: ['Input was not parseable as Nmap XML.'] };
    }

    const hosts = document.getElementsByTagName('host');
    for (let i = 0; i < hosts.length; i += 1) {
      const host = hosts.item(i);
      if (!host) continue;
      const status = firstChild(host, 'status');
      if (status && attr(status, 'state') === 'down') { skipped += 1; continue; }

      const ip = hostAddress(host);
      if (!ip) { skipped += 1; continue; }

      const hostnameEl = firstChild(host, 'hostname');
      const hostname = hostnameEl ? attr(hostnameEl, 'name') : undefined;

      const portEls = host.getElementsByTagName('port');
      const ports: PortEntry[] = [];
      for (let p = 0; p < portEls.length; p += 1) {
        const portEl = portEls.item(p);
        if (!portEl) continue;
        const parsed = parsePort(portEl);
        if (parsed) ports.push(parsed);
      }

      registrations.push({ type: 'host', ip, hostname, ...(ports.length ? { ports } : {}) });
    }

    return { registrations, skipped };
  },
};
