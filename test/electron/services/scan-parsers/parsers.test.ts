// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nmapScanParser } from '@electron/services/scan-parsers/nmap';
import { httpxScanParser } from '@electron/services/scan-parsers/httpx';
import { SCAN_PARSER_FORMATS, describeScanParsers, getScanParser } from '@electron/services/scan-parsers';

const NMAP_XML = `<?xml version="1.0"?>
<nmaprun>
  <host>
    <status state="up"/>
    <address addr="192.0.2.10" addrtype="ipv4"/>
    <hostnames><hostname name="web.example.test" type="PTR"/></hostnames>
    <ports>
      <port protocol="tcp" portid="443"><state state="open"/><service name="https" product="nginx" version="1.24.0"/></port>
      <port protocol="tcp" portid="22"><state state="open"/><service name="ssh"/></port>
    </ports>
  </host>
  <host>
    <status state="down"/>
    <address addr="192.0.2.11" addrtype="ipv4"/>
  </host>
  <host>
    <status state="up"/>
    <address addr="00:11:22:33:44:55" addrtype="mac"/>
  </host>
</nmaprun>`;

describe('nmap scan parser', () => {
  it('maps up hosts with hostnames and ports, skipping down or address-less hosts', () => {
    const { registrations, skipped } = nmapScanParser.parse(NMAP_XML);
    expect(skipped).toBe(2); // the down host and the mac-only host
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toEqual({
      type: 'host',
      ip: '192.0.2.10',
      hostname: 'web.example.test',
      ports: [
        { port: 443, protocol: 'tcp', state: 'open', service: 'https', version: 'nginx 1.24.0' },
        { port: 22, protocol: 'tcp', state: 'open', service: 'ssh', version: undefined },
      ],
    });
  });

  it('never throws on non-XML input', () => {
    const result = nmapScanParser.parse('this is not xml at all');
    expect(result.registrations).toEqual([]);
  });
});

const HTTPX_JSONL = [
  '{"url":"https://web.example.test","host":"192.0.2.10","status_code":200,"title":"Home","tech":["nginx"],"webserver":"nginx/1.24.0"}',
  '{"input":"http://api.example.test","status_code":401}',
  'not-json',
  '{"status_code":500}',
  '',
].join('\n');

describe('httpx scan parser', () => {
  it('maps one web app per line and skips malformed or url-less records', () => {
    const { registrations, skipped } = httpxScanParser.parse(HTTPX_JSONL);
    expect(skipped).toBe(2); // the non-json line and the record with no url/input
    expect(registrations).toEqual([
      {
        type: 'webapp',
        url: 'https://web.example.test',
        ip: '192.0.2.10',
        statusCode: 200,
        title: 'Home',
        technologies: ['nginx', 'nginx/1.24.0'],
      },
      {
        type: 'webapp',
        url: 'http://api.example.test',
        ip: undefined,
        statusCode: 401,
        title: undefined,
        technologies: undefined,
      },
    ]);
  });
});

describe('scan parser registry', () => {
  it('exposes registered formats and resolves parsers by key', () => {
    expect(SCAN_PARSER_FORMATS).toContain('nmap');
    expect(SCAN_PARSER_FORMATS).toContain('httpx');
    expect(getScanParser('nmap')).toBe(nmapScanParser);
    expect(getScanParser('httpx')).toBe(httpxScanParser);
    expect(getScanParser('unknown-format')).toBeUndefined();
    expect(describeScanParsers()).toContain('nmap -oX -');
    expect(describeScanParsers()).toContain('httpx -json');
  });
});
