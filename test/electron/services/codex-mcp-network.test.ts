// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { resolveWslMcpHost, withMcpProxyBypass } from '@electron/services/agent-adapters/codex-mcp-network';

describe('Codex MCP network', () => {
  it('uses loopback in mirrored mode without consulting a TUN default gateway', async () => {
    const run = vi.fn().mockResolvedValueOnce('mirrored\n').mockResolvedValueOnce('198.18.0.2\n');
    await expect(resolveWslMcpHost('kali-linux', run)).resolves.toBe('127.0.0.1');
    expect(run).toHaveBeenCalledExactlyOnceWith('kali-linux', '/usr/bin/wslinfo', ['--networking-mode']);
  });

  it('preserves the Windows gateway lookup for NAT networking', async () => {
    const run = vi.fn().mockResolvedValueOnce('nat\n').mockResolvedValueOnce('172.30.96.1\n');
    await expect(resolveWslMcpHost('Ubuntu', run)).resolves.toBe('172.30.96.1');
    expect(run).toHaveBeenLastCalledWith('Ubuntu', 'sh', ['-lc',
      "ip route show default | awk '{print $3; exit}'"]);
  });

  it('supports older WSL versions without wslinfo', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('wslinfo unavailable')).mockResolvedValueOnce('172.30.96.1\n');
    await expect(resolveWslMcpHost('Ubuntu', run)).resolves.toBe('172.30.96.1');
  });

  it.each(['', '999.1.1.1', '172.30.96.1\n198.18.0.2'])('rejects an invalid gateway: %j', async (gateway) => {
    const run = vi.fn().mockResolvedValueOnce('nat').mockResolvedValueOnce(gateway);
    await expect(resolveWslMcpHost('Ubuntu', run)).rejects.toThrow('Could not resolve Windows host from WSL');
  });

  it('bypasses only the bridge host while preserving proxies and both existing bypass lists', () => {
    const source = { HTTP_PROXY: 'http://proxy.example:7897', HTTPS_PROXY: 'http://proxy.example:7897',
      NO_PROXY: 'localhost,127.*', no_proxy: 'example.internal,localhost' };
    const result = withMcpProxyBypass(source, 'http://127.0.0.1:12345/mcp');
    expect(result.NO_PROXY).toBe('localhost,127.*,example.internal,127.0.0.1');
    expect(result.no_proxy).toBe(result.NO_PROXY);
    expect(result.HTTP_PROXY).toBe(source.HTTP_PROXY);
    expect(result.HTTPS_PROXY).toBe(source.HTTPS_PROXY);
    expect(source.NO_PROXY).toBe('localhost,127.*');
    expect(source.no_proxy).toBe('example.internal,localhost');
  });

  it('adds the exact NAT bridge host rather than bypassing all private addresses', () => {
    const result = withMcpProxyBypass({}, 'http://172.30.96.1:12345/mcp');
    expect(result.NO_PROXY).toBe('172.30.96.1');
    expect(result.no_proxy).toBe('172.30.96.1');
  });

  it('leaves diagnostic processes without an MCP bridge unaffected', () => {
    const source = { HTTPS_PROXY: 'http://proxy.example:7897', no_proxy: 'localhost' };
    const result = withMcpProxyBypass(source, undefined);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
  });
});
