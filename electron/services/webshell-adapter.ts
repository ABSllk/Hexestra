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
  ): Promise<WebShellAdapterProbe>;
  execute(
    options: WebShellProfileOptions,
    runtime: WebShellResolvedRuntime,
    command: string,
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<WebShellCommandResult>;
  collectSystemInfo(
    options: WebShellProfileOptions,
    runtime: WebShellResolvedRuntime,
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<WebShellSystemInfo>;
}

class GenericWebShellAdapter implements WebShellAdapter {
  readonly id = 'generic' as const;

  async probe(options: WebShellProfileOptions, flavor: ConcreteFlavor, timeoutMs: number, preferredMode?: ConcreteMode) {
    const result = await probeWebShell(options, flavor, timeoutMs, preferredMode);
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
  ) {
    if (!runtime.commandMode) throw new Error('Generic WebShell command mode is unresolved');
    return executeWebShellCommand(options, runtime.commandMode, runtime.shellFlavor, command, cwd, signal, timeoutMs);
  }

  async collectSystemInfo(
    options: WebShellProfileOptions,
    runtime: WebShellResolvedRuntime,
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number,
  ) {
    if (!runtime.commandMode) throw new Error('Generic WebShell command mode is unresolved');
    const nonce = createWebShellProtocolNonce();
    const result = await executeWebShellCommand(
      options,
      runtime.commandMode,
      runtime.shellFlavor,
      buildSystemInfoCommand(runtime.shellFlavor, nonce),
      cwd,
      signal,
      timeoutMs,
    );
    return parseSystemInfoOutput(result.output, nonce);
  }
}

class AntSwordV2PhpAdapter implements WebShellAdapter {
  readonly id = 'antsword.v2.php' as const;

  async probe(options: WebShellProfileOptions, flavor: ConcreteFlavor, timeoutMs: number) {
    const materialized = this.materialize(options);
    const result = await probeWebShell(materialized, flavor, timeoutMs, 'php_eval', options.antsword!.encoder);
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
  ) {
    const materialized = this.materialize(options);
    return executeWebShellCommand(
      materialized,
      'php_eval',
      runtime.shellFlavor,
      command,
      cwd,
      signal,
      timeoutMs,
      options.antsword!.encoder,
    );
  }

  async collectSystemInfo(
    options: WebShellProfileOptions,
    runtime: WebShellResolvedRuntime,
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number,
  ) {
    const materialized = this.materialize(options);
    const nonce = createWebShellProtocolNonce();
    const result = await executeWebShellCommand(
      materialized,
      'php_eval',
      runtime.shellFlavor,
      buildSystemInfoCommand(runtime.shellFlavor, nonce),
      cwd,
      signal,
      timeoutMs,
      options.antsword!.encoder,
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
