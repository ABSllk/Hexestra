import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import type { InterceptDecision, ProxyProfile, TrafficFlow, TrafficRequest } from '../contracts/traffic';
import { detectMitmproxyRuntime, MITMPROXY_VERSION } from './mitmproxy-runtime';
export { MITMPROXY_VERSION, parseMitmdumpVersion, resolveMitmdumpPath } from './mitmproxy-runtime';

export interface TrafficSidecarOptions {
  projectId: string;
  projectPath: string;
  userDataPath: string;
  profile: ProxyProfile;
  trustedServerCaPath?: string;
  mitmdumpPath?: string | null;
  onFlow: (flow: TrafficFlow) => void;
  onExit: (error: string) => void;
}

export interface TrafficSidecarStatus {
  proxyPort: number;
  controlPort: number;
  caCertificatePath: string;
  version: string;
}

export class TrafficSidecar {
  private child: ChildProcess | null = null;
  private token = '';
  private controlUrl = '';
  private lastSequence = 0;
  private stopped = true;
  private pollAbort: AbortController | null = null;
  private options: TrafficSidecarOptions | null = null;

  async start(options: TrafficSidecarOptions): Promise<TrafficSidecarStatus> {
    if (this.child) throw new Error('Traffic proxy is already running');
    const runtime = await detectMitmproxyRuntime({ override: options.mitmdumpPath });
    if (runtime.status !== 'ready' || !runtime.executablePath) {
      throw new Error(runtime.error ?? 'mitmdump is not available');
    }
    const executable = runtime.executablePath;
    const addonPath = resolveMitmproxyAddonPath();
    if (!fs.existsSync(addonPath)) throw new Error('Hexestra mitmproxy addon is missing');
    const [proxyPort, controlPort] = await Promise.all([reserveLoopbackPort(), reserveLoopbackPort()]);
    const caDirectory = path.join(options.userDataPath, 'traffic-ca', options.projectId);
    fs.mkdirSync(caDirectory, { recursive: true });
    this.token = crypto.randomBytes(32).toString('hex');
    this.controlUrl = `http://127.0.0.1:${controlPort}`;
    this.options = options;
    this.stopped = false;
    const args = buildMitmdumpArgs({
      profile: options.profile,
      proxyPort,
      controlPort,
      caDirectory,
      token: this.token,
      projectId: options.projectId,
      addonPath,
      trustedServerCaPath: options.trustedServerCaPath,
    });
    const child = spawn(executable, args, {
      cwd: options.projectPath,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1' },
    });
    this.child = child;
    const errors: string[] = [];
    child.stderr?.on('data', (data) => {
      const text = data.toString('utf8').trim();
      if (text) errors.push(text.slice(-4_000));
    });
    child.once('exit', (code, signal) => {
      const unexpected = !this.stopped;
      this.child = null;
      this.pollAbort?.abort();
      if (unexpected) {
        options.onExit(errors.at(-1) || `mitmdump exited (${code ?? signal ?? 'unknown'})`);
      }
    });
    try {
      await this.waitUntilReady(child, errors);
    } catch (error) {
      await this.stop();
      throw error;
    }
    this.pollAbort = new AbortController();
    void this.pollEvents(this.pollAbort.signal);
    return {
      proxyPort,
      controlPort,
      caCertificatePath: path.join(caDirectory, 'mitmproxy-ca-cert.cer'),
      version: MITMPROXY_VERSION,
    };
  }

  async decide(decision: InterceptDecision) {
    return this.post('/decision', decision);
  }

  async updateIntercept(interceptRequests: boolean, interceptResponses: boolean) {
    return this.post('/intercept', { interceptRequests, interceptResponses });
  }

  async replay(parentFlowId: string, request: TrafficRequest) {
    return this.post<{ accepted: boolean; flowId: string }>('/replay', { parentFlowId, request });
  }

  async stop() {
    this.stopped = true;
    this.pollAbort?.abort();
    this.pollAbort = null;
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    if (process.platform === 'win32' && child.pid) {
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true, stdio: 'ignore', shell: false,
        });
        killer.once('exit', () => resolve());
        killer.once('error', () => {
          try { child.kill(); } catch { /* already stopped */ }
          resolve();
        });
      });
    } else {
      child.kill('SIGTERM');
    }
  }

  private async waitUntilReady(child: ChildProcess, errors: string[]) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(errors.at(-1) || 'mitmdump exited before becoming ready');
      try {
        const response = await this.get<{ ready: boolean; projectId: string }>('/health', 1_000);
        if (response.ready && response.projectId === this.options?.projectId) return;
      } catch {
        // Startup polls intentionally ignore connection refusal.
      }
      await delay(100);
    }
    throw new Error(errors.at(-1) || 'Timed out while starting the traffic proxy');
  }

  private async pollEvents(signal: AbortSignal) {
    while (!signal.aborted && !this.stopped) {
      try {
        const result = await this.get<{ events: Array<{ seq: number; flow: TrafficFlow }>; lastSeq: number }>(
          `/events?after=${this.lastSequence}&timeout=10`, 12_000, signal,
        );
        for (const event of result.events) {
          if (event.seq <= this.lastSequence) continue;
          this.lastSequence = event.seq;
          this.options?.onFlow(event.flow);
        }
        this.lastSequence = Math.max(this.lastSequence, result.lastSeq);
      } catch (error) {
        if (signal.aborted || this.stopped) return;
        await delay(250);
      }
    }
  }

  private async get<T>(pathname: string, timeoutMs: number, outerSignal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    outerSignal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${this.controlUrl}${pathname}`, {
        headers: { Authorization: `Bearer ${this.token}` }, signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Traffic sidecar returned HTTP ${response.status}`);
      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
      outerSignal?.removeEventListener('abort', abort);
    }
  }

  private async post<T = { accepted: boolean }>(pathname: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.controlUrl}${pathname}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const value = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(value.error || `Traffic sidecar returned HTTP ${response.status}`);
    return value;
  }
}

export function buildMitmdumpArgs(options: {
  profile: ProxyProfile;
  proxyPort: number;
  controlPort: number;
  caDirectory: string;
  token: string;
  projectId: string;
  addonPath: string;
  trustedServerCaPath?: string;
}) {
  const args = [
    '--listen-host', '127.0.0.1', '--listen-port', String(options.proxyPort),
    '--set', `confdir=${options.caDirectory}`,
    '--set', 'block_global=false', '--set', 'connection_strategy=lazy',
    '--set', `hexestra_control_port=${options.controlPort}`,
    '--set', `hexestra_token=${options.token}`,
    '--set', `hexestra_project_id=${options.projectId}`,
    '--set', `hexestra_intercept_requests=${options.profile.interceptRequests}`,
    '--set', `hexestra_intercept_responses=${options.profile.interceptResponses}`,
    '--set', 'hexestra_burp_enabled=false',
    '--scripts', options.addonPath,
  ];
  if (options.trustedServerCaPath) {
    args.push('--set', `ssl_verify_upstream_trusted_ca=${options.trustedServerCaPath}`);
  }
  return args;
}

export function resolveMitmproxyAddonPath() {
  const packaged = path.join(process.resourcesPath ?? '', 'mitmproxy', 'hexestra_addon.py');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(process.cwd(), 'resources', 'mitmproxy', 'hexestra_addon.py');
}

async function reserveLoopbackPort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
