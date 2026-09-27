import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import type { CodexConnectionSettings } from '../../contracts/agent-settings';
import { windowsPathToWsl } from '../wsl-agent-runtime';

type RpcMessage = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };

export class CodexAppServer extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private lineBuffer = '';

  constructor(private readonly settings: CodexConnectionSettings, private readonly cwd?: string,
    private readonly config: Record<string, string | boolean | number> = {}, private readonly environment: NodeJS.ProcessEnv = {}) {
    super();
  }

  async start() {
    if (this.child) return;
    const configArgs = Object.entries(this.config).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]);
    const args = ['app-server', '--stdio', ...configArgs];
    const env = { ...process.env, ...this.environment };
    if (this.settings.executionMode === 'wsl') {
      if (process.platform !== 'win32') throw new Error('WSL Codex requires Windows');
      const forwarded = Object.keys(this.environment).map((key) => `${key}/u`);
      env.WSLENV = [env.WSLENV, ...forwarded].filter(Boolean).join(':');
      const wslArgs = ['--distribution', this.settings.wslDistribution];
      if (this.cwd) wslArgs.push('--cd', windowsPathToWsl(this.cwd, this.settings.wslDistribution));
      wslArgs.push('--exec', this.settings.codexExecutable, ...args);
      this.child = spawn('wsl.exe', wslArgs, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } else {
      this.child = spawn(this.settings.codexExecutable, args, {
        cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      });
    }
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.consume(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => this.emit('stderr', String(chunk)));
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code) => {
      this.child = null;
      this.fail(new Error(`Codex app-server exited (${code ?? 'unknown'})`));
    });
    try {
      await this.request('initialize', { clientInfo: { name: 'hexestra', title: 'Hexestra', version: '0.7.0' } });
      this.notify('initialized', {});
    } catch (error) {
      this.close();
      throw error;
    }
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!this.child) return Promise.reject(new Error('Codex app-server is not running'));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, 60_000);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  respond(id: number, result: unknown) {
    this.child?.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  notify(method: string, params: unknown) {
    this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  close() {
    this.child?.kill();
    this.child = null;
    this.fail(new Error('Codex app-server closed'));
  }

  private consume(chunk: string) {
    this.lineBuffer += chunk;
    for (let end = this.lineBuffer.indexOf('\n'); end >= 0; end = this.lineBuffer.indexOf('\n')) {
      const line = this.lineBuffer.slice(0, end).trim();
      this.lineBuffer = this.lineBuffer.slice(end + 1);
      if (!line) continue;
      let message: RpcMessage;
      try { message = JSON.parse(line) as RpcMessage; } catch { continue; }
      if (typeof message.id === 'number' && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message ?? 'Codex RPC failed'));
        else pending.resolve(message.result);
      } else if (message.method) {
        this.emit('message', message);
      }
    }
  }

  private fail(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.emit('failure', error);
  }
}
