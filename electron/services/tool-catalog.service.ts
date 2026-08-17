import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  tacticIds: string[];
  techniqueIds: string[];
  risk: 'passive' | 'active' | 'destructive';
  channel: 'agent-runtime' | 'electron' | 'mcp' | 'docker';
  executable?: string;
  installHint?: string;
  builtin?: boolean;
  disabled?: boolean;
  available?: boolean;
  version?: string;
  checkedAt?: string;
}

const BUILTIN_TOOLS: ToolDefinition[] = [
  { id: 'nmap', name: 'nmap', description: 'Port and service discovery', capabilities: ['port-scanning', 'service-fingerprinting'], tacticIds: ['TA0043', 'TA0007'], techniqueIds: ['T1595.001', 'T1595.002', 'T1046'], risk: 'active', channel: 'agent-runtime', executable: 'nmap', installHint: 'Install nmap in the configured local Agent Runtime.', builtin: true },
  { id: 'whois', name: 'whois', description: 'Domain registration lookup', capabilities: ['domain-enumeration'], tacticIds: ['TA0043'], techniqueIds: ['T1590.001'], risk: 'passive', channel: 'agent-runtime', executable: 'whois', builtin: true },
  { id: 'dig', name: 'dig', description: 'DNS record lookup', capabilities: ['dns-enumeration'], tacticIds: ['TA0043'], techniqueIds: ['T1590.002'], risk: 'passive', channel: 'agent-runtime', executable: 'dig', builtin: true },
  { id: 'httpx', name: 'httpx', description: 'HTTP service probing', capabilities: ['http-probing', 'service-fingerprinting'], tacticIds: ['TA0043'], techniqueIds: ['T1595.001'], risk: 'active', channel: 'agent-runtime', executable: 'httpx', builtin: true },
  { id: 'nuclei', name: 'nuclei', description: 'Template-based vulnerability scanning', capabilities: ['vulnerability-scanning'], tacticIds: ['TA0043'], techniqueIds: ['T1595.002'], risk: 'active', channel: 'agent-runtime', executable: 'nuclei', builtin: true },
  { id: 'redteam-mcp', name: 'redteam MCP', description: 'Configured red-team MCP service', capabilities: ['web-scanning', 'host-scanning'], tacticIds: ['TA0043', 'TA0001'], techniqueIds: ['T1595', 'T1190'], risk: 'active', channel: 'mcp', builtin: true },
];

export function defaultToolCatalog(): ToolDefinition[] { return BUILTIN_TOOLS.map((tool) => ({ ...tool, capabilities: [...tool.capabilities], tacticIds: [...tool.tacticIds], techniqueIds: [...tool.techniqueIds] })); }

export function loadToolCatalog(userDataPath: string): ToolDefinition[] {
  const builtins = defaultToolCatalog();
  const filePath = path.join(userDataPath, 'tools.yaml');
  if (!fs.existsSync(filePath)) return builtins;
  try {
    const parsed = YAML.parse(fs.readFileSync(filePath, 'utf8'));
    const custom = Array.isArray(parsed?.tools) ? parsed.tools : [];
    const seen = new Set(builtins.map((tool) => tool.id));
    for (const raw of custom) {
      if (!raw || typeof raw.id !== 'string' || seen.has(raw.id)) continue;
      seen.add(raw.id);
      builtins.push(normalizeTool(raw));
    }
  } catch { /* malformed user catalog is ignored until settings shows diagnostics */ }
  return builtins;
}

export function saveToolCatalog(userDataPath: string, tools: ToolDefinition[]) {
  fs.mkdirSync(userDataPath, { recursive: true });
  const custom = tools.filter((tool) => !tool.builtin).map(({ builtin: _builtin, ...tool }) => tool);
  fs.writeFileSync(path.join(userDataPath, 'tools.yaml'), YAML.stringify({ tools: custom }), 'utf8');
}

export function upsertTool(userDataPath: string, raw: ToolDefinition): ToolDefinition[] {
  if (!raw.id.trim()) throw new Error('Tool id is required');
  if (BUILTIN_TOOLS.some((tool) => tool.id === raw.id)) throw new Error('Built-in tools are read-only');
  const tools = loadToolCatalog(userDataPath).filter((tool) => tool.builtin || tool.id !== raw.id);
  tools.push({ ...normalizeTool(raw as unknown as Record<string, unknown>), builtin: false });
  saveToolCatalog(userDataPath, tools);
  return loadToolCatalog(userDataPath);
}

export function deleteTool(userDataPath: string, toolId: string): ToolDefinition[] {
  if (BUILTIN_TOOLS.some((tool) => tool.id === toolId)) throw new Error('Built-in tools are read-only');
  const tools = loadToolCatalog(userDataPath);
  saveToolCatalog(userDataPath, tools.filter((tool) => tool.id !== toolId));
  return loadToolCatalog(userDataPath);
}

export async function probeToolCatalog(userDataPath: string): Promise<ToolDefinition[]> {
  const tools = loadToolCatalog(userDataPath);
  const probed = await Promise.all(tools.map(async (tool) => {
    if (tool.channel !== 'agent-runtime' || !tool.executable || tool.disabled) {
      return { ...tool, available: tool.disabled ? false : tool.available, checkedAt: new Date().toISOString() };
    }
    try {
      const result = await execFileAsync(tool.executable, ['--version'], { timeout: 5_000, windowsHide: true, maxBuffer: 64 * 1024 });
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
      return { ...tool, available: true, version: output.split(/\r?\n/)[0]?.slice(0, 300), checkedAt: new Date().toISOString() };
    } catch {
      return { ...tool, available: false, checkedAt: new Date().toISOString() };
    }
  }));
  return probed;
}

export function normalizeTool(raw: Record<string, unknown>): ToolDefinition {
  const risk = raw.risk === 'passive' || raw.risk === 'destructive' ? raw.risk : 'active';
  const channel = raw.channel === 'electron' || raw.channel === 'mcp' || raw.channel === 'docker' ? raw.channel : 'agent-runtime';
  return {
    id: String(raw.id).trim(), name: typeof raw.name === 'string' ? raw.name : String(raw.id),
    description: typeof raw.description === 'string' ? raw.description : '',
    capabilities: stringArray(raw.capabilities), tacticIds: stringArray(raw.tacticIds), techniqueIds: stringArray(raw.techniqueIds),
    risk, channel, executable: stringValue(raw.executable), installHint: stringValue(raw.installHint),
    disabled: raw.disabled === true, available: raw.available === true, version: stringValue(raw.version), checkedAt: stringValue(raw.checkedAt),
  };
}

function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []; }
function stringValue(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
