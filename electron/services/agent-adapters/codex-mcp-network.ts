import { execFile } from 'child_process';
import { isIPv4 } from 'net';

type WslCommand = (distribution: string, command: string, args: string[]) => Promise<string>;

const runWsl: WslCommand = (distribution, command, args) => new Promise((resolve, reject) => {
  execFile('wsl.exe', ['--distribution', distribution, '--exec', command, ...args],
    { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
});

export async function resolveWslMcpHost(distribution: string, run: WslCommand = runWsl): Promise<string> {
  try {
    const mode = (await run(distribution, '/usr/bin/wslinfo', ['--networking-mode'])).trim().toLowerCase();
    if (mode === 'mirrored') return '127.0.0.1';
  } catch {
    // Older WSL versions do not provide wslinfo; preserve their gateway lookup.
  }
  const host = (await run(distribution, 'sh', ['-lc',
    "ip route show default | awk '{print $3; exit}'"])).trim();
  if (!isIPv4(host)) throw new Error('Could not resolve Windows host from WSL');
  return host;
}

export function withMcpProxyBypass(source: NodeJS.ProcessEnv, bridgeUrl: unknown): NodeJS.ProcessEnv {
  const env = { ...source };
  if (typeof bridgeUrl !== 'string') return env;
  const host = new URL(bridgeUrl).hostname;
  const entries = [source.NO_PROXY, source.no_proxy, host]
    .flatMap((value) => (value ?? '').split(','))
    .map((value) => value.trim()).filter(Boolean);
  const bypass = [...new Set(entries)].join(',');
  env.NO_PROXY = bypass;
  env.no_proxy = bypass;
  return env;
}
