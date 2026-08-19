// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTool,
  deleteTool,
  listEnabledToolCatalog,
  readToolCatalog,
  resolveToolCatalogCandidates,
  toolCatalogPath,
  updateTool,
  validateToolCatalogDocument,
} from '@electron/services/tool-catalog.service';
import type { ToolCatalogRecord } from '@electron/contracts/tool-catalog';

const roots: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-tool-catalog-'));
  roots.push(root);
  return root;
}

function customTool(id = 'custom-tool'): ToolCatalogRecord {
  return {
    id,
    name: 'Custom tool',
    description: 'Custom prompt entry',
    enabled: true,
    capabilities: ['web-scanning'],
    tacticIds: ['TA0043'],
    techniqueIds: ['T1595'],
    risk: 'active',
    channel: 'agent-runtime',
    command: 'custom',
    usage: 'Use for scoped checks.',
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('tool catalog service', () => {
  it('seeds the six defaults once and does not recreate a deleted default', () => {
    const root = tempRoot();
    const seeded = readToolCatalog(root);
    expect(seeded.diagnostics).toEqual([]);
    expect(seeded.document.tools).toHaveLength(6);
    expect(fs.existsSync(path.join(root, 'seeded-tools.json'))).toBe(true);

    deleteTool(root, 'nmap');
    expect(readToolCatalog(root).document.tools.map((tool) => tool.id)).not.toContain('nmap');
    expect(readToolCatalog(root).document.tools).toHaveLength(5);
  });

  it('backs up and migrates a legacy catalog while merging defaults', () => {
    const root = tempRoot();
    const legacy = {
      tools: [{
        ...customTool(),
        disabled: true,
        executable: 'legacy-command',
        installHint: 'Legacy usage',
        enabled: undefined,
        command: undefined,
        usage: undefined,
        available: true,
        version: '1.2.3',
        checkedAt: '2026-01-01T00:00:00.000Z',
      }],
    };
    fs.writeFileSync(toolCatalogPath(root), YAML.stringify(legacy), 'utf8');

    const migrated = readToolCatalog(root);
    const custom = migrated.document.tools.find((tool) => tool.id === 'custom-tool');
    expect(migrated.diagnostics).toEqual([]);
    expect(migrated.document.tools).toHaveLength(7);
    expect(custom).toMatchObject({ enabled: false, command: 'legacy-command', usage: 'Legacy usage' });
    expect(custom).not.toHaveProperty('available');
    expect(fs.readdirSync(root).filter((name) => name.startsWith('tools.pre-v1-'))).toHaveLength(1);

    readToolCatalog(root);
    expect(fs.readdirSync(root).filter((name) => name.startsWith('tools.pre-v1-'))).toHaveLength(1);
  });

  it('leaves malformed YAML untouched and returns diagnostics', () => {
    const root = tempRoot();
    const malformed = 'version: 1\ntools: [\n';
    fs.writeFileSync(toolCatalogPath(root), malformed, 'utf8');

    const result = readToolCatalog(root);
    expect(result.diagnostics.join(' ')).toContain('Invalid tools YAML');
    expect(fs.readFileSync(toolCatalogPath(root), 'utf8')).toBe(malformed);
    expect(fs.existsSync(path.join(root, 'seeded-tools.json'))).toBe(false);
  });

  it('creates, updates, disables, and deletes records with canonical atomic writes', () => {
    const root = tempRoot();
    readToolCatalog(root);
    createTool(root, { ...customTool(), capabilities: ['Web-Scanning', 'web-scanning'], tacticIds: ['ta0043', 'TA0043'] });
    let custom = readToolCatalog(root).document.tools.find((tool) => tool.id === 'custom-tool')!;
    expect(custom.capabilities).toEqual(['web-scanning']);
    expect(custom.tacticIds).toEqual(['TA0043']);

    updateTool(root, custom.id, { ...custom, name: 'Renamed', enabled: false });
    custom = readToolCatalog(root).document.tools.find((tool) => tool.id === custom.id)!;
    expect(custom).toMatchObject({ id: 'custom-tool', name: 'Renamed', enabled: false });
    expect(listEnabledToolCatalog(root).map((tool) => tool.id)).not.toContain('custom-tool');

    deleteTool(root, custom.id);
    expect(readToolCatalog(root).document.tools.map((tool) => tool.id)).not.toContain(custom.id);
    expect(fs.readdirSync(root).some((name) => name.includes('.tmp-'))).toBe(false);
  });

  it('rejects duplicate IDs and invalid enum or ATT&CK values without overwriting the file', () => {
    const root = tempRoot();
    readToolCatalog(root);
    const before = fs.readFileSync(toolCatalogPath(root), 'utf8');
    expect(() => createTool(root, { ...customTool(), id: 'nmap' })).toThrow(/already exists/);
    expect(() => createTool(root, { ...customTool(), risk: 'unknown' as never })).toThrow(/risk/);
    expect(() => createTool(root, { ...customTool(), techniqueIds: ['T9999'] })).toThrow(/T9999/);
    expect(fs.readFileSync(toolCatalogPath(root), 'utf8')).toBe(before);
  });

  it('reports duplicate document IDs and invalid stable IDs', () => {
    const invalid = validateToolCatalogDocument({ version: 1, tools: [customTool('Bad ID')] });
    const duplicate = validateToolCatalogDocument({ version: 1, tools: [customTool(), customTool()] });
    expect(invalid.diagnostics.join(' ')).toContain('lowercase stable identifier');
    expect(duplicate.diagnostics.join(' ')).toContain('Duplicate tool id custom-tool');
  });

  it('resolves enabled focused-task candidates with deterministic match reasons', () => {
    const candidates = resolveToolCatalogCandidates([
      customTool('preferred-tool'),
      { ...customTool('disabled-tool'), enabled: false },
      { ...customTool('technique-tool'), capabilities: [], techniqueIds: ['T1595.001'] },
    ], {
      preferredToolIds: ['preferred-tool', 'deleted-tool'],
      requiredCapabilities: ['web-scanning'],
      techniqueIds: ['T1595.001'],
    });
    expect(candidates.map((tool) => tool.id)).toEqual(['preferred-tool', 'technique-tool']);
    expect(candidates[0]).toMatchObject({ preferred: true, matchedBy: ['preferred', 'capability:web-scanning'] });
    expect(candidates[1].matchedBy).toEqual(['technique:T1595.001']);
    expect(candidates.some((tool) => tool.id === 'deleted-tool')).toBe(false);
  });
});
