import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import type { EgressProxyNodeInput, EgressProxyNodeSummary } from '../contracts/egress-proxy';
import {
  normalizeEgressNodeInput,
  normalizeEgressUriBatch,
  summarizeEgressNode,
  type NormalizedEgressNode,
} from './egress-proxy-contract';

interface StoredNode extends EgressProxyNodeSummary {
  encrypted: string;
}

interface VaultFile {
  version: 1;
  nodes: StoredNode[];
}

export class EgressProxyVault {
  private queue: Promise<unknown> = Promise.resolve();

  list(): EgressProxyNodeSummary[] {
    return this.readFile().nodes.map(publicNode);
  }

  async save(input: EgressProxyNodeInput, nodeId?: string): Promise<EgressProxyNodeSummary> {
    const normalized = normalizeEgressNodeInput(input, nodeId);
    await this.requireEncryption();
    return this.enqueue(async () => {
      const vault = this.readFile();
      const existing = nodeId ? vault.nodes.find((node) => node.id === nodeId) : undefined;
      if (nodeId && !existing) throw new Error('Proxy node is missing');
      const encrypted = (await safeStorage.encryptStringAsync(JSON.stringify(normalized))).toString('base64');
      const stored: StoredNode = { ...summarizeEgressNode(normalized), encrypted };
      this.writeFile({ version: 1, nodes: [...vault.nodes.filter((node) => node.id !== stored.id), stored] });
      return publicNode(stored);
    });
  }

  async importUriBatch(value: string): Promise<EgressProxyNodeSummary[]> {
    const normalizedNodes = normalizeEgressUriBatch(value);
    await this.requireEncryption();
    return this.enqueue(async () => {
      const vault = this.readFile();
      const storedNodes: StoredNode[] = [];
      for (const normalized of normalizedNodes) {
        const encrypted = (await safeStorage.encryptStringAsync(JSON.stringify(normalized))).toString('base64');
        storedNodes.push({ ...summarizeEgressNode(normalized), encrypted });
      }
      this.writeFile({ version: 1, nodes: [...vault.nodes, ...storedNodes] });
      return storedNodes.map(publicNode);
    });
  }

  async readNodes(nodeIds?: string[]): Promise<NormalizedEgressNode[]> {
    await this.requireEncryption();
    const wanted = nodeIds ? new Set(nodeIds) : null;
    const records = this.readFile().nodes.filter((node) => !wanted || wanted.has(node.id));
    const nodes: NormalizedEgressNode[] = [];
    for (const record of records) {
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(record.encrypted, 'base64'));
      const parsed = normalizeDecryptedNode(decrypted.result, record.id);
      nodes.push(parsed);
      if (decrypted.shouldReEncrypt) await this.save({ source: 'form', name: parsed.name, value: parsed.proxy }, parsed.id);
    }
    return nodes;
  }

  async delete(nodeId: string) {
    return this.enqueue(async () => {
      const vault = this.readFile();
      const nodes = vault.nodes.filter((node) => node.id !== nodeId);
      if (nodes.length === vault.nodes.length) return false;
      this.writeFile({ version: 1, nodes });
      return true;
    });
  }

  private async requireEncryption() {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('OS credential encryption is unavailable');
  }

  private vaultPath() {
    return path.join(app.getPath('userData'), 'egress-proxy-vault.json');
  }

  private readFile(): VaultFile {
    const filePath = this.vaultPath();
    if (!fs.existsSync(filePath)) return { version: 1, nodes: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.nodes)) throw new Error('Invalid vault format');
      return { version: 1, nodes: parsed.nodes.flatMap(normalizeStoredNode) };
    } catch (error) {
      throw new Error(`Unable to read proxy node vault: ${errorMessage(error)}`);
    }
  }

  private writeFile(vault: VaultFile) {
    const filePath = this.vaultPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(vault, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, filePath);
    } finally {
      try { fs.rmSync(temporary, { force: true }); } catch { /* preserve the original write error */ }
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(operation);
    this.queue = next;
    return next;
  }
}

function normalizeStoredNode(value: unknown): StoredNode[] {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return [];
  if (!isProtocol(value.protocol) || typeof value.encrypted !== 'string') return [];
  return [{
    id: value.id,
    name: value.name.slice(0, 100),
    protocol: value.protocol,
    tcp: value.tcp === true,
    udp: value.udp === true,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    encrypted: value.encrypted,
  }];
}

function normalizeDecryptedNode(value: string, expectedId: string): NormalizedEgressNode {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed) || parsed.id !== expectedId || !isRecord(parsed.proxy)) throw new Error('Invalid encrypted proxy node');
  return normalizeEgressNodeInput({
    source: 'form',
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    value: parsed.proxy,
  }, expectedId);
}

function publicNode(node: StoredNode): EgressProxyNodeSummary {
  const { encrypted: _encrypted, ...summary } = node;
  return summary;
}

function isProtocol(value: unknown): value is EgressProxyNodeSummary['protocol'] {
  return value === 'http' || value === 'https' || value === 'socks5'
    || value === 'ss' || value === 'vmess' || value === 'vless' || value === 'trojan'
    || value === 'hysteria2' || value === 'tuic';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const egressProxyVault = new EgressProxyVault();
