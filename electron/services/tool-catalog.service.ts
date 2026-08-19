import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { ATTACK_TACTICS, ATTACK_TECHNIQUES } from '../contracts/attack-catalog-data';
import {
  TOOL_CATALOG_VERSION,
  TOOL_CHANNELS,
  TOOL_RISKS,
  type ToolCatalogDocument,
  type ToolCatalogDocumentResult,
  type ToolCatalogCandidate,
  type ToolCatalogMutableFields,
  type ToolCatalogRecord,
} from '../contracts/tool-catalog';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const TACTIC_IDS = new Set<string>(ATTACK_TACTICS.map((entry) => entry.id));
const TECHNIQUE_IDS = new Set<string>(ATTACK_TECHNIQUES.map((entry) => entry.id));
const RISK_VALUES = new Set<string>(TOOL_RISKS);
const CHANNEL_VALUES = new Set<string>(TOOL_CHANNELS);

function emptyDocument(): ToolCatalogDocument {
  return { version: TOOL_CATALOG_VERSION, tools: [] };
}

export function toolCatalogPath(globalUserPath: string) {
  return path.join(globalUserPath, 'tools.yaml');
}

function markerPath(globalUserPath: string) {
  return path.join(globalUserPath, 'seeded-tools.json');
}

function defaultCatalogCandidates() {
  return [
    process.resourcesPath ? path.join(process.resourcesPath, 'default-user', 'tools.yaml') : null,
    path.resolve(__dirname, '../../resources/default-user/tools.yaml'),
    path.resolve(process.cwd(), 'resources/default-user/tools.yaml'),
  ];
}

function readYaml(filePath: string): { raw?: unknown; diagnostics: string[] } {
  try {
    return { raw: YAML.parse(fs.readFileSync(filePath, 'utf8')), diagnostics: [] };
  } catch (error) {
    return { diagnostics: [`Invalid tools YAML: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

export function validateToolCatalogDocument(raw: unknown): { document: ToolCatalogDocument; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { document: emptyDocument(), diagnostics: ['Tool catalog must be an object'] };
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== TOOL_CATALOG_VERSION) diagnostics.push('Tool catalog version must be 1');
  if (!Array.isArray(value.tools)) diagnostics.push('Tool catalog tools must be an array');
  const tools: ToolCatalogRecord[] = [];
  const ids = new Set<string>();
  if (Array.isArray(value.tools)) {
    value.tools.forEach((entry, index) => {
      const result = validateTool(entry, index);
      diagnostics.push(...result.diagnostics);
      if (!result.tool) return;
      if (ids.has(result.tool.id)) diagnostics.push(`Duplicate tool id ${result.tool.id}`);
      ids.add(result.tool.id);
      tools.push(result.tool);
    });
  }
  return { document: { version: TOOL_CATALOG_VERSION, tools }, diagnostics };
}

function validateTool(raw: unknown, index: number): { tool?: ToolCatalogRecord; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const label = `Tool at index ${index}`;
  if (!raw || typeof raw !== 'object') return { diagnostics: [`${label} must be an object`] };
  const value = raw as Record<string, unknown>;
  const id = stringField(value.id);
  const name = stringField(value.name);
  const description = stringField(value.description);
  if (!id) diagnostics.push(`${label} id is required`);
  else if (!ID_PATTERN.test(id)) diagnostics.push(`Tool id ${id} must be a lowercase stable identifier`);
  if (!name) diagnostics.push(`${label} name is required`);
  if (!description) diagnostics.push(`${label} description is required`);
  if (value.enabled !== true && value.enabled !== false) diagnostics.push(`${label} enabled must be a boolean`);
  if (!RISK_VALUES.has(String(value.risk))) diagnostics.push(`${label} risk must be passive, active, or destructive`);
  if (!CHANNEL_VALUES.has(String(value.channel))) diagnostics.push(`${label} channel is invalid`);

  const capabilities = normalizedArray(value.capabilities, 'capabilities', label, diagnostics, (item) => CAPABILITY_PATTERN.test(item), (item) => item.toLowerCase());
  const tacticIds = normalizedArray(value.tacticIds, 'tacticIds', label, diagnostics, (item) => TACTIC_IDS.has(item), (item) => item.toUpperCase());
  const techniqueIds = normalizedArray(value.techniqueIds, 'techniqueIds', label, diagnostics, (item) => TECHNIQUE_IDS.has(item), (item) => item.toUpperCase());
  const command = optionalString(value.command, 'command', label, diagnostics);
  const usage = optionalString(value.usage, 'usage', label, diagnostics);
  if (diagnostics.length || !id || !name || !description) return { diagnostics };
  return {
    diagnostics,
    tool: {
      id,
      name,
      description,
      enabled: value.enabled === true,
      capabilities,
      tacticIds,
      techniqueIds,
      risk: value.risk as ToolCatalogRecord['risk'],
      channel: value.channel as ToolCatalogRecord['channel'],
      ...(command ? { command } : {}),
      ...(usage ? { usage } : {}),
    },
  };
}

function normalizedArray(
  raw: unknown,
  field: string,
  label: string,
  diagnostics: string[],
  valid: (item: string) => boolean,
  transform: (item: string) => string,
) {
  if (!Array.isArray(raw)) {
    diagnostics.push(`${label} ${field} must be an array`);
    return [];
  }
  const values: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !entry.trim()) {
      diagnostics.push(`${label} ${field} must contain non-empty strings`);
      continue;
    }
    const value = transform(entry.trim());
    if (!valid(value)) diagnostics.push(`${label} ${field} contains invalid value ${value}`);
    else if (!values.includes(value)) values.push(value);
  }
  return values;
}

function optionalString(raw: unknown, field: string, label: string, diagnostics: string[]) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') {
    diagnostics.push(`${label} ${field} must be a string`);
    return undefined;
  }
  return raw.trim() || undefined;
}

function stringField(raw: unknown) {
  return typeof raw === 'string' ? raw.trim() : '';
}

function canonicalYaml(document: ToolCatalogDocument) {
  return YAML.stringify(document, { indent: 2, lineWidth: 0 });
}

export function writeToolCatalogDocument(filePath: string, document: ToolCatalogDocument) {
  const validation = validateToolCatalogDocument(document);
  if (validation.diagnostics.length) throw new Error(validation.diagnostics.join('; '));
  writeTextAtomic(filePath, canonicalYaml(validation.document));
}

function writeTextAtomic(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, content, 'utf8');
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* best effort cleanup */ }
    throw error;
  }
}

function writeSeedMarker(globalUserPath: string) {
  writeTextAtomic(markerPath(globalUserPath), `${JSON.stringify({ version: 1 }, null, 2)}\n`);
}

function readValidatedDocument(filePath: string): ToolCatalogDocumentResult {
  if (!fs.existsSync(filePath)) return { path: filePath, exists: false, document: emptyDocument(), diagnostics: [] };
  const parsed = readYaml(filePath);
  if (parsed.diagnostics.length) return { path: filePath, exists: true, document: emptyDocument(), diagnostics: parsed.diagnostics };
  const validated = validateToolCatalogDocument(parsed.raw);
  return { path: filePath, exists: true, ...validated };
}

function loadDefaultDocument(): { document: ToolCatalogDocument; diagnostics: string[] } {
  const source = defaultCatalogCandidates().find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)));
  if (!source) return { document: emptyDocument(), diagnostics: ['Default tool catalog was not found'] };
  const parsed = readYaml(source);
  if (parsed.diagnostics.length) return { document: emptyDocument(), diagnostics: parsed.diagnostics.map((entry) => `Default tool catalog: ${entry}`) };
  const validated = validateToolCatalogDocument(parsed.raw);
  return { document: validated.document, diagnostics: validated.diagnostics.map((entry) => `Default tool catalog: ${entry}`) };
}

function legacyDocument(raw: unknown): { document: ToolCatalogDocument; diagnostics: string[] } {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>).tools)) {
    return { document: emptyDocument(), diagnostics: ['Legacy tool catalog tools must be an array'] };
  }
  const tools = ((raw as Record<string, unknown>).tools as unknown[]).map((entry) => {
    const value = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    return {
      id: value.id,
      name: value.name,
      description: value.description,
      enabled: value.enabled === true || value.disabled !== true,
      capabilities: value.capabilities ?? [],
      tacticIds: value.tacticIds ?? [],
      techniqueIds: value.techniqueIds ?? [],
      risk: value.risk,
      channel: value.channel,
      command: value.command ?? value.executable,
      usage: value.usage ?? value.installHint,
    };
  });
  return validateToolCatalogDocument({ version: TOOL_CATALOG_VERSION, tools });
}

function ensureToolCatalog(globalUserPath: string): ToolCatalogDocumentResult {
  const target = toolCatalogPath(globalUserPath);
  if (fs.existsSync(markerPath(globalUserPath))) return readValidatedDocument(target);
  if (!fs.existsSync(target)) {
    const defaults = loadDefaultDocument();
    if (defaults.diagnostics.length) return { path: target, exists: false, ...defaults };
    writeToolCatalogDocument(target, defaults.document);
    writeSeedMarker(globalUserPath);
    return readValidatedDocument(target);
  }

  const parsed = readYaml(target);
  if (parsed.diagnostics.length) return { path: target, exists: true, document: emptyDocument(), diagnostics: parsed.diagnostics };
  if ((parsed.raw as Record<string, unknown> | null)?.version === TOOL_CATALOG_VERSION) {
    const current = readValidatedDocument(target);
    if (!current.diagnostics.length) writeSeedMarker(globalUserPath);
    return current;
  }

  const defaults = loadDefaultDocument();
  const legacy = legacyDocument(parsed.raw);
  const diagnostics = [...defaults.diagnostics, ...legacy.diagnostics];
  if (diagnostics.length) return { path: target, exists: true, document: emptyDocument(), diagnostics };
  const defaultIds = new Set(defaults.document.tools.map((tool) => tool.id));
  const document: ToolCatalogDocument = {
    version: TOOL_CATALOG_VERSION,
    tools: [...defaults.document.tools, ...legacy.document.tools.filter((tool) => !defaultIds.has(tool.id))],
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(target, path.join(globalUserPath, `tools.pre-v1-${stamp}.yaml`));
  writeToolCatalogDocument(target, document);
  writeSeedMarker(globalUserPath);
  return readValidatedDocument(target);
}

export function readToolCatalog(globalUserPath: string) {
  return ensureToolCatalog(globalUserPath);
}

export function listEnabledToolCatalog(globalUserPath: string) {
  const result = ensureToolCatalog(globalUserPath);
  return result.diagnostics.length ? [] : result.document.tools.filter((tool) => tool.enabled);
}

export function resolveToolCatalogCandidates(
  tools: readonly ToolCatalogRecord[],
  input: { preferredToolIds: readonly string[]; requiredCapabilities: readonly string[]; techniqueIds: readonly string[] },
): ToolCatalogCandidate[] {
  return tools.filter((tool) => tool.enabled).flatMap((tool) => {
    const preferred = input.preferredToolIds.includes(tool.id);
    const matchedBy = [
      ...(preferred ? ['preferred'] : []),
      ...tool.capabilities.filter((capability) => input.requiredCapabilities.includes(capability)).map((capability) => `capability:${capability}`),
      ...tool.techniqueIds.filter((id) => input.techniqueIds.includes(id)).map((id) => `technique:${id}`),
    ];
    return matchedBy.length ? [{ ...tool, preferred, matchedBy }] : [];
  });
}

function readEditable(globalUserPath: string) {
  const result = ensureToolCatalog(globalUserPath);
  if (result.diagnostics.length) throw new Error(result.diagnostics.join('; '));
  return result.document;
}

export function createTool(globalUserPath: string, tool: ToolCatalogRecord) {
  const document = readEditable(globalUserPath);
  if (document.tools.some((entry) => entry.id === tool.id)) throw new Error(`Tool id ${tool.id} already exists`);
  writeToolCatalogDocument(toolCatalogPath(globalUserPath), { version: TOOL_CATALOG_VERSION, tools: [...document.tools, tool] });
  return readValidatedDocument(toolCatalogPath(globalUserPath));
}

export function updateTool(globalUserPath: string, id: string, fields: ToolCatalogMutableFields) {
  const document = readEditable(globalUserPath);
  const index = document.tools.findIndex((tool) => tool.id === id);
  if (index < 0) throw new Error(`Tool ${id} does not exist`);
  const tools = document.tools.map((tool, toolIndex) => toolIndex === index ? { id, ...fields } : tool);
  writeToolCatalogDocument(toolCatalogPath(globalUserPath), { version: TOOL_CATALOG_VERSION, tools });
  return readValidatedDocument(toolCatalogPath(globalUserPath));
}

export function deleteTool(globalUserPath: string, id: string) {
  const document = readEditable(globalUserPath);
  if (!document.tools.some((tool) => tool.id === id)) throw new Error(`Tool ${id} does not exist`);
  writeToolCatalogDocument(toolCatalogPath(globalUserPath), {
    version: TOOL_CATALOG_VERSION,
    tools: document.tools.filter((tool) => tool.id !== id),
  });
  return readValidatedDocument(toolCatalogPath(globalUserPath));
}
