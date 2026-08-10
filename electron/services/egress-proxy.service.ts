import { app, BrowserWindow, dialog, ipcMain, webContents } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import tls from 'tls';
import { stringify } from 'yaml';
import {
  EGRESS_PROXY_IPC,
  type EgressProxyChain,
  type EgressProxyChainTestResult,
  type EgressProxyNodeInput,
  type EgressProxyNodeTestResult,
  type EgressProxyRuntimeDiagnostic,
  type EgressProxyStatusSnapshot,
} from '../contracts/egress-proxy';
import { appSettingsService } from './app-settings.service';
import { compileMihomoConfig, compileMihomoNodeProbeConfig, normalizeEgressChain } from './egress-proxy-contract';
import { egressProxyVault } from './egress-proxy-vault';
import { publishProjectEgressRoute, openHttpConnectTunnel } from './project-egress';
import { sessionService } from './session.service';
import { browserService } from './browser.service';
import { trafficService } from './traffic.service';
import { shellService } from './shell.service';
import { parseMihomoVersion, requestMihomoController } from './mihomo-controller';

interface ProjectRuntime {
  projectId: string;
  process: ChildProcess;
  mixedPort: number;
  controllerPort: number;
  secret: string;
  configPath: string;
  expectedStop: boolean;
  latencyProbeRevision: number;
}

interface ExitIpResolvers {
  proxied: (mixedPort: number) => Promise<string>;
  direct: () => Promise<string>;
}

const DEFAULT_EXIT_IP_RESOLVERS: ExitIpResolvers = {
  proxied: fetchProxiedExitIp,
  direct: resolveDirectExitIp,
};

export class EgressProxyService {
  private readonly runtimes = new Map<string, ProjectRuntime>();
  private readonly snapshots = new Map<string, EgressProxyStatusSnapshot>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly portAssignments = new Map<string, { mixedPort: number; controllerPort: number }>();
  private nodeProbeOperation: Promise<EgressProxyNodeTestResult> | null = null;
  private nodeProbeProcess: ChildProcess | null = null;
  private runtimeDirectoryPrepared = false;

  constructor(private readonly exitIpResolvers: ExitIpResolvers = DEFAULT_EXIT_IP_RESOLVERS) {
    ipcMain.handle(EGRESS_PROXY_IPC.RUNTIME_DIAGNOSE, () => this.diagnoseRuntime());
    ipcMain.handle(EGRESS_PROXY_IPC.RUNTIME_CHOOSE, (event) => this.chooseRuntime(event.sender));
    ipcMain.handle(EGRESS_PROXY_IPC.RUNTIME_START, (_event, projectId: string) => this.start(projectId));
    ipcMain.handle(EGRESS_PROXY_IPC.RUNTIME_STOP, (_event, projectId: string) => this.stop(projectId));
    ipcMain.handle(EGRESS_PROXY_IPC.STATUS, (_event, projectId: string) => this.status(projectId, true));
    ipcMain.handle(EGRESS_PROXY_IPC.REFRESH_EXIT, (_event, projectId: string) => this.refreshExit(projectId));
    ipcMain.handle(EGRESS_PROXY_IPC.NODES_LIST, () => this.nodesList());
    ipcMain.handle(EGRESS_PROXY_IPC.NODES_IMPORT, (_event, input: EgressProxyNodeInput) => this.nodeSave(input));
    ipcMain.handle(EGRESS_PROXY_IPC.NODES_IMPORT_BATCH, (_event, value: string) => this.nodesImportBatch(value));
    ipcMain.handle(EGRESS_PROXY_IPC.NODES_UPDATE, (_event, nodeId: string, input: EgressProxyNodeInput) => this.nodeSave(input, nodeId));
    ipcMain.handle(EGRESS_PROXY_IPC.NODES_DELETE, (_event, nodeId: string) => this.nodeDelete(nodeId));
    ipcMain.handle(EGRESS_PROXY_IPC.NODES_TEST, () => this.nodesTest());
    ipcMain.handle(EGRESS_PROXY_IPC.CHAINS_LIST, (_event, projectId: string) => this.chainsList(projectId));
    ipcMain.handle(EGRESS_PROXY_IPC.CHAINS_SAVE, (_event, projectId: string, chain: unknown) => this.chainSave(projectId, chain));
    ipcMain.handle(EGRESS_PROXY_IPC.CHAINS_DELETE, (_event, projectId: string, chainId: string) => this.chainDelete(projectId, chainId));
    ipcMain.handle(EGRESS_PROXY_IPC.CHAINS_ACTIVATE, (_event, projectId: string, chainId: string) => this.chainActivate(projectId, chainId));
    ipcMain.handle(EGRESS_PROXY_IPC.CHAINS_TEST, (_event, projectId: string, chainId: string) => this.chainTest(projectId, chainId));
    ipcMain.handle(EGRESS_PROXY_IPC.ENFORCEMENT_SET, (_event, projectId: string, enabled: boolean) => this.setEnforcement(projectId, enabled));
  }

  nodesList() {
    return egressProxyVault.list();
  }

  chainsList(projectId: string) {
    return sessionService.getProjectState(projectId).proxy.chains;
  }

  async nodeSave(input: EgressProxyNodeInput, nodeId?: string) {
    const node = await egressProxyVault.save(input, nodeId);
    await this.reloadAffectedRuntimes(node.id);
    return node;
  }

  nodesImportBatch(value: string) {
    return egressProxyVault.importUriBatch(value);
  }

  async nodeDelete(nodeId: string) {
    const deleted = await egressProxyVault.delete(nodeId);
    if (deleted) await this.reloadAffectedRuntimes(nodeId);
    return deleted;
  }

  nodesTest(): Promise<EgressProxyNodeTestResult> {
    if (this.nodeProbeOperation) return this.nodeProbeOperation;
    const operation = this.runNodeTests().finally(() => {
      if (this.nodeProbeOperation === operation) this.nodeProbeOperation = null;
    });
    this.nodeProbeOperation = operation;
    return operation;
  }

  async diagnoseRuntime(candidatePath = appSettingsService.get().mihomoPath): Promise<EgressProxyRuntimeDiagnostic> {
    const diagnostic: EgressProxyRuntimeDiagnostic = {
      configuredPath: candidatePath,
      exists: false,
      executable: false,
      version: null,
      supported: false,
      error: null,
      warning: null,
    };
    if (!candidatePath) return { ...diagnostic, error: 'Select a Mihomo executable' };
    diagnostic.exists = fs.existsSync(candidatePath);
    if (!diagnostic.exists) return { ...diagnostic, error: 'Mihomo executable was not found' };
    try {
      const output = await runChild(candidatePath, ['-v'], 5_000);
      diagnostic.executable = true;
      diagnostic.version = parseMihomoVersion(output);
      diagnostic.supported = true;
    } catch (error) {
      diagnostic.error = errorMessage(error);
    }
    return diagnostic;
  }

  async chooseRuntime(sender: Electron.WebContents) {
    const owner = BrowserWindow.fromWebContents(sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Select Mihomo executable',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Mihomo', extensions: ['exe'] }] : undefined,
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const diagnostic = await this.diagnoseRuntime(result.filePaths[0]);
    if (diagnostic.supported) appSettingsService.update({ mihomoPath: result.filePaths[0] });
    return diagnostic;
  }

  async status(projectId: string, autoStart = false): Promise<EgressProxyStatusSnapshot> {
    assertProjectId(projectId);
    if (autoStart) await this.stopOtherRuntimes(projectId);
    const persisted = sessionService.getProjectState(projectId).proxy;
    if (!persisted.enabled) {
      if (this.runtimes.has(projectId)) await this.stop(projectId, false);
      if (autoStart) return this.refreshDirectExit(projectId);
      const current = this.snapshots.get(projectId);
      if (current?.state === 'off' && !current.enabled) return { ...current, nodeLatencyMs: { ...current.nodeLatencyMs } };
      return this.transition(projectId, {
        state: 'off', enabled: false, error: null, mixedPort: null, exitIp: null, lastCheckedAt: null,
      });
    }
    if (autoStart && !this.runtimes.has(projectId)) return this.start(projectId);
    return this.snapshots.get(projectId) ?? this.transition(projectId, {
      state: 'blocked', enabled: true, error: 'Project proxy runtime is stopped', mixedPort: null,
    });
  }

  async setEnforcement(projectId: string, enabled: boolean) {
    const state = sessionService.updateProjectState(projectId, { proxy: { enabled: enabled === true } });
    if (enabled) return this.start(projectId);
    await this.stop(projectId, false);
    return this.refreshDirectExit(projectId, {
      activeChainId: state.proxy.activeChainId,
      activeChainName: state.proxy.chains.find((chain) => chain.id === state.proxy.activeChainId)?.name ?? null,
    });
  }

  start(projectId: string) {
    return this.enqueue(projectId, () => this.startNow(projectId));
  }

  async stop(projectId: string, blocked = true): Promise<EgressProxyStatusSnapshot> {
    return this.enqueue(projectId, async () => {
      const runtime = this.runtimes.get(projectId);
      if (runtime) {
        runtime.expectedStop = true;
        this.runtimes.delete(projectId);
        runtime.process.kill();
        removeFile(runtime.configPath);
      }
      await this.closeManagedConnections(projectId, 'Project proxy runtime stopped before the operation completed');
      const persisted = sessionService.getProjectState(projectId).proxy;
      return this.transition(projectId, {
        state: persisted.enabled && blocked ? 'blocked' : 'off',
        enabled: persisted.enabled,
        mixedPort: null,
        exitIp: null,
        lastCheckedAt: null,
        error: persisted.enabled && blocked ? 'Project proxy runtime is stopped' : null,
      });
    });
  }

  async chainSave(projectId: string, value: unknown) {
    const chain = normalizeEgressChain(value);
    const current = sessionService.getProjectState(projectId);
    const chains = [...current.proxy.chains.filter((item) => item.id !== chain.id), chain];
    await this.preflightChain(projectId, chain);
    if (current.proxy.enabled && current.proxy.activeChainId === chain.id && this.runtimes.has(projectId)) {
      await this.reload(projectId, chain);
    }
    const next = sessionService.updateProjectState(projectId, { proxy: { chains } });
    if (next.proxy.enabled && next.proxy.activeChainId === chain.id && !this.runtimes.has(projectId)) await this.start(projectId);
    return chain;
  }

  async chainDelete(projectId: string, chainId: string) {
    const current = sessionService.getProjectState(projectId);
    const chains = current.proxy.chains.filter((chain) => chain.id !== chainId);
    if (chains.length === current.proxy.chains.length) return false;
    const wasActive = current.proxy.activeChainId === chainId;
    sessionService.updateProjectState(projectId, { proxy: { chains, activeChainId: wasActive ? null : current.proxy.activeChainId } });
    if (wasActive && current.proxy.enabled) await this.stop(projectId, true);
    return true;
  }

  async chainActivate(projectId: string, chainId: string) {
    const state = sessionService.getProjectState(projectId);
    const chain = state.proxy.chains.find((candidate) => candidate.id === chainId);
    if (!chain) throw new Error('Proxy chain is missing');
    await this.preflightChain(projectId, chain);
    if (state.proxy.enabled && this.runtimes.has(projectId)) {
      const snapshot = await this.reload(projectId, chain);
      sessionService.updateProjectState(projectId, { proxy: { activeChainId: chainId } });
      return snapshot;
    }
    sessionService.updateProjectState(projectId, { proxy: { activeChainId: chainId } });
    if (state.proxy.enabled) return this.start(projectId);
    return this.transition(projectId, { state: 'off', enabled: false, activeChainId: chain.id, activeChainName: chain.name });
  }

  async chainTest(projectId: string, chainId: string): Promise<EgressProxyChainTestResult> {
    const chain = this.requireChain(projectId, chainId);
    try {
      const compiled = await this.preflightChain(projectId, chain);
      const runtime = this.runtimes.get(projectId);
      const activeChainId = sessionService.getProjectState(projectId).proxy.activeChainId;
      if (!runtime || activeChainId !== chain.id) {
        return {
          chainId, tcpReady: false, udpReady: false, latencyMs: null, nodeLatencyMs: {},
          error: 'Activate this chain and start Mihomo before testing its live latency',
        };
      }
      const probe = await this.refreshActiveChainLatency(projectId, runtime, chain, compiled.internalNames);
      const allNodesReachable = chain.nodeIds.every((nodeId) => typeof probe.nodeLatencyMs[nodeId] === 'number');
      const udpReady = allNodesReachable && compiled.udpReady && await this.liveUdpReady(runtime, compiled.internalNames);
      return {
        chainId, tcpReady: compiled.tcpReady && allNodesReachable, udpReady,
        latencyMs: probe.latencyMs, nodeLatencyMs: probe.nodeLatencyMs,
        error: allNodesReachable ? null : 'One or more proxy hops are unreachable',
      };
    } catch (error) {
      return { chainId, tcpReady: false, udpReady: false, latencyMs: null, nodeLatencyMs: {}, error: errorMessage(error) };
    }
  }

  async refreshExit(projectId: string) {
    const persisted = sessionService.getProjectState(projectId).proxy;
    const runtime = this.runtimes.get(projectId);
    if (!runtime) {
      if (!persisted.enabled) return this.refreshDirectExit(projectId);
      return this.transition(projectId, {
        state: 'blocked', enabled: true, exitIp: null, error: 'Project proxy runtime is stopped',
      });
    }
    try {
      const exitIp = await this.exitIpResolvers.proxied(runtime.mixedPort);
      return this.transition(projectId, { state: 'ready', exitIp, lastCheckedAt: new Date().toISOString(), error: null });
    } catch {
      return this.transition(projectId, { state: 'degraded', exitIp: null, lastCheckedAt: new Date().toISOString(), error: 'Exit IP is unavailable through the active proxy' });
    }
  }

  private async refreshDirectExit(projectId: string, patch: Partial<EgressProxyStatusSnapshot> = {}) {
    const checkedAt = new Date().toISOString();
    try {
      const exitIp = await this.exitIpResolvers.direct();
      if (sessionService.getProjectState(projectId).proxy.enabled) return this.status(projectId, false);
      return this.transition(projectId, {
        ...patch, state: 'off', enabled: false, mixedPort: null, exitIp, lastCheckedAt: checkedAt, error: null,
      });
    } catch {
      if (sessionService.getProjectState(projectId).proxy.enabled) return this.status(projectId, false);
      return this.transition(projectId, {
        ...patch, state: 'off', enabled: false, mixedPort: null, exitIp: null, lastCheckedAt: checkedAt, error: null,
      });
    }
  }

  async close() {
    if (this.nodeProbeProcess) {
      this.nodeProbeProcess.kill();
      this.nodeProbeProcess = null;
    }
    await Promise.all([...this.runtimes.keys()].map((projectId) => this.stop(projectId, false)));
  }

  private async runNodeTests(): Promise<EgressProxyNodeTestResult> {
    const checkedAt = new Date().toISOString();
    const nodeIds = this.nodesList().map((node) => node.id);
    if (nodeIds.length === 0) return { checkedAt, nodeLatencyMs: {} };
    const diagnostic = await this.diagnoseRuntime();
    if (!diagnostic.supported || !diagnostic.configuredPath) {
      throw new Error(diagnostic.error || 'Mihomo runtime is unavailable');
    }
    const nodes = await egressProxyVault.readNodes(nodeIds);
    const ports = await allocateLoopbackPortPair();
    const secret = randomBytes(32).toString('base64url');
    const compiled = compileMihomoNodeProbeConfig(nodes, { ...ports, secret });
    const directory = nodeProbeDirectory();
    fs.mkdirSync(directory, { recursive: true });
    for (const entry of fs.readdirSync(directory)) {
      if (entry.endsWith('.yaml')) removeFile(path.join(directory, entry));
    }
    let configPath: string | null = null;
    let child: ChildProcess | null = null;
    try {
      configPath = await this.validateConfig(diagnostic.configuredPath, compiled.config, directory);
      child = spawn(diagnostic.configuredPath, ['-d', directory, '-f', configPath], { windowsHide: true, stdio: 'ignore' });
      this.nodeProbeProcess = child;
      const runtime: ProjectRuntime = {
        projectId: 'node-probe', process: child, mixedPort: ports.mixedPort,
        controllerPort: ports.controllerPort, secret, configPath,
        expectedStop: false, latencyProbeRevision: 0,
      };
      await waitForController(runtime, 10_000);
      const latencies = await Promise.all(compiled.internalNames.map((name) => this.controllerDelay(runtime, name).catch(() => null)));
      return {
        checkedAt,
        nodeLatencyMs: Object.fromEntries(nodeIds.map((nodeId, index) => [nodeId, latencies[index] ?? null])),
      };
    } finally {
      if (this.nodeProbeProcess === child) this.nodeProbeProcess = null;
      child?.kill();
      if (configPath) removeFile(configPath);
    }
  }

  private async startNow(projectId: string): Promise<EgressProxyStatusSnapshot> {
    assertProjectId(projectId);
    const persisted = sessionService.getProjectState(projectId).proxy;
    if (!persisted.enabled) return this.refreshDirectExit(projectId);
    const chain = persisted.chains.find((candidate) => candidate.id === persisted.activeChainId);
    if (!chain) return this.transition(projectId, { state: 'blocked', enabled: true, error: 'Select an active proxy chain', mixedPort: null });
    const diagnostic = await this.diagnoseRuntime();
    if (!diagnostic.supported || !diagnostic.configuredPath) {
      return this.transition(projectId, { state: 'blocked', enabled: true, error: diagnostic.error, mixedPort: null,
        activeChainId: chain.id, activeChainName: chain.name });
    }
    await this.stopOtherRuntimes(projectId);
    if (this.runtimes.has(projectId)) return this.reload(projectId, chain);
    this.transition(projectId, { state: 'starting', enabled: true, activeChainId: chain.id, activeChainName: chain.name, error: null });
    let configPath: string | null = null;
    try {
      const { mixedPort, controllerPort } = await this.projectPorts(projectId);
      const secret = randomBytes(32).toString('base64url');
      const nodes = await egressProxyVault.readNodes(chain.nodeIds);
      const compiled = compileMihomoConfig(chain, nodes, { mixedPort, controllerPort, secret });
      const candidate = await this.validateConfig(diagnostic.configuredPath, compiled.config);
      try {
        configPath = path.join(runtimeDirectory(), `${projectId}-${randomUUID()}.yaml`);
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.copyFileSync(candidate, configPath);
        fs.chmodSync(configPath, 0o600);
      } finally {
        removeFile(candidate);
      }
      const child = spawn(diagnostic.configuredPath, ['-d', runtimeDirectory(), '-f', configPath], { windowsHide: true, stdio: 'ignore' });
      const runtime: ProjectRuntime = {
        projectId, process: child, mixedPort, controllerPort, secret, configPath,
        expectedStop: false, latencyProbeRevision: 0,
      };
      this.runtimes.set(projectId, runtime);
      child.once('exit', (code, signal) => this.onRuntimeExit(runtime, code, signal));
      await waitForController(runtime, 10_000);
      const udpReady = compiled.udpReady && await this.liveUdpReady(runtime, compiled.internalNames);
      this.transition(projectId, {
        state: 'ready', enabled: true, mixedPort, activeChainId: chain.id, activeChainName: chain.name,
        tcpReady: compiled.tcpReady, udpReady, error: null,
        chainLatencyMs: null, latencyCheckedAt: null, nodeLatencyMs: {},
      });
      await Promise.all([
        this.refreshExit(projectId),
        this.refreshActiveChainLatency(projectId, runtime, chain, compiled.internalNames),
      ]);
      return this.status(projectId, false);
    } catch (error) {
      if (configPath) removeFile(configPath);
      const runtime = this.runtimes.get(projectId);
      if (runtime) { runtime.expectedStop = true; runtime.process.kill(); this.runtimes.delete(projectId); }
      await this.closeManagedConnections(projectId, 'Project proxy failed before the operation completed');
      return this.transition(projectId, { state: 'error', enabled: true, mixedPort: null, error: errorMessage(error),
        activeChainId: chain.id, activeChainName: chain.name });
    }
  }

  private async reload(projectId: string, chain: EgressProxyChain) {
    const runtime = this.runtimes.get(projectId);
    if (!runtime) return this.start(projectId);
    const diagnostic = await this.diagnoseRuntime();
    if (!diagnostic.supported || !diagnostic.configuredPath) throw new Error(diagnostic.error || 'Mihomo runtime is unavailable');
    const nodes = await egressProxyVault.readNodes(chain.nodeIds);
    const compiled = compileMihomoConfig(chain, nodes, runtime);
    const candidate = await this.validateConfig(diagnostic.configuredPath, compiled.config);
    runtime.latencyProbeRevision += 1;
    try {
      await requestMihomoController(runtime, 'PUT', '/configs?force=true', { path: candidate });
    } finally {
      removeFile(candidate);
    }
    await requestMihomoController(runtime, 'DELETE', '/connections').catch(() => undefined);
    await this.closeManagedConnections(projectId, 'Proxy chain changed before the operation completed');
    const udpReady = compiled.udpReady && await this.liveUdpReady(runtime, compiled.internalNames);
    this.transition(projectId, {
      state: 'ready', enabled: true, mixedPort: runtime.mixedPort, activeChainId: chain.id,
      activeChainName: chain.name, tcpReady: compiled.tcpReady, udpReady,
      exitIp: null, lastCheckedAt: null, error: null,
      chainLatencyMs: null, latencyCheckedAt: null, nodeLatencyMs: {},
    });
    await Promise.all([
      this.refreshExit(projectId),
      this.refreshActiveChainLatency(projectId, runtime, chain, compiled.internalNames),
    ]);
    return this.status(projectId, false);
  }

  private async preflightChain(projectId: string, chain: EgressProxyChain) {
    const diagnostic = await this.diagnoseRuntime();
    if (!diagnostic.supported || !diagnostic.configuredPath) throw new Error(diagnostic.error || 'Mihomo runtime is unavailable');
    const runtime = this.runtimes.get(projectId);
    const ports = runtime ?? { ...await allocateLoopbackPortPair(), secret: randomBytes(32).toString('base64url') };
    const nodes = await egressProxyVault.readNodes(chain.nodeIds);
    const compiled = compileMihomoConfig(chain, nodes, ports);
    const candidate = await this.validateConfig(diagnostic.configuredPath, compiled.config);
    removeFile(candidate);
    return compiled;
  }

  private async validateConfig(executable: string, config: Record<string, unknown>, directory = runtimeDirectory()) {
    this.prepareRuntimeDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const candidate = path.join(directory, `candidate-${randomUUID()}.yaml`);
    fs.writeFileSync(candidate, stringify(config), { encoding: 'utf8', mode: 0o600 });
    try {
      await runChild(executable, ['-d', directory, '-t', '-f', candidate], 10_000);
      return candidate;
    } catch (error) {
      removeFile(candidate);
      throw error;
    }
  }

  private requireChain(projectId: string, chainId: string) {
    const chain = sessionService.getProjectState(projectId).proxy.chains.find((candidate) => candidate.id === chainId);
    if (!chain) throw new Error('Proxy chain is missing');
    return chain;
  }

  private async controllerDelay(runtime: ProjectRuntime, internalName: string) {
    const result = await requestMihomoController(runtime, 'GET', `/proxies/${encodeURIComponent(internalName)}/delay?timeout=5000&url=${encodeURIComponent('https://www.gstatic.com/generate_204')}`) as { delay?: unknown };
    if (typeof result?.delay !== 'number') throw new Error('Proxy delay is unavailable');
    return result.delay;
  }

  private async refreshActiveChainLatency(
    projectId: string,
    runtime: ProjectRuntime,
    chain: EgressProxyChain,
    internalNames: string[],
  ) {
    const probeRevision = ++runtime.latencyProbeRevision;
    const checkedAt = new Date().toISOString();
    const latencies = await Promise.all(internalNames.map((name) => this.controllerDelay(runtime, name).catch(() => null)));
    const nodeLatencyMs = Object.fromEntries(chain.nodeIds.map((nodeId, index) => [nodeId, latencies[index] ?? null]));
    const latencyMs = latencies.at(-1) ?? null;
    const persisted = safeProjectProxy(projectId);
    if (this.runtimes.get(projectId) === runtime
      && runtime.latencyProbeRevision === probeRevision
      && persisted.activeChainId === chain.id) {
      this.transition(projectId, { chainLatencyMs: latencyMs, latencyCheckedAt: checkedAt, nodeLatencyMs });
    }
    return { latencyMs, checkedAt, nodeLatencyMs };
  }

  private async liveUdpReady(runtime: ProjectRuntime, internalNames: string[]) {
    try {
      const response = await requestMihomoController(runtime, 'GET', '/proxies') as { proxies?: Record<string, Record<string, unknown>> };
      return internalNames.every((name) => {
        const proxy = response.proxies?.[name];
        return proxy?.udp === true || proxy?.uot === true || proxy?.xudp === true;
      });
    } catch {
      return false;
    }
  }

  private onRuntimeExit(runtime: ProjectRuntime, code: number | null, signal: NodeJS.Signals | null) {
    if (this.runtimes.get(runtime.projectId) !== runtime) return;
    this.runtimes.delete(runtime.projectId);
    removeFile(runtime.configPath);
    if (!runtime.expectedStop) {
      this.transition(runtime.projectId, {
        state: 'error', enabled: true, mixedPort: null,
        error: `Mihomo exited unexpectedly (${code ?? signal ?? 'unknown'})`,
      });
      void this.closeManagedConnections(runtime.projectId, 'Mihomo exited before the operation completed');
    }
  }

  private async reloadAffectedRuntimes(nodeId: string) {
    for (const projectId of [...this.runtimes.keys()]) {
      const state = sessionService.getProjectState(projectId).proxy;
      const chain = state.chains.find((candidate) => candidate.id === state.activeChainId);
      if (!chain?.nodeIds.includes(nodeId)) continue;
      try { await this.reload(projectId, chain); }
      catch (error) { await this.failClosed(projectId, errorMessage(error)); }
    }
  }

  private async projectPorts(projectId: string) {
    const existing = this.portAssignments.get(projectId);
    if (existing) {
      await assertLoopbackPortAvailable(existing.mixedPort);
      await assertLoopbackPortAvailable(existing.controllerPort);
      return existing;
    }
    const assigned = await allocateLoopbackPortPair();
    this.portAssignments.set(projectId, assigned);
    return assigned;
  }

  private async stopOtherRuntimes(projectId: string) {
    for (const other of [...this.runtimes.keys()]) {
      if (other !== projectId) await this.stop(other, false);
    }
  }

  private async failClosed(projectId: string, message: string) {
    const runtime = this.runtimes.get(projectId);
    if (runtime) {
      runtime.expectedStop = true;
      this.runtimes.delete(projectId);
      runtime.process.kill();
      removeFile(runtime.configPath);
    }
    await this.closeManagedConnections(projectId, message);
    return this.transition(projectId, { state: 'blocked', enabled: true, mixedPort: null, error: message });
  }

  private async closeManagedConnections(projectId: string, reason: string) {
    await browserService.closeProjectConnections(projectId).catch(() => undefined);
    try { shellService.disconnectProjectSessions(projectId); } catch { /* teardown is best effort */ }
    trafficService.interruptProjectFlows(projectId, reason);
  }

  private prepareRuntimeDirectory() {
    if (this.runtimeDirectoryPrepared) return;
    this.runtimeDirectoryPrepared = true;
    const directory = runtimeDirectory();
    fs.mkdirSync(directory, { recursive: true });
    for (const entry of fs.readdirSync(directory)) {
      if (entry.endsWith('.yaml')) removeFile(path.join(directory, entry));
    }
  }

  private transition(projectId: string, patch: Partial<EgressProxyStatusSnapshot>) {
    const persisted = safeProjectProxy(projectId);
    const previous = this.snapshots.get(projectId);
    const next: EgressProxyStatusSnapshot = {
      state: 'off',
      enabled: persisted.enabled,
      activeChainId: persisted.activeChainId,
      activeChainName: persisted.chains.find((chain) => chain.id === persisted.activeChainId)?.name ?? null,
      mixedPort: null,
      tcpReady: false,
      udpReady: false,
      exitIp: null,
      lastCheckedAt: null,
      error: null,
      chainLatencyMs: null,
      latencyCheckedAt: null,
      nodeLatencyMs: {},
      ...previous,
      ...patch,
      projectId,
      revision: (previous?.revision ?? 0) + 1,
    };
    if (next.state === 'off') {
      next.tcpReady = false;
      next.udpReady = false;
      next.chainLatencyMs = null;
      next.latencyCheckedAt = null;
      next.nodeLatencyMs = {};
    } else if (next.state === 'starting' || next.state === 'blocked' || next.state === 'error') {
      next.tcpReady = false;
      next.udpReady = false;
      next.exitIp = null;
      next.lastCheckedAt = null;
      next.chainLatencyMs = null;
      next.latencyCheckedAt = null;
      next.nodeLatencyMs = {};
    }
    this.snapshots.set(projectId, next);
    publishProjectEgressRoute(next.enabled
      ? next.mixedPort && (next.state === 'ready' || next.state === 'degraded')
        ? { mode: 'proxy', projectId, revision: next.revision, mixedPort: next.mixedPort }
        : { mode: 'blocked', projectId, revision: next.revision, error: next.error }
      : { mode: 'direct', projectId, revision: next.revision });
    this.broadcast(next);
    return { ...next, nodeLatencyMs: { ...next.nodeLatencyMs } };
  }

  private broadcast(snapshot: EgressProxyStatusSnapshot) {
    const sent = new Set<number>();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) { window.webContents.send(EGRESS_PROXY_IPC.CHANGED, snapshot); sent.add(window.webContents.id); }
    }
    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed() && !sent.has(contents.id)) contents.send(EGRESS_PROXY_IPC.CHANGED, snapshot);
    }
  }

  private enqueue<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.operations.get(projectId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(operation);
    this.operations.set(projectId, next);
    void next.then(
      () => { if (this.operations.get(projectId) === next) this.operations.delete(projectId); },
      () => { if (this.operations.get(projectId) === next) this.operations.delete(projectId); },
    );
    return next;
  }
}

async function waitForController(runtime: ProjectRuntime, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { await requestMihomoController(runtime, 'GET', '/version'); return; }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`Mihomo controller did not become ready: ${errorMessage(lastError)}`);
}

function fetchProxiedExitIp(mixedPort: number): Promise<string> {
  return openHttpConnectTunnel(mixedPort, 'api.ipify.org', 443, 8_000)
    .then((socket) => requestExitIp(tls.connect({ socket, servername: 'api.ipify.org' })));
}

async function resolveDirectExitIp(): Promise<string> {
  const ip = await shellService.detectPublicIp();
  if (!ip || !net.isIP(ip)) throw new Error('Direct exit IP is unavailable');
  return ip;
}

function requestExitIp(secure: tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    secure.setTimeout(8_000, () => secure.destroy(new Error('Exit IP request timed out')));
    secure.once('secureConnect', () => secure.write('GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n'));
    secure.on('data', (chunk) => {
      total += chunk.length;
      if (total > 64 * 1024) {
        secure.destroy(new Error('Exit IP response is too large'));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    secure.once('error', reject);
    secure.once('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text.slice(text.indexOf('\r\n\r\n') + 4);
      try {
        const ip = (JSON.parse(body) as { ip?: unknown }).ip;
        if (typeof ip !== 'string' || !net.isIP(ip)) throw new Error('Invalid exit IP response');
        resolve(ip);
      } catch (error) { reject(error); }
    });
  });
}

function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function allocateLoopbackPortPair() {
  const mixedPort = await allocateLoopbackPort();
  let controllerPort = await allocateLoopbackPort();
  while (controllerPort === mixedPort) controllerPort = await allocateLoopbackPort();
  return { mixedPort, controllerPort };
}

function assertLoopbackPortAvailable(port: number) {
  return new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Stable Mihomo port ${port} is already in use`)));
    server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()));
  });
}

function runChild(executable: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error('Mihomo command timed out')); }, timeoutMs);
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8').trim();
      if (code === 0) resolve(output);
      else reject(new Error(output || `Mihomo exited with code ${code ?? 'unknown'}`));
    });
  });
}

function runtimeDirectory() {
  const base = app.isReady() ? app.getPath('userData') : os.tmpdir();
  return path.join(base, 'mihomo-runtime');
}

function nodeProbeDirectory() {
  return path.join(runtimeDirectory(), 'node-probe');
}

function safeProjectProxy(projectId: string) {
  try { return sessionService.getProjectState(projectId).proxy; }
  catch { return { enabled: false, activeChainId: null, chains: [] as EgressProxyChain[] }; }
}

function removeFile(filePath: string) {
  try { fs.rmSync(filePath, { force: true }); } catch { /* best effort */ }
}

function assertProjectId(value: string) {
  if (!/^[a-zA-Z0-9-]{1,200}$/.test(value)) throw new Error('Invalid project identifier');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const egressProxyService = new EgressProxyService();
