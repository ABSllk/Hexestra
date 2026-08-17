// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn() },
}));

import { KnowledgeRefineryService, extractKnowledgeRefinerySource, formatKnowledgeRefinerySource } from '@electron/services/knowledge-refinery.service';

const directories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('knowledge refinery source extraction', () => {
  it('recognizes the supported document categories without trusting unknown extensions', () => {
    expect(formatKnowledgeRefinerySource('manual.md')).toBe('markdown');
    expect(formatKnowledgeRefinerySource('notes.txt')).toBe('text');
    expect(formatKnowledgeRefinerySource('scanner.py')).toBe('code');
    expect(formatKnowledgeRefinerySource('runbook.pdf')).toBe('pdf');
    expect(formatKnowledgeRefinerySource('runbook.docx')).toBe('docx');
    expect(formatKnowledgeRefinerySource('payload.exe')).toBeNull();
  });

  it('extracts line anchors from text and rejects binary masquerading as text', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-refinery-'));
    directories.push(directory);
    const source = path.join(directory, 'manual.md');
    fs.writeFileSync(source, '# Rules\nAlways verify the result.\n\nNever treat examples as evidence.\n', 'utf8');
    const extracted = await extractKnowledgeRefinerySource(source, 'markdown');
    expect(extracted[0]).toMatchObject({ anchor: { kind: 'line', label: 'Line 1' }, text: '# Rules' });
    expect(extracted[1]).toMatchObject({ anchor: { kind: 'line', label: 'Line 2' }, text: 'Always verify the result.' });
    const binary = path.join(directory, 'masquerading.txt');
    fs.writeFileSync(binary, Buffer.from([0x61, 0x00, 0x62]));
    await expect(extractKnowledgeRefinerySource(binary, 'text')).rejects.toThrow(/binary/);
  });

  it('separates an exported Skill header from its reusable body', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-refinery-'));
    directories.push(directory);
    const source = path.join(directory, 'skill.json');
    fs.writeFileSync(source, JSON.stringify({
      name: 'hexestra-evasion-playbook',
      description: 'Reusable payload deployment guidance.',
      content: '---\nname: hexestra-evasion-playbook\ndescription: Reusable payload deployment guidance.\n---\n\n# Deploy\n\nVerify the delivery result.',
      metadata: { 'hexestra-risk': 'active' },
    }), 'utf8');

    const extracted = await extractKnowledgeRefinerySource(source, 'text');

    expect(extracted[0]).toMatchObject({
      anchor: { label: 'Skill metadata' },
      text: expect.stringContaining('[Imported Hexestra Skill metadata]'),
    });
    expect(extracted.slice(1).map((chunk) => chunk.text).join('\n')).toBe('# Deploy\nVerify the delivery result.');
    expect(extracted.slice(1).map((chunk) => chunk.text).join('\n')).not.toContain('description: Reusable payload deployment guidance.');
  });

  it('resolves retained extracted text for an ordinary Agent distill turn', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-refinery-agent-'));
    directories.push(directory);
    vi.stubEnv('HEXESTRA_HOME', path.join(directory, 'portable-home'));
    const sourcePath = path.join(directory, 'manual.md');
    fs.writeFileSync(sourcePath, '# Verification\nAlways verify the final result.\n', 'utf8');
    const service = new KnowledgeRefineryService({
      analyze: async () => ({ candidates: [], ignoredSummary: [] }),
      isMainAgentBusy: () => false,
      modelSnapshot: () => 'test-model',
    }, false);

    const [source] = await service.importSources({} as never, [sourcePath]);
    const resolved = await service.readSourceForAgent(source.id);

    expect(resolved.name).toBe('manual.md');
    expect(resolved.content).toContain('[Line 1]\n# Verification');
    expect(resolved.content).toContain('[Line 2]\nAlways verify the final result.');
  });
});
