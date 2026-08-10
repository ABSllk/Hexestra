import { describe, expect, it } from 'vitest';
import {
  compileMihomoConfig,
  compileMihomoNodeProbeConfig,
  normalizeEgressChain,
  normalizeEgressNodeInput,
  normalizeEgressUriBatch,
} from '@electron/services/egress-proxy-contract';

describe('egress proxy contract', () => {
  it.each([
    ['http://user:pass@127.0.0.1:8080#HTTP', 'http'],
    ['socks5://user:pass@127.0.0.1:1080#SOCKS', 'socks5'],
    ['ss://YWVzLTEyOC1nY206c2VjcmV0@127.0.0.1:8388#SS', 'ss'],
    ['vless://00000000-0000-4000-8000-000000000001@127.0.0.1:443?security=tls&type=ws&udp=true#VLESS', 'vless'],
    ['trojan://secret@127.0.0.1:443?security=tls#Trojan', 'trojan'],
    ['hysteria2://secret@127.0.0.1:443?sni=proxy.test#HY2', 'hysteria2'],
    ['tuic://00000000-0000-4000-8000-000000000001:secret@127.0.0.1:443#TUIC', 'tuic'],
  ])('imports %s without returning secrets in its summary', (uri, protocol) => {
    const node = normalizeEgressNodeInput({ source: 'uri', value: uri });
    expect(node.protocol).toBe(protocol);
    expect(node.proxy.server).toBe('127.0.0.1');
    expect(node.name).toBeTruthy();
  });

  it('imports a VMess Base64 JSON URI', () => {
    const payload = Buffer.from(JSON.stringify({
      v: '2', ps: 'VMess', add: 'vmess.test', port: '443', id: '00000000-0000-4000-8000-000000000001', aid: '0', scy: 'auto', tls: 'tls', net: 'ws', path: '/ws', host: 'vmess.test',
    })).toString('base64');
    expect(normalizeEgressNodeInput({ source: 'uri', value: `vmess://${payload}` })).toMatchObject({ protocol: 'vmess', udp: true });
  });

  it('normalizes one URI per non-empty line and reports the original invalid line', () => {
    const nodes = normalizeEgressUriBatch([
      'trojan://one@192.0.2.1:443#First',
      '',
      'socks5://two.test:1080#Second',
    ].join('\r\n'));
    expect(nodes.map(({ name, protocol }) => ({ name, protocol }))).toEqual([
      { name: 'First', protocol: 'trojan' },
      { name: 'Second', protocol: 'socks5' },
    ]);
    expect(() => normalizeEgressUriBatch([
      'trojan://one@192.0.2.1:443#First',
      '',
      'socks4://invalid.test:1080',
    ].join('\n'))).toThrow('Proxy URI line 3: Unsupported proxy URI protocol');
  });

  it('defaults an empty VMess security cipher to auto before Mihomo validation', () => {
    const payload = Buffer.from(JSON.stringify({
      v: '2', ps: 'VMess empty cipher', add: 'vmess.test', port: '10808',
      id: '00000000-0000-4000-8000-000000000001', aid: '0', scy: '', net: 'tcp', tls: '',
    })).toString('base64');
    const node = normalizeEgressNodeInput({ source: 'uri', value: `vmess://${payload}` }, 'node-vmess');
    expect(node.proxy).toMatchObject({ type: 'vmess', cipher: 'auto', alterId: 0 });
    const compiled = compileMihomoConfig(
      normalizeEgressChain({ name: 'VMess', nodeIds: ['node-vmess'] }),
      [node],
      { mixedPort: 40001, controllerPort: 40002, secret: 'secret' },
    );
    expect(compiled.config.proxies).toEqual([
      expect.objectContaining({ name: 'hexestra-hop-1', type: 'vmess', cipher: 'auto' }),
    ]);
  });

  it('accepts one whitelisted YAML proxy and rejects control-plane or file-reading fields', () => {
    expect(normalizeEgressNodeInput({ source: 'yaml', value: 'name: safe\ntype: trojan\nserver: proxy.test\nport: 443\npassword: secret\nsni: proxy.test\n' }).protocol).toBe('trojan');
    expect(() => normalizeEgressNodeInput({ source: 'yaml', value: 'proxies: []\nrules: [MATCH,DIRECT]\n' })).toThrow(/Full Mihomo configuration/);
    expect(() => normalizeEgressNodeInput({ source: 'yaml', value: 'type: trojan\nserver: proxy.test\nport: 443\npassword: secret\ndialer-proxy: DIRECT\n' })).toThrow(/dialer-proxy/);
    expect(() => normalizeEgressNodeInput({ source: 'yaml', value: 'type: trojan\nserver: proxy.test\nport: 443\npassword: secret\nca: C:\\\\secret.pem\n' })).toThrow(/Unsafe proxy field/);
    expect(() => normalizeEgressNodeInput({ source: 'uri', value: 'socks4://127.0.0.1:1080' })).toThrow(/Unsupported proxy URI protocol/);
  });

  it('compiles UI traffic order into generated dialer links without a direct fallback', () => {
    const nodes = [
      normalizeEgressNodeInput({ source: 'form', name: 'Hop', value: { type: 'ss', server: 'hop.test', port: 8388, cipher: 'aes-128-gcm', password: 'one', udp: true } }, 'node-1'),
      normalizeEgressNodeInput({ source: 'form', name: 'Exit', value: { type: 'hysteria2', server: 'exit.test', port: 443, password: 'two', udp: true } }, 'node-2'),
    ];
    const chain = normalizeEgressChain({ id: 'chain-1', name: 'Two hop', nodeIds: ['node-1', 'node-2'] });
    const compiled = compileMihomoConfig(chain, nodes, { mixedPort: 40001, controllerPort: 40002, secret: 'controller-secret' });
    expect(compiled.config.proxies).toEqual([
      expect.objectContaining({ name: 'hexestra-hop-1', server: 'hop.test' }),
      expect.objectContaining({ name: 'hexestra-hop-2', server: 'exit.test', 'dialer-proxy': 'hexestra-hop-1' }),
    ]);
    expect(compiled.config.rules).toEqual(['MATCH,hexestra-active']);
    expect(JSON.stringify(compiled.config)).not.toContain('DIRECT');
    expect(compiled).toMatchObject({ tcpReady: true, udpReady: true, exitName: 'hexestra-hop-2' });
  });

  it('compiles standalone node probes without inheriting chain dialers', () => {
    const nodes = [
      normalizeEgressNodeInput({ source: 'form', name: 'One', value: { type: 'ss', server: 'one.test', port: 8388, cipher: 'aes-128-gcm', password: 'one' } }, 'node-1'),
      normalizeEgressNodeInput({ source: 'form', name: 'Two', value: { type: 'trojan', server: 'two.test', port: 443, password: 'two' } }, 'node-2'),
    ];
    const compiled = compileMihomoNodeProbeConfig(nodes, { mixedPort: 40001, controllerPort: 40002, secret: 'secret' });

    expect(compiled.internalNames).toEqual(['hexestra-node-probe-1', 'hexestra-node-probe-2']);
    expect(compiled.config.proxies).toEqual([
      expect.objectContaining({ name: 'hexestra-node-probe-1', server: 'one.test' }),
      expect.objectContaining({ name: 'hexestra-node-probe-2', server: 'two.test' }),
    ]);
    expect(JSON.stringify(compiled.config)).not.toContain('dialer-proxy');
    expect(JSON.stringify(compiled.config)).not.toContain('DIRECT');
  });

  it('rejects duplicate/oversized chains and conservatively blocks UDP', () => {
    expect(() => normalizeEgressChain({ name: 'loop', nodeIds: ['node-1', 'node-1'] })).toThrow(/repeat/);
    expect(() => normalizeEgressChain({ name: 'too long', nodeIds: Array.from({ length: 9 }, (_, index) => `node-${index}`) })).toThrow(/1-8/);
    const node = normalizeEgressNodeInput({ source: 'form', value: { type: 'http', server: 'proxy.test', port: 8080 } }, 'node-1');
    const compiled = compileMihomoConfig(normalizeEgressChain({ name: 'TCP only', nodeIds: ['node-1'] }), [node], { mixedPort: 40001, controllerPort: 40002, secret: 'secret' });
    expect(compiled.tcpReady).toBe(true);
    expect(compiled.udpReady).toBe(false);
  });
});
