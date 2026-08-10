import type {
  ShellFlavor,
  WebShellAdapterId,
  WebShellCommandMode,
  WebShellProfileOptions,
  WebShellResolvedRuntime,
  WebShellSystemInfo,
} from '../contracts/shell';
import {
  buildSystemInfoCommand,
  createWebShellProtocolNonce,
  executeWebShellCommand,
  parseSystemInfoOutput,
  probeWebShell,
  type WebShellCommandResult,
} from './webshell.transport';

type ConcreteFlavor = Exclude<ShellFlavor, 'auto' | 'raw'>;
type ConcreteMode = Exclude<WebShellCommandMode, 'auto'>;

export interface WebShellAdapterProbe {
  flavor: ConcreteFlavor;
  commandMode: ConcreteMode;
  cwd: string;
  resolved: WebShellResolvedRuntime;
}

export interface WebShellAdapter {
  readonly id: WebShellAdapterId;
  probe(
    options: WebShellProfileOptions,
    flavor: ConcreteFlavor,
    timeoutMs: number,
    preferredMode?: ConcreteMode,
    projectId?: string,
  ): Promise<WebShellAdapterProbe>;
  execute(
    options: WebShellProfileOptions,
    runtime: WebShellResolvedRuntime,
    command: string,
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number,
    projectId?: string,
  ): Promise<WebShellCommandResult>;
  collectSystemInfo(
    options: WebShellProfileOptions,
    runtime: WebShellResolvedRuntime,
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number,
    projectId?: string,
  ): Promise<WebShellSystemInfo>;
}

class GenericWebShellAdapter implements WebShellAdapter {
  readonly id = 'generic' as const;

  async probe(options: WebShellProfileOptions, flavor: ConcreteFlavor, timeoutMs: number, preferredMode?: ConcreteMode, projectId?: string) {
    const result = await probeWithProject(options, flavor, timeoutMs, preferredMode, 'raw', projectId);
    return {
      ...result,
      resolved: {
        adapterId: this.id,
        runtime: options.runtime ?? 'auto',
        commandMode: result.commandMode,
        shellFlavor: result.flavor,
      },
    };
  }

  execute(
    options: WebShellProfileOptions,
    runtime: WebShellResolvedRuntime,
    command: string,
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number,
    projectId?: string,
  ) {
    if (!runtime.commandMode) throw new Error('Generic WebShell command mode is unresolved');
    return executeWithProject(options, runtime.commandMode, runtime.shellFlavor, command, cwd, signal, timeoutMs, 'raw', projectId);
  }

  async collectSystemInfo(
    options: WebShellProfileOptions,
    runtime: WebShellResolvedRuntime,
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number,
    projectId?: string,
  ) {
    if (!runtime.commandMode) throw new Error('Generic WebShell command mode is unresolved');
    const nonce = createWebShellProtocolNonce();
    const result = await executeWithProject(
      options,
      runtime.commandMode,
      runtime.shellFlavor,
      buildSystemInfoCommand(runtime.shellFlavor, nonce),
      cwd,
      signal,
      timeoutMs,
      'raw',
      projectId,
    );
    return parseSystemInfoOutput(result.output, nonce);
  }
}

class AntSwordV2PhpAdapter implements WebShellAdapter {
  readonly id = 'antsword.v2.php' as const;

  async probe(options: WebShellProfileOptions, flavor: ConcreteFlavor, timeoutMs: number, _preferredMode?: ConcreteMode, projectId?: string) {
    const materialized = this.materialize(options);
    const result = await probeWithProject(materialized, flavor, timeoutMs, 'php_eval', options.antsword!.encoder, projectId);
    return {
      ...result,
      resolved: {
        adapterId: this.id,
        runtime: 'php' as const,
        protocolVersion: '2',
        commandMode: 'php_eval' as const,
        shellFlavor: result.flavor,
      },
    };
  }

  execute(
    options: WebShellProfileOptions,
    runtime: WebShellResolvedRuntime,
    command: string,
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number,
    projectId?: string,
  ) {
    const materialized = this.materialize(options);
    return executeWithProject(
      materialized,
      'php_eval',
      runtime.shellFlavor,
      command,
      cwd,
      signal,
      timeoutMs,
      options.antsword!.encoder,
      projectId,
    );
  }

  async collectSystemInfo(
    options: WebShellProfileOptions,
    runtime: WebShellResolvedRuntime,
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number,
    projectId?: string,
  ) {
    const materialized = this.materialize(options);
    const nonce = createWebShellProtocolNonce();
    const result = await executeWithProject(
      materialized,
      'php_eval',
      runtime.shellFlavor,
      buildSystemInfoCommand(runtime.shellFlavor, nonce),
      cwd,
      signal,
      timeoutMs,
      options.antsword!.encoder,
      projectId,
    );
    return parseSystemInfoOutput(result.output, nonce);
  }

  private materialize(options: WebShellProfileOptions): WebShellProfileOptions {
    if (!options.antsword) throw new Error('AntSword v2 PHP settings are missing');
    return {
      ...options,
      method: 'POST',
      bodyKind: 'form',
      bodyTemplate: `${options.antsword.passwordParameter}={{command}}`,
      commandMode: 'php_eval',
    };
  }
}

function probeWithProject(
  options: WebShellProfileOptions,
  flavor: ConcreteFlavor,
  timeoutMs: number,
  preferredMode: ConcreteMode | undefined,
  encoder: import('../contracts/shell').WebShellPayloadEncoder,
  projectId?: string,
) {
  if (projectId) return probeWebShell(options, flavor, timeoutMs, preferredMode, encoder, projectId);
  if (encoder !== 'raw') return probeWebShell(options, flavor, timeoutMs, preferredMode, encoder);
  return probeWebShell(options, flavor, timeoutMs, preferredMode);
}

function executeWithProject(
  options: WebShellProfileOptions,
  mode: ConcreteMode,
  flavor: ConcreteFlavor,
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number,
  encoder: import('../contracts/shell').WebShellPayloadEncoder,
  projectId?: string,
) {
  if (projectId) return executeWebShellCommand(options, mode, flavor, command, cwd, signal, timeoutMs, encoder, projectId);
  if (encoder !== 'raw') return executeWebShellCommand(options, mode, flavor, command, cwd, signal, timeoutMs, encoder);
  return executeWebShellCommand(options, mode, flavor, command, cwd, signal, timeoutMs);
}

const adapters = new Map<WebShellAdapterId, WebShellAdapter>([
  ['generic', new GenericWebShellAdapter()],
  ['antsword.v2.php', new AntSwordV2PhpAdapter()],
]);

export function getWebShellAdapter(options: WebShellProfileOptions) {
  const adapterId = options.adapterId ?? 'generic';
  const adapter = adapters.get(adapterId);
  if (!adapter) throw new Error(`Unsupported WebShell adapter: ${adapterId}`);
  return adapter;
}

export function listWebShellAdapters() {
  return [...adapters.keys()];
}
